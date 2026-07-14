use crate::error::{AppError, AppResult, ErrorKind};
use crate::models::*;
use encoding_rs::WINDOWS_1252;
use odbc_api::{
    buffers::TextRowSet,
    parameter::{InputParameter, VarCharBox, WithDataType},
    Connection, ConnectionOptions, Cursor, DataType, Environment, IntoParameter, ResultSetMetadata,
};
use std::collections::HashMap;
use std::sync::OnceLock;

/// Batch size for block-fetching rows over ODBC.
const BATCH_SIZE: usize = 128;
/// Max bytes per text cell (memo fields beyond this are truncated for display).
const MAX_CELL_BYTES: usize = 8192;

static ENVIRONMENT: OnceLock<Environment> = OnceLock::new();

fn environment() -> AppResult<&'static Environment> {
    if ENVIRONMENT.get().is_none() {
        let env = Environment::new().map_err(AppError::from)?;
        let _ = ENVIRONMENT.set(env);
    }
    Ok(ENVIRONMENT.get().unwrap())
}

/// Open a fresh connection to the given .accdb file.
/// We deliberately use connection-per-request: the JET/ACE driver is cheap to
/// connect to locally and per-request connections avoid all Send/Sync issues.
pub fn connect(db_path: &str) -> AppResult<Connection<'static>> {
    let conn_str = format!(
        "Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};Dbq={};Uid=Admin;Pwd=;",
        db_path
    );
    let env = environment()?;
    let conn = env.connect_with_connection_string(&conn_str, ConnectionOptions::default())?;
    Ok(conn)
}

/// Decode narrow (ANSI) bytes coming from the Access driver into a String.
/// The ACE driver converts text to the system ANSI codepage (Windows-1252 on
/// western systems) when narrow ODBC functions are used.
fn decode(bytes: &[u8]) -> String {
    let (s, _, _) = WINDOWS_1252.decode(bytes);
    s.into_owned()
}

/// Encode a UTF-8 string into the ANSI codepage for parameter binding.
fn encode(s: &str) -> Vec<u8> {
    let (b, _, _) = WINDOWS_1252.encode(s);
    b.into_owned()
}

/// Bracket-quote an Access identifier. Rejects names containing ']' or NUL
/// which cannot appear in valid Access identifiers (prevents SQL injection
/// through identifiers; values are always bound as parameters).
fn bracket(name: &str) -> AppResult<String> {
    if name.contains(']') || name.contains('\0') {
        return Err(AppError::other(format!("Invalid identifier: {name}")));
    }
    Ok(format!("[{name}]"))
}

