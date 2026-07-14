export type ColumnCategory = "text" | "integer" | "float" | "boolean" | "date";

export interface Column {
  name: string;
  category: ColumnCategory;
  type_name: string;
  nullable: boolean;
  is_autonumber: boolean;
  is_primary_key: boolean;
  size: number | null;
}

export interface TableSchema {
  name: string;
  columns: Column[];
  primary_key: string[];
  read_only: boolean;
}

export type FilterOp =
  | "contains"
  | "equals"
  | "gte"
  | "lte"
  | "boolean"
  | "is_null"
  | "not_null";

export interface Filter {
  column: string;
  category: ColumnCategory;
  op: FilterOp;
  value?: string | null;
}

export interface Sort {
  column: string;
  direction: "asc" | "desc";
}

export interface QueryParams {
  source: string;
  filters: Filter[];
  global_search?: string | null;
  search_columns: string[];
  sort?: Sort | null;
  page: number;
  page_size: number;
}

export type Cell = string | null;

export interface RowPage {
  columns: string[];
  rows: Cell[][];
  total: number;
  page: number;
  page_size: number;
}

export interface LockHolder {
  machine: string;
  user: string;
}

export interface LockStatus {
  laccdb_present: boolean;
  connect_ok: boolean;
  locked: boolean;
  message: string | null;
  holders: LockHolder[];
}

export interface TableStat {
  name: string;
  is_query: boolean;
  row_count: number | null;
}

export interface DashboardStats {
  db_path: string;
  file_name: string;
  file_size_bytes: number;
  file_modified: string | null;
  table_count: number;
  query_count: number;
  total_rows: number;
  tables: TableStat[];
  queries: TableStat[];
}

export interface TopValue {
  value: string | null;
  count: number;
}

export interface ColumnStats {
  column: string;
  category: ColumnCategory;
  total: number;
  non_null: number;
  nulls: number;
  distinct: number;
  min: string | null;
  max: string | null;
  avg: number | null;
  top_values: TopValue[];
}

export interface OpenResult {
  path: string;
  tables: string[];
  queries: string[];
  lock: LockStatus;
}

export type ErrorKind =
  | "not_connected"
  | "driver_missing"
  | "locked"
  | "parameter_query"
  | "no_primary_key"
  | "odbc"
  | "other";

export interface AppError {
  kind: ErrorKind;
  message: string;
}

export function toAppError(e: unknown): AppError {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    return e as AppError;
  }
  return { kind: "other", message: String(e) };
}
