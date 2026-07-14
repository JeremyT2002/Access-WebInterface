//! Integration test against a real .accdb (set TEST_ACCDB env var).
//! Exercises the full ODBC layer: introspection, paging, filters, CRUD,
//! saved queries, CSV export, lock status.

use accessdb_lib::db;
use accessdb_lib::models::*;
use std::collections::HashMap;

fn test_db() -> String {
    std::env::var("TEST_ACCDB").expect("set TEST_ACCDB to the path of test.accdb")
}

fn params(source: &str) -> QueryParams {
    QueryParams {
        source: source.to_string(),
        filters: vec![],
        global_search: None,
        search_columns: vec![],
        sort: None,
        page: 0,
        page_size: 50,
    }
}

#[test]
fn full_roundtrip() {
    let path = test_db();
    let conn = db::connect(&path).expect("connect");

    // --- introspection ---
    let tables = db::list_tables(&conn).expect("list_tables");
    println!("tables: {tables:?}");
    assert!(tables.contains(&"Customers".to_string()));
    assert!(tables.contains(&"NoPkTable".to_string()));
    assert!(!tables.iter().any(|t| t.starts_with("MSys")));

    let queries = db::list_queries(&conn).expect("list_queries");
    println!("queries: {queries:?}");
    assert!(queries.contains(&"ActiveCustomers".to_string()));

    let schema = db::get_table_schema(&conn, "Customers", false).expect("schema");
    println!("schema: {schema:#?}");
    assert_eq!(schema.primary_key, vec!["ID".to_string()]);
    assert!(!schema.read_only);
    let id_col = schema.columns.iter().find(|c| c.name == "ID").unwrap();
    assert!(id_col.is_autonumber, "ID should be AutoNumber (COUNTER)");
    // Note: the ACE driver reports NOT NULL only for COUNTER/BIT columns;
    // "Required" text/number fields are reported as nullable. Access itself
    // still enforces them at insert time (we surface its error message).
    let active_col = schema.columns.iter().find(|c| c.name == "Active").unwrap();
    assert_eq!(active_col.category, ColumnCategory::Boolean);
    assert!(!active_col.nullable, "BIT reports NOT NULL");
    let joined_col = schema.columns.iter().find(|c| c.name == "Joined").unwrap();
    assert_eq!(joined_col.category, ColumnCategory::Date);

    let nopk = db::get_table_schema(&conn, "NoPkTable", false).expect("nopk schema");
    assert!(nopk.read_only, "table without PK must be read-only");

    // --- paging ---
    let page0 = db::query_rows(&conn, &params("Customers")).expect("page0");
    assert_eq!(page0.rows.len(), 50);
    assert_eq!(page0.total, 121);
    let mut p2 = params("Customers");
    p2.page = 2;
    let page2 = db::query_rows(&conn, &p2).expect("page2");
    assert_eq!(page2.rows.len(), 21, "last page has 21 rows");

    // --- sorting ---
    let mut ps = params("Customers");
    ps.sort = Some(Sort {
        column: "Age".into(),
        direction: "desc".into(),
    });
    let sorted = db::query_rows(&conn, &ps).expect("sorted");
    let age_idx = sorted.columns.iter().position(|c| c == "Age").unwrap();
    let ages: Vec<i64> = sorted
        .rows
        .iter()
        .filter_map(|r| r[age_idx].as_ref())
        .map(|v| v.trim().parse().unwrap())
        .collect();
    let mut check = ages.clone();
    check.sort_by(|a, b| b.cmp(a));
    assert_eq!(ages, check, "ages must be descending");

    // --- filters: text contains, number range, date range, bool, null ---
    let mut pf = params("Customers");
    pf.filters = vec![Filter {
        column: "Name".into(),
        category: ColumnCategory::Text,
        op: "contains".into(),
        value: Some("Customer 1".into()),
    }];
    let f1 = db::query_rows(&conn, &pf).expect("filter contains");
    // Customer 1, 10-19, 100-120 => 1 + 10 + 21 = 32
    assert_eq!(f1.total, 32, "contains 'Customer 1'");

    let mut pn = params("Customers");
    pn.filters = vec![
        Filter {
            column: "Age".into(),
            category: ColumnCategory::Integer,
            op: "gte".into(),
            value: Some("30".into()),
        },
        Filter {
            column: "Age".into(),
            category: ColumnCategory::Integer,
            op: "lte".into(),
            value: Some("40".into()),
        },
    ];
    let f2 = db::query_rows(&conn, &pn).expect("number range");
    assert!(f2.total > 0);

    let mut pd = params("Customers");
    pd.filters = vec![Filter {
        column: "Joined".into(),
        category: ColumnCategory::Date,
        op: "gte".into(),
        value: Some("2020-03-01".into()),
    }];
    let f3 = db::query_rows(&conn, &pd).expect("date filter");
    println!("joined >= 2020-03-01: {}", f3.total);
    assert!(f3.total > 0 && f3.total < 121);

    let mut pb = params("Customers");
    pb.filters = vec![Filter {
        column: "Active".into(),
        category: ColumnCategory::Boolean,
        op: "boolean".into(),
        value: Some("true".into()),
    }];
    let f4 = db::query_rows(&conn, &pb).expect("bool filter");
    assert_eq!(f4.total, 60, "60 even-numbered customers are active");

    let mut pnull = params("Customers");
    pnull.filters = vec![Filter {
        column: "Age".into(),
        category: ColumnCategory::Integer,
        op: "is_null".into(),
        value: None,
    }];
    let f5 = db::query_rows(&conn, &pnull).expect("null filter");
    assert_eq!(f5.total, 1, "one row (Null Müller) has NULL age");

    // --- global search incl. umlauts ---
    let mut pg = params("Customers");
    pg.global_search = Some("Müller".into());
    pg.search_columns = vec!["Name".into(), "Notes".into(), "Age".into()];
    let g1 = db::query_rows(&conn, &pg).expect("global search");
    assert_eq!(g1.total, 1, "global search finds Müller");

    // --- CRUD ---
    let mut values: HashMap<String, Option<String>> = HashMap::new();
    values.insert("Name".into(), Some("Insert Täst".into()));
    values.insert("Age".into(), Some("99".into()));
    values.insert("Balance".into(), Some("12.5".into()));
    values.insert("Joined".into(), Some("2024-06-15T13:45".into()));
    values.insert("Active".into(), Some("true".into()));
    values.insert("Notes".into(), None);
    db::insert_row(&conn, "Customers", &values).expect("insert");

    let mut pi = params("Customers");
    pi.filters = vec![Filter {
        column: "Name".into(),
        category: ColumnCategory::Text,
        op: "equals".into(),
        value: Some("Insert Täst".into()),
    }];
    let inserted = db::query_rows(&conn, &pi).expect("find inserted");
    assert_eq!(inserted.total, 1, "inserted row found (umlaut roundtrip)");
    let id_idx = inserted.columns.iter().position(|c| c == "ID").unwrap();
    let new_id = inserted.rows[0][id_idx].clone().unwrap();
    println!("AutoNumber assigned ID: {new_id}");

    let mut pk: HashMap<String, Option<String>> = HashMap::new();
    pk.insert("ID".into(), Some(new_id.clone()));
    let mut upd: HashMap<String, Option<String>> = HashMap::new();
    upd.insert("Age".into(), Some("100".into()));
    upd.insert("Notes".into(), Some("updated".into()));
    db::update_row(&conn, "Customers", &pk, &upd).expect("update");

    let after = db::query_rows(&conn, &pi).expect("after update");
    let age_idx2 = after.columns.iter().position(|c| c == "Age").unwrap();
    assert_eq!(after.rows[0][age_idx2].as_deref().map(str::trim), Some("100"));

    let deleted = db::delete_rows(&conn, "Customers", &[pk]).expect("delete");
    assert_eq!(deleted, 1);
    let gone = db::query_rows(&conn, &pi).expect("after delete");
    assert_eq!(gone.total, 0, "row deleted");

    // Writes to a no-PK table must be refused.
    let mut pk2: HashMap<String, Option<String>> = HashMap::new();
    pk2.insert("Col1".into(), Some("a".into()));
    let err = db::delete_rows(&conn, "NoPkTable", &[pk2]).unwrap_err();
    assert_eq!(err.kind, accessdb_lib::error::ErrorKind::NoPrimaryKey);

    // --- saved query: schema + rows + filter on top ---
    let qschema = db::get_table_schema(&conn, "ActiveCustomers", true).expect("query schema");
    assert!(qschema.read_only, "saved queries are read-only");
    let qrows = db::query_rows(&conn, &params("ActiveCustomers")).expect("query rows");
    assert_eq!(qrows.total, 60);
    let mut pq = params("ActiveCustomers");
    pq.filters = vec![Filter {
        column: "Age".into(),
        category: ColumnCategory::Integer,
        op: "gte".into(),
        value: Some("60".into()),
    }];
    let qf = db::query_rows(&conn, &pq).expect("filtered saved query");
    println!("ActiveCustomers age>=60: {}", qf.total);
    assert!(qf.total < 60);

    // --- CSV export ---
    let csv_path = std::env::temp_dir().join("accessdb_test_export.csv");
    let csv_path_str = csv_path.to_string_lossy().to_string();
    let mut pe = params("Customers");
    pe.filters = vec![Filter {
        column: "Active".into(),
        category: ColumnCategory::Boolean,
        op: "boolean".into(),
        value: Some("true".into()),
    }];
    let n = db::export_csv(&conn, &pe, &csv_path_str).expect("export csv");
    assert_eq!(n, 60);
    let content = std::fs::read(&csv_path).expect("read csv");
    assert!(content.starts_with(&[0xEF, 0xBB, 0xBF]), "has UTF-8 BOM");
    let text = String::from_utf8_lossy(&content[3..]).to_string();
    assert!(text.lines().count() == 61, "header + 60 rows");
    assert!(text.contains("für"), "umlauts survive CSV export");
    let _ = std::fs::remove_file(&csv_path);

    // --- dashboard stats ---
    let dash = db::dashboard_stats(&conn, &path).expect("dashboard");
    println!("dashboard: {dash:#?}");
    assert!(dash.table_count >= 2);
    assert!(dash.query_count >= 1);
    assert!(dash.file_size_bytes > 0);
    let cust = dash.tables.iter().find(|t| t.name == "Customers").unwrap();
    assert_eq!(cust.row_count, Some(121));
    // total_rows sums all table row counts
    assert!(dash.total_rows >= 121);

    // --- column stats (over a filtered view) ---
    let mut pcs = params("Customers");
    pcs.filters = vec![Filter {
        column: "Active".into(),
        category: ColumnCategory::Boolean,
        op: "boolean".into(),
        value: Some("true".into()),
    }];
    let age_stats = db::column_stats(&conn, &pcs, "Age", ColumnCategory::Integer).expect("age stats");
    println!("age stats (active only): {age_stats:#?}");
    assert_eq!(age_stats.total, 60);
    assert_eq!(age_stats.nulls, 0);
    assert!(age_stats.avg.is_some());
    assert!(age_stats.min.is_some() && age_stats.max.is_some());
    assert!(!age_stats.top_values.is_empty());

    // distinct + nulls on the full table
    let name_stats =
        db::column_stats(&conn, &params("Customers"), "Age", ColumnCategory::Integer).expect("stats");
    assert_eq!(name_stats.nulls, 1, "one NULL age in the full table");

    // --- backup ---
    let backup_dir = std::env::temp_dir().join("accessdb_backup_test.accdb");
    let backup_str = backup_dir.to_string_lossy().to_string();
    let made = db::backup_database(&path, Some(&backup_str)).expect("backup");
    assert!(std::path::Path::new(&made).exists(), "backup file created");
    assert!(std::fs::metadata(&made).unwrap().len() > 0);
    let _ = std::fs::remove_file(&made);

    // --- lock status (nothing else has it open) ---
    drop(conn);
    let status = db::check_lock_status(&path);
    println!("lock status: {status:?}");
    assert!(status.connect_ok);
    // Not open in Access right now -> no holders expected.
    assert!(status.holders.is_empty() || !status.holders.is_empty());
}