fn is_system_object(name: &str) -> bool {
    name.starts_with("MSys") || name.starts_with('~') || name.starts_with("USys")
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

fn collect_object_names(conn: &Connection<'_>, table_type: &str) -> AppResult<Vec<String>> {
    let rows = conn.tables("", "", "", table_type)?;
    let mut names = Vec::new();
    for row in rows {
        let row = row?;
        if let Some(bytes) = row.table.as_bytes() {
            let name = decode(bytes);
            if !is_system_object(&name) {
                names.push(name);
            }
        }
    }
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

pub fn list_tables(conn: &Connection<'_>) -> AppResult<Vec<String>> {
    collect_object_names(conn, "TABLE")
}

/// Saved Access SELECT queries are exposed as VIEWs through ODBC.
pub fn list_queries(conn: &Connection<'_>) -> AppResult<Vec<String>> {
    collect_object_names(conn, "VIEW")
}

// The Access ODBC driver does NOT support SQLPrimaryKeys ("driver does not
// support this function"), so we detect the primary key via SQLStatistics:
// unique indexes are reported, and Access names the PK index "PrimaryKey".
// odbc-sys does not export SQLStatisticsW, so declare the FFI ourselves.
#[link(name = "odbc32")]
extern "system" {
    fn SQLStatisticsW(
        statement_handle: odbc_api::sys::HStmt,
        catalog_name: *const u16,
        name_length1: i16,
        schema_name: *const u16,
        name_length2: i16,
        table_name: *const u16,
        name_length3: i16,
        unique: u16,
        reserved: u16,
    ) -> odbc_api::sys::SqlReturn;
}

unsafe fn getdata_string(hstmt: odbc_api::sys::HStmt, col: u16) -> Option<String> {
    use odbc_api::sys::{CDataType, SqlReturn};
    let mut buf = [0u16; 512];
    let mut ind: isize = 0;
    let ret = odbc_api::sys::SQLGetData(
        hstmt,
        col,
        CDataType::WChar,
        buf.as_mut_ptr() as odbc_api::sys::Pointer,
        (buf.len() * 2) as isize,
        &mut ind,
    );
    if ret != SqlReturn::SUCCESS && ret != SqlReturn::SUCCESS_WITH_INFO {
        return None;
    }
    if ind < 0 {
        return None; // SQL_NULL_DATA
    }
    let chars = ((ind as usize) / 2).min(buf.len());
    Some(String::from_utf16_lossy(&buf[..chars]))
}

unsafe fn getdata_i32(hstmt: odbc_api::sys::HStmt, col: u16) -> Option<i32> {
    use odbc_api::sys::{CDataType, SqlReturn};
    let mut val: i32 = 0;
    let mut ind: isize = 0;
    let ret = odbc_api::sys::SQLGetData(
        hstmt,
        col,
        CDataType::SLong,
        &mut val as *mut i32 as odbc_api::sys::Pointer,
        std::mem::size_of::<i32>() as isize,
        &mut ind,
    );
    if ret != SqlReturn::SUCCESS && ret != SqlReturn::SUCCESS_WITH_INFO {
        return None;
    }
    if ind < 0 {
        return None;
    }
    Some(val)
}

fn primary_key_columns(conn: &Connection<'_>, table: &str) -> Vec<String> {
    use odbc_api::handles::Statement as _;
    use odbc_api::sys::SqlReturn;

    const SQL_INDEX_UNIQUE: u16 = 0;
    const SQL_QUICK: u16 = 0;

    // index name -> [(ordinal, column)]
    let mut indexes: HashMap<String, Vec<(i32, String)>> = HashMap::new();

    let Ok(prealloc) = conn.preallocate() else {
        return Vec::new();
    };
    let stmt = prealloc.into_handle();
    let hstmt = stmt.as_sys();
    let table_w: Vec<u16> = table.encode_utf16().collect();

    unsafe {
        let ret = SQLStatisticsW(
            hstmt,
            std::ptr::null(),
            0,
            std::ptr::null(),
            0,
            table_w.as_ptr(),
            table_w.len() as i16,
            SQL_INDEX_UNIQUE,
            SQL_QUICK,
        );
        if ret != SqlReturn::SUCCESS && ret != SqlReturn::SUCCESS_WITH_INFO {
            return Vec::new();
        }
        loop {
            let ret = odbc_api::sys::SQLFetch(hstmt);
            if ret != SqlReturn::SUCCESS && ret != SqlReturn::SUCCESS_WITH_INFO {
                break;
            }
            // Statistics result columns (1-based): 4 NON_UNIQUE, 6 INDEX_NAME,
            // 7 TYPE (0 == table statistics row, skip), 8 ORDINAL, 9 COLUMN_NAME
            let idx_type = getdata_i32(hstmt, 7).unwrap_or(0);
            if idx_type == 0 {
                continue;
            }
            let non_unique = getdata_i32(hstmt, 4).unwrap_or(1);
            if non_unique != 0 {
                continue;
            }
            let Some(index_name) = getdata_string(hstmt, 6) else {
                continue;
            };
            let ordinal = getdata_i32(hstmt, 8).unwrap_or(0);
            let Some(column) = getdata_string(hstmt, 9) else {
                continue;
            };
            indexes
                .entry(index_name)
                .or_default()
                .push((ordinal, column));
        }
    }
    drop(stmt);

    // Access names the primary key index "PrimaryKey". Prefer it; otherwise
    // fall back to the smallest unique index (still identifies rows uniquely).
    let chosen = indexes
        .remove("PrimaryKey")
        .or_else(|| indexes.into_values().min_by_key(|cols| cols.len()));
    match chosen {
        Some(mut cols) => {
            cols.sort_by_key(|(ord, _)| *ord);
            cols.into_iter().map(|(_, c)| c).collect()
        }
        None => Vec::new(),
    }
}

pub fn get_table_schema(
    conn: &Connection<'_>,
    table: &str,
    is_query: bool,
) -> AppResult<TableSchema> {
    let pk = if is_query {
        Vec::new()
    } else {
        primary_key_columns(conn, table)
    };

    let mut columns = Vec::new();
    let rows = conn.columns("", "", table, "%")?;
    for row in rows {
        let row = row?;
        let name = match row.column_name.as_bytes() {
            Some(b) => decode(b),
            None => continue,
        };
        let sql_type = row.data_type as i32;
        let type_name = row.type_name.as_bytes().map(decode).unwrap_or_default();
        let size: Option<u32> = row
            .column_size
            .into_opt()
            .and_then(|s| u32::try_from(s).ok());
        // SQL_NO_NULLS == 0; SQL_NULLABLE(1)/SQL_NULLABLE_UNKNOWN(2) => nullable.
        let nullable = row.nullable != 0;
        let is_autonumber = type_name.eq_ignore_ascii_case("COUNTER");
        let is_pk = pk.iter().any(|p| p == &name);
        columns.push(Column {
            category: ColumnCategory::from_sql_type(sql_type),
            is_primary_key: is_pk,
            // AutoNumber PKs report NOT NULL but users never fill them.
            nullable: nullable || is_autonumber,
            name,
            type_name,
            is_autonumber,
            size,
        });
    }

    if columns.is_empty() {
        return Err(AppError::other(format!(
            "Could not read any columns for '{table}'."
        )));
    }

    let read_only = is_query || pk.is_empty();
    Ok(TableSchema {
        name: table.to_string(),
        columns,
        primary_key: pk,
        read_only,
    })
}

// ---------------------------------------------------------------------------
// Parameter building (values are ALWAYS bound, never concatenated)
// ---------------------------------------------------------------------------

type BoxedParam = Box<dyn InputParameter>;

fn text_param(value: &str) -> BoxedParam {
    Box::new(VarCharBox::from_vec(encode(value)))
}

fn null_param() -> BoxedParam {
    Box::new(VarCharBox::null())
}

/// Parse a UI date/datetime string ("YYYY-MM-DD" or "YYYY-MM-DDTHH:MM[:SS]"
/// or "YYYY-MM-DD HH:MM[:SS]") into an ODBC timestamp parameter.
fn timestamp_param(value: &str) -> AppResult<BoxedParam> {
    let v = value.trim().replace('T', " ");
    let (date_part, time_part) = match v.split_once(' ') {
        Some((d, t)) => (d.to_string(), t.to_string()),
        None => (v.clone(), String::new()),
    };
    let dp: Vec<&str> = date_part.split('-').collect();
    if dp.len() != 3 {
        return Err(AppError::other(format!("Invalid date value: {value}")));
    }
    let year: i16 = dp[0].parse().map_err(|_| AppError::other("Invalid year"))?;
    let month: u16 = dp[1]
        .parse()
        .map_err(|_| AppError::other("Invalid month"))?;
    let day: u16 = dp[2].parse().map_err(|_| AppError::other("Invalid day"))?;
    let mut hour: u16 = 0;
    let mut minute: u16 = 0;
    let mut second: u16 = 0;
    if !time_part.is_empty() {
        let tp: Vec<&str> = time_part.split(':').collect();
        if !tp.is_empty() {
            hour = tp[0].parse().unwrap_or(0);
        }
        if tp.len() > 1 {
            minute = tp[1].parse().unwrap_or(0);
        }
        if tp.len() > 2 {
            second = tp[2].split('.').next().unwrap_or("0").parse().unwrap_or(0);
        }
    }
    let ts = odbc_api::sys::Timestamp {
        year,
        month,
        day,
        hour,
        minute,
        second,
        fraction: 0,
    };
    // Timestamp alone lacks an SQL data type; WithDataType makes it bindable.
    Ok(Box::new(WithDataType {
        value: ts,
        data_type: DataType::Timestamp { precision: 0 },
    }))
}

/// Convert a UI-supplied string value into a typed ODBC parameter based on
/// the column category. `None` becomes SQL NULL.
fn typed_param(category: ColumnCategory, value: Option<&str>) -> AppResult<BoxedParam> {
    let Some(v) = value else {
        return Ok(null_param());
    };
    let v = v.trim();
    if v.is_empty() && category != ColumnCategory::Text {
        return Ok(null_param());
    }
    match category {
        ColumnCategory::Text => Ok(text_param(v)),
        ColumnCategory::Integer => {
            let n: i64 = v
                .parse()
                .map_err(|_| AppError::other(format!("'{v}' is not a valid integer")))?;
            // The Access driver has no BIGINT support (HYC00 on SQL_C_SBIGINT);
            // Access LONG is 32-bit anyway. Fall back to DOUBLE for huge values.
            match i32::try_from(n) {
                Ok(n32) => Ok(Box::new(n32.into_parameter())),
                Err(_) => Ok(Box::new((n as f64).into_parameter())),
            }
        }
        ColumnCategory::Float => {
            let n: f64 = v
                .replace(',', ".")
                .parse()
                .map_err(|_| AppError::other(format!("'{v}' is not a valid number")))?;
            Ok(Box::new(n.into_parameter()))
        }
        ColumnCategory::Boolean => {
            let b: i16 = match v.to_lowercase().as_str() {
                "true" | "1" | "yes" | "ja" | "-1" => 1,
                _ => 0,
            };
            Ok(Box::new(b.into_parameter()))
        }
        ColumnCategory::Date => timestamp_param(v),
    }
}

// ---------------------------------------------------------------------------
// WHERE clause building
// ---------------------------------------------------------------------------

/// Build the WHERE clause SQL + parameters for the given filters/search.
/// Returns (sql_fragment_without_WHERE, params). All values are parameters.
fn build_where(
    filters: &[Filter],
    global_search: &Option<String>,
    search_columns: &[String],
) -> AppResult<(String, Vec<BoxedParam>)> {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<BoxedParam> = Vec::new();

    for f in filters {
        let col = bracket(&f.column)?;
        match f.op.as_str() {
            "contains" => {
                let v = f.value.clone().unwrap_or_default();
                clauses.push(format!("({col} LIKE ?)"));
                params.push(text_param(&format!("%{v}%")));
            }
            "equals" => {
                clauses.push(format!("({col} = ?)"));
                params.push(typed_param(f.category, f.value.as_deref())?);
            }
            "gte" => {
                clauses.push(format!("({col} >= ?)"));
                params.push(typed_param(f.category, f.value.as_deref())?);
            }
            "lte" => {
                clauses.push(format!("({col} <= ?)"));
                params.push(typed_param(f.category, f.value.as_deref())?);
            }
            "boolean" => {
                let truthy = matches!(
                    f.value.as_deref().map(|s| s.to_lowercase()).as_deref(),
                    Some("true") | Some("1") | Some("yes")
                );
                // No user data flows into the SQL here.
                if truthy {
                    clauses.push(format!("({col} <> 0)"));
                } else {
                    clauses.push(format!("({col} = 0 OR {col} IS NULL)"));
                }
            }
            "is_null" => clauses.push(format!("({col} IS NULL)")),
            "not_null" => clauses.push(format!("({col} IS NOT NULL)")),
            other => {
                return Err(AppError::other(format!("Unknown filter operator: {other}")));
            }
        }
    }

    if let Some(term) = global_search {
        let term = term.trim();
        if !term.is_empty() && !search_columns.is_empty() {
            let mut ors = Vec::new();
            for c in search_columns {
                let col = bracket(c)?;
                // `col & ''` coerces any Access type to text and maps NULL to ''.
                ors.push(format!("({col} & '' LIKE ?)"));
                params.push(text_param(&format!("%{term}%")));
            }
            clauses.push(format!("({})", ors.join(" OR ")));
        }
    }

    Ok((clauses.join(" AND "), params))
}

fn build_order_by(sort: &Option<Sort>) -> AppResult<String> {
    match sort {
        Some(s) => {
            let col = bracket(&s.column)?;
            let dir = if s.direction.eq_ignore_ascii_case("desc") {
                "DESC"
            } else {
                "ASC"
            };
            Ok(format!(" ORDER BY {col} {dir}"))
        }
        None => Ok(String::new()),
    }
}

// ---------------------------------------------------------------------------
// Reading rows (tables and saved queries share this path)
// ---------------------------------------------------------------------------

fn param_refs(params: &[BoxedParam]) -> &[BoxedParam] {
    params
}

/// Count matching rows with SELECT COUNT(*).
fn count_rows(
    conn: &Connection<'_>,
    source: &str,
    where_sql: &str,
    params: &[BoxedParam],
) -> AppResult<usize> {
    let src = bracket(source)?;
    let mut sql = format!("SELECT COUNT(*) FROM {src}");
    if !where_sql.is_empty() {
        sql.push_str(&format!(" WHERE {where_sql}"));
    }
    let cursor = conn.execute(&sql, param_refs(params), None)?;
    let Some(mut cursor) = cursor else {
        return Ok(0);
    };
    let mut buffers = TextRowSet::for_cursor(1, &mut cursor, Some(64))?;
    let mut rsc = cursor.bind_buffer(&mut buffers)?;
    let total = match rsc.fetch()? {
        Some(batch) if batch.num_rows() > 0 => batch
            .at(0, 0)
            .map(decode)
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0),
        _ => 0,
    };
    Ok(total)
}

/// Fetch one page of rows. Access has no OFFSET, so we SELECT TOP (end) and
/// skip the first `page * page_size` rows while draining the cursor.
pub fn query_rows(conn: &Connection<'_>, p: &QueryParams) -> AppResult<RowPage> {
    let (where_sql, params) = build_where(&p.filters, &p.global_search, &p.search_columns)?;
    let order_sql = build_order_by(&p.sort)?;

    let page_size = if p.page_size == 0 { 50 } else { p.page_size };
    let skip = p.page * page_size;
    let end = skip + page_size;

    let total = count_rows(conn, &p.source, &where_sql, &params)?;

    let src = bracket(&p.source)?;
    let mut sql = format!("SELECT TOP {end} * FROM {src}");
    if !where_sql.is_empty() {
        sql.push_str(&format!(" WHERE {where_sql}"));
    }
    sql.push_str(&order_sql);

    let cursor = conn.execute(&sql, param_refs(&params), None)?;
    let Some(mut cursor) = cursor else {
        return Err(AppError::other("The statement returned no result set."));
    };

    let columns: Vec<String> = cursor
        .column_names()?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| AppError::other(format!("Could not read column names: {e}")))?;

    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut buffers = TextRowSet::for_cursor(BATCH_SIZE, &mut cursor, Some(MAX_CELL_BYTES))?;
    let mut rsc = cursor.bind_buffer(&mut buffers)?;
    let mut seen = 0usize;
    'outer: while let Some(batch) = rsc.fetch()? {
        for row in 0..batch.num_rows() {
            if seen >= end {
                break 'outer;
            }
            if seen >= skip {
                let mut out = Vec::with_capacity(batch.num_cols());
                for col in 0..batch.num_cols() {
                    out.push(batch.at(col, row).map(decode));
                }
                rows.push(out);
            }
            seen += 1;
        }
    }

    Ok(RowPage {
        columns,
        rows,
        total,
        page: p.page,
        page_size,
    })
}

