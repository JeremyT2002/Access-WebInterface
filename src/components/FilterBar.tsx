import { useState } from "react";
import type { Column, ColumnCategory, Filter, FilterOp, TableSchema } from "../types";

interface Props {
  schema: TableSchema;
  filters: Filter[];
  globalSearch: string;
  selectedCount: number;
  busy: boolean;
  onFiltersChange: (filters: Filter[]) => void;
  onGlobalSearchChange: (s: string) => void;
  onNewRow: () => void;
  onDeleteSelected: () => void;
  onExportCsv: () => void;
  onRefresh: () => void;
}

const OPS_BY_CATEGORY: Record<ColumnCategory, { op: FilterOp; label: string }[]> = {
  text: [
    { op: "contains", label: "contains" },
    { op: "equals", label: "equals" },
    { op: "is_null", label: "is empty (NULL)" },
    { op: "not_null", label: "is not empty" },
  ],
  integer: [
    { op: "equals", label: "=" },
    { op: "gte", label: "≥" },
    { op: "lte", label: "≤" },
    { op: "is_null", label: "is NULL" },
    { op: "not_null", label: "is not NULL" },
  ],
  float: [
    { op: "equals", label: "=" },
    { op: "gte", label: "≥" },
    { op: "lte", label: "≤" },
    { op: "is_null", label: "is NULL" },
    { op: "not_null", label: "is not NULL" },
  ],
  date: [
    { op: "gte", label: "on/after" },
    { op: "lte", label: "on/before" },
    { op: "is_null", label: "is NULL" },
    { op: "not_null", label: "is not NULL" },
  ],
  boolean: [
    { op: "boolean", label: "is" },
    { op: "is_null", label: "is NULL" },
    { op: "not_null", label: "is not NULL" },
  ],
};

function opLabel(f: Filter): string {
  const found = OPS_BY_CATEGORY[f.category].find((o) => o.op === f.op);
  return found?.label ?? f.op;
}

export function FilterBar({
  schema,
  filters,
  globalSearch,
  selectedCount,
  busy,
  onFiltersChange,
  onGlobalSearchChange,
  onNewRow,
  onDeleteSelected,
  onExportCsv,
  onRefresh,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newCol, setNewCol] = useState("");
  const [newOp, setNewOp] = useState<FilterOp>("contains");
  const [newValue, setNewValue] = useState("");

  const col: Column | undefined = schema.columns.find((c) => c.name === newCol);
  const ops = col ? OPS_BY_CATEGORY[col.category] : [];
  const needsValue = newOp !== "is_null" && newOp !== "not_null";

  const startAdd = () => {
    const first = schema.columns[0];
    setNewCol(first?.name ?? "");
    setNewOp(first ? OPS_BY_CATEGORY[first.category][0].op : "contains");
    setNewValue("");
    setAdding(true);
  };

  const commitAdd = () => {
    if (!col) return;
    if (needsValue && newOp !== "boolean" && newValue.trim() === "") return;
    onFiltersChange([
      ...filters,
      {
        column: col.name,
        category: col.category,
        op: newOp,
        value: needsValue ? (newOp === "boolean" ? newValue || "true" : newValue) : null,
      },
    ]);
    setAdding(false);
  };

  const removeFilter = (idx: number) => {
    onFiltersChange(filters.filter((_, i) => i !== idx));
  };

  const valueInput = () => {
    if (!col || !needsValue) return null;
    if (newOp === "boolean" || col.category === "boolean") {
      return (
        <select
          className="border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm"
          value={newValue || "true"}
          onChange={(e) => setNewValue(e.target.value)}
        >
          <option value="true">true / checked</option>
          <option value="false">false / unchecked</option>
        </select>
      );
    }
    const type =
      col.category === "integer" || col.category === "float"
        ? "number"
        : col.category === "date"
          ? "datetime-local"
          : "text";
    return (
      <input
        type={type}
        step={col.category === "float" ? "any" : undefined}
        className="border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm w-44"
        placeholder="Value…"
        value={newValue}
        onChange={(e) => setNewValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commitAdd()}
      />
    );
  };

  return (
    <div className="space-y-2 pb-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {!schema.read_only && (
          <button
            onClick={onNewRow}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-3 py-1.5"
          >
            + New Row
          </button>
        )}
        {!schema.read_only && selectedCount > 0 && (
          <button
            onClick={onDeleteSelected}
            className="bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium rounded-lg px-3 py-1.5"
          >
            Delete selected ({selectedCount})
          </button>
        )}
        <input
          type="text"
          value={globalSearch}
          onChange={(e) => onGlobalSearchChange(e.target.value)}
          placeholder="Search all columns…"
          className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={startAdd}
          className="border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-sm rounded-lg px-3 py-1.5"
        >
          + Filter
        </button>
        <div className="flex-1" />
        <button
          onClick={onRefresh}
          disabled={busy}
          className="border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-sm rounded-lg px-3 py-1.5 disabled:opacity-50"
          title="Reload data"
        >
          ⟳ Refresh
        </button>
        <button
          onClick={onExportCsv}
          disabled={busy}
          className="border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-sm rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* Read-only hint */}
      {schema.read_only && (
        <div className="text-xs bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-500 dark:text-slate-400">
          {schema.primary_key.length === 0 && !schema.name.startsWith("(")
            ? "This view is read-only. " : ""}
          {schema.columns.length > 0 && schema.primary_key.length === 0
            ? "Query results and tables without a primary key cannot be edited here, because rows cannot be identified unambiguously for updates or deletes."
            : ""}
        </div>
      )}

      {/* Add-filter row */}
      {adding && (
        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
          <select
            className="border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm"
            value={newCol}
            onChange={(e) => {
              const c = schema.columns.find((x) => x.name === e.target.value);
              setNewCol(e.target.value);
              if (c) setNewOp(OPS_BY_CATEGORY[c.category][0].op);
              setNewValue("");
            }}
          >
            {schema.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm"
            value={newOp}
            onChange={(e) => setNewOp(e.target.value as FilterOp)}
          >
            {ops.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>
          {valueInput()}
          <button
            onClick={commitAdd}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg px-3 py-1.5"
          >
            Apply
          </button>
          <button
            onClick={() => setAdding(false)}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Active filter chips */}
      {filters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {filters.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-800 text-xs rounded-full px-3 py-1"
            >
              <strong>{f.column}</strong> {opLabel(f)}{" "}
              {f.op !== "is_null" && f.op !== "not_null" && <em>{f.value}</em>}
              <button
                className="hover:text-blue-950 font-bold"
                onClick={() => removeFilter(i)}
                title="Remove filter"
              >
                ✕
              </button>
            </span>
          ))}
          <button
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline"
            onClick={() => onFiltersChange([])}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
