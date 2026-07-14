import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnCategory,
  ColumnStats,
  DashboardStats,
  LockStatus,
  OpenResult,
  QueryParams,
  RowPage,
  TableSchema,
} from "./types";

export type RowValues = Record<string, string | null>;

export const api = {
  loadLastPath: () => invoke<string | null>("load_last_path"),
  openDatabase: (path: string) => invoke<OpenResult>("open_database", { path }),
  listTables: () => invoke<string[]>("list_tables"),
  listQueries: () => invoke<string[]>("list_queries"),
  getTableSchema: (table: string, isQuery: boolean) =>
    invoke<TableSchema>("get_table_schema", { table, isQuery }),
  queryRows: (params: QueryParams) => invoke<RowPage>("query_rows", { params }),
  runSavedQuery: (params: QueryParams) =>
    invoke<RowPage>("run_saved_query", { params }),
  insertRow: (table: string, values: RowValues) =>
    invoke<void>("insert_row", { table, values }),
  updateRow: (table: string, pkValues: RowValues, newValues: RowValues) =>
    invoke<void>("update_row", { table, pkValues, newValues }),
  deleteRows: (table: string, pkRows: RowValues[]) =>
    invoke<number>("delete_rows", { table, pkRows }),
  exportCsv: (params: QueryParams, destPath: string) =>
    invoke<number>("export_csv", { params, destPath }),
  checkLockStatus: () => invoke<LockStatus>("check_lock_status"),
  getDashboardStats: () => invoke<DashboardStats>("get_dashboard_stats"),
  backupDatabase: (destPath?: string) =>
    invoke<string>("backup_database", { destPath: destPath ?? null }),
  getColumnStats: (params: QueryParams, column: string, category: ColumnCategory) =>
    invoke<ColumnStats>("get_column_stats", { params, column, category }),
};