/// Stream ALL matching rows (no pagination) into a CSV file at `dest_path`.
pub fn export_csv(conn: &Connection<'_>, p: &QueryParams, dest_path: &str) -> AppResult<usize> {
    use std::io::Write;

    let (where_sql, params) = build_where(&p.filters, &p.global_search, &p.search_columns)?;
    let order_sql = build_order_by(&p.sort)?;
    let src = bracket(&p.source)?;
    let mut sql = format!("SELECT * FROM {src}");
    if !where_sql.is_empty() {
        sql.push_str(&format!(" WHERE {where_sql}"));
    }
    sql.push_str(&order_sql);

    let cursor = conn.execute(&sql, param_refs(&params), None)?;
    let Some(mut cursor) = cursor else {
        return Err(AppError::other("The statement returned no result set."));
    };

    let columns: Vec<String> = cursor
        .column_names()?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| AppError::other(format!("Could not read column names: {e}")))?;

    fn csv_escape(s: &str) -> String {
        if s.contains(['"', ',', '\n', '\r', ';']) {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s.to_string()
        }
    }

    let file = std::fs::File::create(dest_path)?;
    let mut w = std::io::BufWriter::new(file);
    // UTF-8 BOM so Excel opens umlauts correctly.
    w.write_all(&[0xEF, 0xBB, 0xBF])?;
    writeln!(
        w,
        "{}",
        columns
            .iter()
            .map(|c| csv_escape(c))
            .collect::<Vec<_>>()
            .join(",")
    )?;

    let mut written = 0usize;
    let mut buffers = TextRowSet::for_cursor(BATCH_SIZE, &mut cursor, Some(MAX_CELL_BYTES))?;
    let mut rsc = cursor.bind_buffer(&mut buffers)?;
    while let Some(batch) = rsc.fetch()? {
        for row in 0..batch.num_rows() {
            let line: Vec<String> = (0..batch.num_cols())
                .map(|col| batch.at(col, row).map(decode).unwrap_or_default())
                .map(|s| csv_escape(&s))
                .collect();
            writeln!(w, "{}", line.join(","))?;
            written += 1;
        }
    }
    w.flush()?;
    Ok(written)
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

