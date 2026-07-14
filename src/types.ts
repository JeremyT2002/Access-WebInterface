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

export interface LockStatus {
  laccdb_present: boolean;
  connect_ok: boolean;
  locked: boolean;
  message: string | null;
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
