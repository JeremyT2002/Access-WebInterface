import { useEffect, useRef, useState } from "react";
import type { Cell, Column, RowPage, Sort, TableSchema } from "../types";

interface Props {
  schema: TableSchema;
  page: RowPage;
  sort: Sort | null;
  loading: boolean;
  selectedRows: Set<number>;
  onSortChange: (sort: Sort | null) => void;
  onPageChange: (page: number) => void;
  onToggleRow: (index: number) => void;
  onToggleAll: () => void;
  onEditRow: (index: number) => void;
  onDeleteRow: (index: number) => void;
  onShowDetail: (index: number) => void;
  onCellSave: (rowIndex: number, column: string, value: string | null) => void;
}

function cellDisplay(v: Cell, col: Column | undefined): string {
  if (v === null) return "";
  if (col?.category === "boolean") {
    return ["1", "-1", "true", "yes"].includes(v.toLowerCase()) ? "✓" : "✗";
  }
  return v;
}

export function DataGrid({
  schema,
  page,
  sort,
  loading,
  selectedRows,
  onSortChange,
  onPageChange,
  onToggleRow,
  onToggleAll,
  onEditRow,
  onDeleteRow,
  onShowDetail,
  onCellSave,
}: Props) {
  const colByName = new Map(schema.columns.map((c) => [c.name, c]));
  const writable = !schema.read_only;

  // Inline editing state
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Reset inline edit when the data changes underneath us.
  useEffect(() => {
    setEditing(null);
  }, [page]);

  const startEdit = (rowIdx: number, colName: string) => {
    if (!writable) return;
    const col = colByName.get(colName);
    if (!col || col.is_autonumber) return;
    const colIdx = page.columns.indexOf(colName);
    const raw = page.rows[rowIdx]?.[colIdx] ?? null;
    if (col.category === "boolean") {
      // Toggle booleans immediately instead of opening a text editor.
      const cur = raw !== null && ["1", "-1", "true", "yes"].includes(raw.toLowerCase());
      onCellSave(rowIdx, colName, cur ? "false" : "true");
      return;
    }
    let v = raw ?? "";
    if (col.category === "date") {
      const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
      if (m) v = `${m[1]} ${m[2]}`;
    }
    setEditing({ row: rowIdx, col: colName });
    setEditValue(v);
  };

  const commitEdit = () => {
    if (!editing) return;
    const v = editValue;
    onCellSave(editing.row, editing.col, v === "" ? null : v);
    setEditing(null);
  };

  const sortIndicator = (colName: string) => {
    if (sort?.column !== colName) return <span className="opacity-20">↕</span>;
    return sort.direction === "asc" ? <span>↑</span> : <span>↓</span>;
  };

  const toggleSort = (colName: string) => {
    if (sort?.column !== colName) onSortChange({ column: colName, direction: "asc" });
    else if (sort.direction === "asc") onSortChange({ column: colName, direction: "desc" });
    else onSortChange(null);
  };

  const totalPages = Math.max(1, Math.ceil(page.total / page.page_size));
  const allSelected = page.rows.length > 0 && page.rows.every((_, i) => selectedRows.has(i));

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-auto border border-slate-200 rounded-lg bg-white relative">
        {loading && (
          <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center text-sm text-slate-500">
            Loading…
          </div>
        )}
        <table className="min-w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-slate-50 z-[5] shadow-[0_1px_0_#e2e8f0]">
            <tr>
              {writable && (
                <th className="px-2 py-2 w-8 text-center">
                  <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
                </th>
              )}
              {page.columns.map((c) => {
                const col = colByName.get(c);
                return (
                  <th
                    key={c}
                    onClick={() => toggleSort(c)}
                    className="px-3 py-2 text-left font-semibold text-slate-600 cursor-pointer select-none hover:bg-slate-100 whitespace-nowrap"
                    title={`${col?.type_name ?? ""}${col?.is_primary_key ? " (primary key)" : ""}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col?.is_primary_key && <span className="text-amber-500">🔑</span>}
                      {c} {sortIndicator(c)}
                    </span>
                  </th>
                );
              })}
              {writable && <th className="px-2 py-2 w-24 text-right pr-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row, ri) => (
              <tr
                key={ri}
                className={`border-t border-slate-100 hover:bg-blue-50/50 ${
                  selectedRows.has(ri) ? "bg-blue-50" : ""
                }`}
              >
                {writable && (
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(ri)}
                      onChange={() => onToggleRow(ri)}
                    />
                  </td>
                )}
                {page.columns.map((c, ci) => {
                  const col = colByName.get(c);
                  const isEditing = editing?.row === ri && editing.col === c;
                  return (
                    <td
                      key={c}
                      className={`px-3 py-1.5 max-w-xs truncate ${
                        row[ci] === null ? "text-slate-300 italic" : ""
                      } ${writable && !col?.is_autonumber ? "cursor-cell" : ""}`}
                      onClick={() => onShowDetail(ri)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEdit(ri, c);
                      }}
                      title={row[ci] ?? "NULL"}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          className="w-full border border-blue-400 rounded px-1 py-0.5 text-sm bg-white"
                          value={editValue}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          onBlur={() => setEditing(null)}
                        />
                      ) : row[ci] === null ? (
                        "NULL"
                      ) : (
                        cellDisplay(row[ci], col)
                      )}
                    </td>
                  );
                })}
                {writable && (
                  <td className="px-2 py-1.5 text-right whitespace-nowrap pr-3">
                    <button
                      className="text-blue-600 hover:bg-blue-100 rounded px-1.5 py-0.5 text-xs mr-1"
                      title="Edit row"
                      onClick={() => onEditRow(ri)}
                    >
                      ✎ Edit
                    </button>
                    <button
                      className="text-rose-600 hover:bg-rose-100 rounded px-1.5 py-0.5 text-xs"
                      title="Delete row"
                      onClick={() => onDeleteRow(ri)}
                    >
                      🗑
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {page.rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={page.columns.length + (writable ? 2 : 0)}
                  className="px-3 py-8 text-center text-slate-400"
                >
                  No rows match the current view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      <div className="flex items-center justify-between py-2 text-sm text-slate-600">
        <div>
          {page.total} row{page.total === 1 ? "" : "s"}
          {selectedRows.size > 0 && ` · ${selectedRows.size} selected`}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
            disabled={page.page === 0}
            onClick={() => onPageChange(0)}
          >
            «
          </button>
          <button
            className="px-2.5 py-1 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
            disabled={page.page === 0}
            onClick={() => onPageChange(page.page - 1)}
          >
            ‹ Prev
          </button>
          <span>
            Page {page.page + 1} / {totalPages}
          </span>
          <button
            className="px-2.5 py-1 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
            disabled={page.page + 1 >= totalPages}
            onClick={() => onPageChange(page.page + 1)}
          >
            Next ›
          </button>
          <button
            className="px-2.5 py-1 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
            disabled={page.page + 1 >= totalPages}
            onClick={() => onPageChange(totalPages - 1)}
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
}