fn category_map(schema: &TableSchema) -> HashMap<String, ColumnCategory> {
    schema
        .columns
        .iter()
        .map(|c| (c.name.clone(), c.category))
        .collect()
}

fn require_writable(schema: &TableSchema) -> AppResult<()> {
    if schema.read_only {
        return Err(AppError::new(
            ErrorKind::NoPrimaryKey,
            format!(
                "Table '{}' has no primary key and is read-only in this app.",
                schema.name
            ),
        ));
    }
    Ok(())
}

pub fn insert_row(
    conn: &Connection<'_>,
    table: &str,
    values: &HashMap<String, Option<String>>,
) -> AppResult<()> {
    let schema = get_table_schema(conn, table, false)?;
    let cats = category_map(&schema);

    let mut cols: Vec<String> = Vec::new();
    let mut params: Vec<BoxedParam> = Vec::new();
    for c in &schema.columns {
        if c.is_autonumber {
            continue; // Access assigns AutoNumber values.
        }
        if let Some(v) = values.get(&c.name) {
            cols.push(bracket(&c.name)?);
            params.push(typed_param(*cats.get(&c.name).unwrap(), v.as_deref())?);
        }
    }
    if cols.is_empty() {
        return Err(AppError::other("No values provided for the new row."));
    }
    let placeholders = vec!["?"; cols.len()].join(", ");
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        bracket(table)?,
        cols.join(", "),
        placeholders
    );
    conn.execute(&sql, param_refs(&params), None)?;
    Ok(())
}

