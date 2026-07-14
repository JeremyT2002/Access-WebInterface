mod commands;
pub mod db;
pub mod error;
pub mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_last_path,
            commands::open_database,
            commands::list_tables,
            commands::list_queries,
            commands::get_table_schema,
            commands::query_rows,
            commands::run_saved_query,
            commands::insert_row,
            commands::update_row,
            commands::delete_rows,
            commands::export_csv,
            commands::check_lock_status,
            commands::get_dashboard_stats,
            commands::backup_database,
            commands::get_column_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
