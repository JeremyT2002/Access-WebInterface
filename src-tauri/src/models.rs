use serde::{Deserialize, Serialize};

/// Broad category of a column, derived from the ODBC SQL data type.
/// The frontend uses this to pick input widgets and filter UIs.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ColumnCategory {
    Text,
    Integer,
    Float,
    Boolean,
    Date,
}

impl ColumnCategory {
    /// Map an ODBC SQL type code (SQLColumns.DATA_TYPE) to a category.
    pub fn from_sql_type(sql_type: i32) -> ColumnCategory {
        match sql_type {
            // SQL_BIT
            -7 => ColumnCategory::Boolean,
            // SQL_TINYINT(-6), SQL_SMALLINT(5), SQL_INTEGER(4), SQL_BIGINT(-5)
            -6 | 5 | 4 | -5 => ColumnCategory::Integer,
            // SQL_NUMERIC(2), SQL_DECIMAL(3), SQL_FLOAT(6), SQL_REAL(7), SQL_DOUBLE(8)
            2 | 3 | 6 | 7 | 8 => ColumnCategory::Float,
            // SQL_DATE(9)/SQL_TYPE_DATE(91), SQL_TIME(10)/SQL_TYPE_TIME(92),
            // SQL_TIMESTAMP(11)/SQL_TYPE_TIMESTAMP(93)
            9 | 10 | 11 | 91 | 92 | 93 => ColumnCategory::Date,
            // Everything else (CHAR/VARCHAR/WCHAR/LONGVARCHAR/GUID/binary) -> text.
            _ => ColumnCategory::Text,
        }
    }
}

/// One column of a table, with everything the UI needs to render forms/filters.
#[derive(Debug, Clone, Serialize)]
pub struct Column {
    pub name: String,
    pub category: ColumnCategory,
    /// Raw ODBC type name (e.g. "COUNTER", "VARCHAR", "DATETIME").
    pub type_name: String,
    pub nullable: bool,
    /// True for Access AutoNumber columns (TYPE_NAME == "COUNTER") — excluded from create forms.
    pub is_autonumber: bool,
    pub is_primary_key: bool,
    /// Max character length for text columns, if known (for input maxlength hints).
    pub size: Option<u32>,
}

/// Full schema of a table.
#[derive(Debug, Clone, Serialize)]
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<Column>,
    pub primary_key: Vec<String>,
    /// If there is no usable primary key, the UI must treat the table as read-only.
    pub read_only: bool,
}

/// A single filter predicate coming from the UI. `value`/`value2` are always
/// strings and are bound as *parameters* (never concatenated into SQL).
#[derive(Debug, Clone, Deserialize)]
pub struct Filter {
    /// Column name (must exist in the source; used only as a bracketed identifier).
    pub column: String,
    /// Category so the backend can bind the parameter with the correct SQL type.
    pub category: ColumnCategory,
    /// One of: contains, equals, gte, lte, boolean, is_null, not_null.
    pub op: String,
    /// Primary value (ignored for is_null / not_null).
    #[serde(default)]
    pub value: Option<String>,
}

/// Sort request.
#[derive(Debug, Clone, Deserialize)]
pub struct Sort {
    pub column: String,
    /// "asc" or "desc".
    pub direction: String,
}

/// Parameters shared by table reads and saved-query reads.
#[derive(Debug, Clone, Deserialize)]
pub struct QueryParams {
    /// Raw table or query name (bracketed internally).
    pub source: String,
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub global_search: Option<String>,
    /// Columns the global search should scan (from the UI's visible columns).
    #[serde(default)]
    pub search_columns: Vec<String>,
    #[serde(default)]
    pub sort: Option<Sort>,
    #[serde(default)]
    pub page: usize,
    #[serde(default = "default_page_size")]
    pub page_size: usize,
}

fn default_page_size() -> usize {
    50
}

/// A page of rows. Cells are `Option<String>` (None == SQL NULL).
#[derive(Debug, Clone, Serialize)]
pub struct RowPage {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

/// Result of opening / re-checking a database.
#[derive(Debug, Clone, Serialize)]
pub struct LockStatus {
    /// A `.laccdb` lock file is present next to the database.
    pub laccdb_present: bool,
    /// A test connection succeeded.
    pub connect_ok: bool,
    /// True when we believe the DB is open in Access / exclusively locked.
    pub locked: bool,
    /// Human-readable explanation, if any.
    pub message: Option<String>,
    /// Users/machines currently holding the lock (parsed from the .laccdb file).
    #[serde(default)]
    pub holders: Vec<LockHolder>,
}

/// One entry in the Access lock file (.laccdb): a machine + user pair.
#[derive(Debug, Clone, Serialize)]
pub struct LockHolder {
    pub machine: String,
    pub user: String,
}

/// A single tile on the dashboard, one per table.
#[derive(Debug, Clone, Serialize)]
pub struct TableStat {
    pub name: String,
    pub is_query: bool,
    /// Row count, or None if it could not be determined (e.g. parameter query).
    pub row_count: Option<i64>,
}

/// Cockpit overview of the whole database.
#[derive(Debug, Clone, Serialize)]
pub struct DashboardStats {
    pub db_path: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    /// File modified time as an ISO-ish local string, if available.
    pub file_modified: Option<String>,
    pub table_count: usize,
    pub query_count: usize,
    pub total_rows: i64,
    pub tables: Vec<TableStat>,
    pub queries: Vec<TableStat>,
}

/// One of the most frequent values of a column.
#[derive(Debug, Clone, Serialize)]
pub struct TopValue {
    pub value: Option<String>,
    pub count: i64,
}

/// Statistics for a single column over the current (optionally filtered) view.
#[derive(Debug, Clone, Serialize)]
pub struct ColumnStats {
    pub column: String,
    pub category: ColumnCategory,
    pub total: i64,
    pub non_null: i64,
    pub nulls: i64,
    pub distinct: i64,
    pub min: Option<String>,
    pub max: Option<String>,
    pub avg: Option<f64>,
    pub top_values: Vec<TopValue>,
}