/// Build "pk1 = ? AND pk2 = ?" for the primary key and push the params.
fn pk_where(
    schema: &TableSchema,
    pk_values: &HashMap<String, Option<String>>,
    params: &mut Vec<BoxedParam>,
) -> AppResult<String> {
    let cats = category_map(schema);
    let mut clauses = Vec::new();
    for pk_col in &schema.primary_key {
        let v = pk_values
            .get(pk_col)
            .ok_or_else(|| AppError::other(format!("Missing primary key value for '{pk_col}'")))?;
        clauses.push(format!("{} = ?", bracket(pk_col)?));
        params.push(typed_param(*cats.get(pk_col).unwrap(), v.as_deref())?);
    }
    Ok(clauses.join(" AND "))
}

pub fn update_row(
    conn: &Connection<'_>,
    table: &str,
    pk_values: &HashMap<String, Option<String>>,
    new_values: &HashMap<String, Option<String>>,
) -> AppResult<()> {
    let schema = get_table_schema(conn, table, false)?;
    require_writable(&schema)?;
    let cats = category_map(&schema);

    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<BoxedParam> = Vec::new();
    for c in &schema.columns {
        if c.is_autonumber {
            continue;
        }
        if let Some(v) = new_values.get(&c.name) {
            sets.push(format!("{} = ?", bracket(&c.name)?));
            params.push(typed_param(*cats.get(&c.name).unwrap(), v.as_deref())?);
        }
    }
    if sets.is_empty() {
        return Err(AppError::other("No changed values provided."));
    }
    let where_sql = pk_where(&schema, pk_values, &mut params)?;
    let sql = format!(
        "UPDATE {} SET {} WHERE {}",
        bracket(table)?,
        sets.join(", "),
        where_sql
    );
    conn.execute(&sql, param_refs(&params), None)?;
    Ok(())
}

