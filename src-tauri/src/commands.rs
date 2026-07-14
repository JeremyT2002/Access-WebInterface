use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::*;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// App-wide state: the currently opened database path.
#[derive(Default)]
pub struct AppState {
    pub db_path: Mutex<Option<String>>,
}

fn current_path(state: &State<'_, AppState>) -> AppResult<String> {
    state
        .db_path
        .lock()
        .map_err(|_| AppError::other("Internal state lock poisoned"))?
        .clone()
        .ok_or_else(AppError::not_connected)
}

// ---------------------------------------------------------------------------
// Settings persistence (remember last used .accdb path)
// ---------------------------------------------------------------------------

fn settings_file(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::other(format!("No config dir: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("settings.json"))
}

fn save_last_path(app: &AppHandle, path: &str) {
    if let Ok(file) = settings_file(app) {
        let _ = std::fs::write(
            file,
            serde_json::json!({ "last_db_path": path }).to_string(),
        );
    }
}

#[tauri::command]
pub fn load_last_path(app: AppHandle) -> Option<String> {
    let file = settings_file(&app).ok()?;
    let content = std::fs::read_to_string(file).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
    let p = v.get("last_db_path")?.as_str()?.to_string();
    if std::path::Path::new(&p).exists() {
        Some(p)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Connection / introspection
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct OpenResult {
    pub path: String,
    pub tables: Vec<String>,
    pub queries: Vec<String>,
    pub lock: LockStatus,
}

#[tauri::command]
pub fn open_database(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<OpenResult> {
    if !std::path::Path::new(&path).exists() {
        return Err(AppError::other(format!("File not found: {path}")));
    }
    let conn = db::connect(&path)?;
    let tables = db::list_tables(&conn)?;
    let queries = db::list_queries(&conn)?;
    drop(conn);

    *state
        .db_path
        .lock()
        .map_err(|_| AppError::other("Internal state lock poisoned"))? = Some(path.clone());
    save_last_path(&app, &path);

    let lock = db::check_lock_status(&path);
    Ok(OpenResult {
        path,
        tables,
        queries,
        lock,
    })
}

#[tauri::command]
pub fn list_tables(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let path = current_path(&state)?;
    let conn = db::connect(&path)?;
    db::list_tables(&conn)
}

#[tauri::command]
pub fn list_queries(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let path = current_path(&state)?;
    let conn = db::connect(&path)?;
    db::list_queries(&conn)
}

#[tauri::command]
pub fn get_table_schema(
    state: State<'_, AppState>,
    table: String,
    is_query: Option<bool>,
) -> AppResult<TableSchema> {
    let path = current_path(&state)?;
    let conn = db::connect(&path)?;
    db::get_table_schema(&conn, &table, is_query.unwrap_or(false))
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn query_rows(state: State<'_, AppState>, params: QueryParams) -> AppResult<RowPage> {
    let path = current_path(&state)?;
    let conn = db::connect(&path)?;
    db::query_rows(&conn, &params)
}

/// Saved queries share the read path — the source is just bracketed
/// differently on the SQL level (identically, in fact).
#[tauri::command]
pub fn run_saved_query(state: State<'_, AppState>, params: QueryParams) -> AppResult<RowPage> {
    let path = current_path(&state)?;
    let conn = db::connect(&path)?;
    db::query_rows(&conn, &params)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn insert_row(
    state: State<'_, AppState>,
    table: String,
    values: HashMap<String, Option<String>>,
) -> AppResult<()> {
    let path = current_path(&state)?;
    let conn = db::connect(&path)?;
    db::insert_row(&conn, &table, &values)
}

#[tauri::command]
pub fn update_row(
    state: State<'_, AppState>,
    table: String,
    pk_values: HashMap<String, Option<String>>,
    new_values: HashMap<String, Option<String>>,
) -> AppResult<()> {
    let path = current_path(&state)?;
    let conn = db::connect(&path)?;
    db::update_row(&conn, &table, &pk_values, &new_values)
}

#[tauri::command]
pub fn delete_rows(
    state: State<'_, AppState>,
    table: String,
    pk_rows: Vec<HashMap<String, Option<String>>>,
) -> AppResult<usize> {
    let path = current_path(&state)?;
    let conn = db::connect(&path)?;
    db::delete_rows(&conn, &table, &pk_rows)
}

// ---------------------------------------------------------------------------
// Export / lock
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn export_csv(
    state: State<'_, AppState>,
    params: QueryParams,
    dest_path: String,
) -> AppResult<usize> {
    let path = current_path(&state)?;
    let conn = db::connect(&path)?;
    db::export_csv(&conn, &params, &dest_path)
}

#[tauri::command]
pub fn check_lock_status(state: State<'_, AppState>) -> AppResult<LockStatus> {
    let path = current_path(&state)?;
    Ok(db::check_lock_status(&path))
}