/// Delete multiple rows (each identified by its full primary key). Returns
/// the number of rows deleted.
pub fn delete_rows(
    conn: &Connection<'_>,
    table: &str,
    pk_rows: &[HashMap<String, Option<String>>],
) -> AppResult<usize> {
    let schema = get_table_schema(conn, table, false)?;
    require_writable(&schema)?;

    let mut deleted = 0usize;
    for pk_values in pk_rows {
        let mut params: Vec<BoxedParam> = Vec::new();
        let where_sql = pk_where(&schema, pk_values, &mut params)?;
        let sql = format!("DELETE FROM {} WHERE {}", bracket(table)?, where_sql);
        conn.execute(&sql, param_refs(&params), None)?;
        deleted += 1;
    }
    Ok(deleted)
}

// ---------------------------------------------------------------------------
// Lock detection
// ---------------------------------------------------------------------------

pub fn laccdb_path(db_path: &str) -> String {
    let p = std::path::Path::new(db_path);
    p.with_extension("laccdb").to_string_lossy().into_owned()
}

/// Parse the Access lock file (.laccdb / .ldb). It is a flat array of 64-byte
/// records: bytes 0..32 = machine/computer name, bytes 32..64 = security
/// (user) name, each NUL/space padded. Returns the distinct holders.
pub fn read_lock_holders(db_path: &str) -> Vec<LockHolder> {
    let path = laccdb_path(db_path);
    let Ok(bytes) = std::fs::read(&path) else {
        return Vec::new();
    };

    fn clean(chunk: &[u8]) -> String {
        // Names are ANSI, NUL/space terminated.
        let end = chunk.iter().position(|&b| b == 0).unwrap_or(chunk.len());
        decode(&chunk[..end]).trim().to_string()
    }

    let mut holders: Vec<LockHolder> = Vec::new();
    for rec in bytes.chunks(64) {
        if rec.len() < 64 {
            break;
        }
        let machine = clean(&rec[0..32]);
        let user = clean(&rec[32..64]);
        if machine.is_empty() && user.is_empty() {
            continue;
        }
        let holder = LockHolder {
            machine: if machine.is_empty() {
                "?".into()
            } else {
                machine
            },
            user: if user.is_empty() { "?".into() } else { user },
        };
        if !holders
            .iter()
            .any(|h| h.machine == holder.machine && h.user == holder.user)
        {
            holders.push(holder);
        }
    }
    holders
}

/// Check whether the DB is (probably) open in Access: look for the .laccdb
/// lock file and verify a fresh connection still succeeds. The lock file
/// alone is only a warning (it can be a crash leftover) — the connection
/// result decides whether browsing works at all.
pub fn check_lock_status(db_path: &str) -> LockStatus {
    let laccdb_present = std::path::Path::new(&laccdb_path(db_path)).exists();
    let holders = if laccdb_present {
        read_lock_holders(db_path)
    } else {
        Vec::new()
    };
    match connect(db_path) {
        Ok(conn) => {
            // Connection works: we can at least browse.
            drop(conn);
            LockStatus {
                laccdb_present,
                connect_ok: true,
                locked: laccdb_present,
                message: if laccdb_present {
                    Some(
                        "A lock file (.laccdb) is present — the database is probably open in \
                         Microsoft Access. Browsing works, but edits may fail."
                            .to_string(),
                    )
                } else {
                    None
                },
                holders,
            }
        }
        Err(e) => LockStatus {
            laccdb_present,
            connect_ok: false,
            locked: true,
            message: Some(e.message),
            holders,
        },
    }
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/// Copy the database file to `dest`. If `dest` is None, a timestamped copy is
/// made next to the original (e.g. `mydb_backup_20260714_213000.accdb`).
/// Returns the path of the created backup.
pub fn backup_database(db_path: &str, dest: Option<&str>) -> AppResult<String> {
    let src = std::path::Path::new(db_path);
    if !src.exists() {
        return Err(AppError::other("Database file not found."));
    }
    let dest_path = match dest {
        Some(d) => std::path::PathBuf::from(d),
        None => {
            let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("backup");
            let ext = src.extension().and_then(|s| s.to_str()).unwrap_or("accdb");
            let ts = local_timestamp_compact();
            let name = format!("{stem}_backup_{ts}.{ext}");
            src.with_file_name(name)
        }
    };
    std::fs::copy(src, &dest_path)?;
    Ok(dest_path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Dashboard / cockpit statistics
// ---------------------------------------------------------------------------

/// COUNT(*) for a single source; returns None on any error (e.g. a parameter
/// query that cannot be executed).
fn try_count(conn: &Connection<'_>, source: &str) -> Option<i64> {
    let src = bracket(source).ok()?;
    let sql = format!("SELECT COUNT(*) FROM {src}");
    let mut cursor = conn.execute(&sql, (), None).ok()??;
    let mut buffers = TextRowSet::for_cursor(1, &mut cursor, Some(64)).ok()?;
    let mut rsc = cursor.bind_buffer(&mut buffers).ok()?;
    let batch = rsc.fetch().ok()??;
    if batch.num_rows() == 0 {
        return None;
    }
    batch
        .at(0, 0)
        .map(decode)
        .and_then(|s| s.trim().parse().ok())
}

pub fn dashboard_stats(conn: &Connection<'_>, db_path: &str) -> AppResult<DashboardStats> {
    let tables = list_tables(conn)?;
    let queries = list_queries(conn)?;

    let mut table_stats = Vec::with_capacity(tables.len());
    let mut total_rows: i64 = 0;
    for t in &tables {
        let rc = try_count(conn, t);
        if let Some(n) = rc {
            total_rows += n;
        }
        table_stats.push(TableStat {
            name: t.clone(),
            is_query: false,
            row_count: rc,
        });
    }
    let query_stats: Vec<TableStat> = queries
        .iter()
        .map(|q| TableStat {
            name: q.clone(),
            is_query: true,
            row_count: try_count(conn, q),
        })
        .collect();

    let path = std::path::Path::new(db_path);
    let meta = std::fs::metadata(path).ok();
    let file_size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let file_modified = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .map(format_system_time);

    Ok(DashboardStats {
        db_path: db_path.to_string(),
        file_name: path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
        file_size_bytes,
        file_modified,
        table_count: tables.len(),
        query_count: queries.len(),
        total_rows,
        tables: table_stats,
        queries: query_stats,
    })
}

/// Statistics for one column over the current (optionally filtered) view.
pub fn column_stats(
    conn: &Connection<'_>,
    p: &QueryParams,
    column: &str,
    category: ColumnCategory,
) -> AppResult<ColumnStats> {
    let src = bracket(&p.source)?;
    let col = bracket(column)?;

    // Reusable WHERE fragment; params rebuilt per query (binding is cheap).
    let where_of = || build_where(&p.filters, &p.global_search, &p.search_columns);
    let where_clause = |sql: &mut String, w: &str| {
        if !w.is_empty() {
            sql.push_str(&format!(" WHERE {w}"));
        }
    };

    // total + non-null
    let (w, params) = where_of()?;
    let mut sql = format!("SELECT COUNT(*), COUNT({col}) FROM {src}");
    where_clause(&mut sql, &w);
    let (total, non_null) = {
        let mut cursor = conn
            .execute(&sql, param_refs(&params), None)?
            .ok_or_else(|| AppError::other("No result set."))?;
        let mut buffers = TextRowSet::for_cursor(1, &mut cursor, Some(64))?;
        let mut rsc = cursor.bind_buffer(&mut buffers)?;
        match rsc.fetch()? {
            Some(b) if b.num_rows() > 0 => (
                b.at(0, 0)
                    .map(decode)
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0),
                b.at(1, 0)
                    .map(decode)
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0),
            ),
            _ => (0i64, 0i64),
        }
    };

    // distinct via subquery (JET has no COUNT(DISTINCT ...))
    let (w, params) = where_of()?;
    let mut inner = format!("SELECT DISTINCT {col} FROM {src}");
    where_clause(&mut inner, &w);
    let sql = format!("SELECT COUNT(*) FROM ({inner})");
    let distinct = {
        let mut cursor = conn
            .execute(&sql, param_refs(&params), None)?
            .ok_or_else(|| AppError::other("No result set."))?;
        let mut buffers = TextRowSet::for_cursor(1, &mut cursor, Some(64))?;
        let mut rsc = cursor.bind_buffer(&mut buffers)?;
        match rsc.fetch()? {
            Some(b) if b.num_rows() > 0 => b
                .at(0, 0)
                .map(decode)
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0),
            _ => 0i64,
        }
    };

    // min / max (all comparable types) and avg (numbers only)
    let numeric = matches!(category, ColumnCategory::Integer | ColumnCategory::Float);
    let (w, params) = where_of()?;
    let agg = if numeric {
        format!("SELECT MIN({col}), MAX({col}), AVG({col}) FROM {src}")
    } else {
        format!("SELECT MIN({col}), MAX({col}) FROM {src}")
    };
    let mut sql = agg;
    where_clause(&mut sql, &w);
    let (min, max, avg) = {
        let mut cursor = conn
            .execute(&sql, param_refs(&params), None)?
            .ok_or_else(|| AppError::other("No result set."))?;
        let mut buffers = TextRowSet::for_cursor(1, &mut cursor, Some(256))?;
        let mut rsc = cursor.bind_buffer(&mut buffers)?;
        match rsc.fetch()? {
            Some(b) if b.num_rows() > 0 => {
                let mn = b.at(0, 0).map(decode);
                let mx = b.at(1, 0).map(decode);
                let av = if numeric {
                    b.at(2, 0)
                        .map(decode)
                        .and_then(|s| s.trim().replace(',', ".").parse().ok())
                } else {
                    None
                };
                (mn, mx, av)
            }
            _ => (None, None, None),
        }
    };

    // top 10 values by frequency
    let (w, params) = where_of()?;
    let mut sql = format!("SELECT TOP 10 {col}, COUNT(*) FROM {src}");
    where_clause(&mut sql, &w);
    sql.push_str(&format!(" GROUP BY {col} ORDER BY COUNT(*) DESC"));
    let mut top_values = Vec::new();
    {
        let mut cursor = conn
            .execute(&sql, param_refs(&params), None)?
            .ok_or_else(|| AppError::other("No result set."))?;
        let mut buffers = TextRowSet::for_cursor(16, &mut cursor, Some(256))?;
        let mut rsc = cursor.bind_buffer(&mut buffers)?;
        while let Some(b) = rsc.fetch()? {
            for r in 0..b.num_rows() {
                top_values.push(TopValue {
                    value: b.at(0, r).map(decode),
                    count: b
                        .at(1, r)
                        .map(decode)
                        .and_then(|s| s.trim().parse().ok())
                        .unwrap_or(0),
                });
            }
        }
    }

    Ok(ColumnStats {
        column: column.to_string(),
        category,
        total,
        non_null,
        nulls: total - non_null,
        distinct,
        min,
        max,
        avg,
        top_values,
    })
}

// ---------------------------------------------------------------------------
// Small time helpers (avoid pulling in chrono)
// ---------------------------------------------------------------------------

fn format_system_time(t: std::time::SystemTime) -> String {
    // Seconds since epoch -> naive local-ish date string via the OS offset is
    // overkill; we format in UTC and label it. Good enough for a "last change".
    let dur = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let (y, mo, d, h, mi, s) = civil_from_unix(dur.as_secs() as i64);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02} UTC")
}

fn local_timestamp_compact() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let (y, mo, d, h, mi, s) = civil_from_unix(dur.as_secs() as i64);
    format!("{y:04}{mo:02}{d:02}_{h:02}{mi:02}{s:02}")
}

/// Convert unix seconds to (year, month, day, hour, min, sec) in UTC.
/// Uses Howard Hinnant's civil-from-days algorithm.
fn civil_from_unix(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let hour = (rem / 3600) as u32;
    let min = ((rem % 3600) / 60) as u32;
    let sec = (rem % 60) as u32;

    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d, hour, min, sec)
}
