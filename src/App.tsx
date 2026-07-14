import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, type RowValues } from "./api";
import type {
  Filter,
  LockStatus,
  QueryParams,
  RowPage,
  Sort,
  TableSchema,
} from "./types";
import { toAppError } from "./types";
import { Sidebar } from "./components/Sidebar";
import { DataGrid } from "./components/DataGrid";
import { FilterBar } from "./components/FilterBar";
import { RowForm } from "./components/RowForm";
import { DetailPanel } from "./components/DetailPanel";
import { LockBanner } from "./components/LockBanner";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ToastProvider, useToasts } from "./components/Toasts";

const PAGE_SIZE = 50;

interface Selected {
  name: string;
  isQuery: boolean;
}

function AppInner() {
  const { push } = useToasts();

  // Connection state
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [queries, setQueries] = useState<string[]>([]);
  const [lock, setLock] = useState<LockStatus | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [connectError, setConnectError] = useState<string | null>(null);

  // View state
  const [selected, setSelected] = useState<Selected | null>(null);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [pageData, setPageData] = useState<RowPage | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [globalSearch, setGlobalSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Selection / dialogs
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [formInitial, setFormInitial] = useState<RowValues | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRowIdx, setEditingRowIdx] = useState<number | null>(null);
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number[] | null>(null);

  const requestSeq = useRef(0);

  // ---- Global search debounce -------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(globalSearch), 300);
    return () => clearTimeout(t);
  }, [globalSearch]);

  // ---- Connection --------------------------------------------------------
  const openPath = useCallback(
    async (path: string) => {
      setConnecting(true);
      setConnectError(null);
      try {
        const res = await api.openDatabase(path);
        setDbPath(res.path);
        setTables(res.tables);
        setQueries(res.queries);
        setLock(res.lock);
        setSelected(null);
        setSchema(null);
        setPageData(null);
        push(
          "success",
          `Opened ${res.path.split(/[\\/]/).pop()} — ${res.tables.length} tables, ${res.queries.length} queries.`,
        );
      } catch (e) {
        const err = toAppError(e);
        setConnectError(err.message);
        setDbPath(null);
      } finally {
        setConnecting(false);
      }
    },
    [push],
  );

  const pickAndOpen = useCallback(async () => {
    const file = await openDialog({
      multiple: false,
      filters: [
        { name: "Access Database", extensions: ["accdb", "mdb"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (typeof file === "string") await openPath(file);
  }, [openPath]);

  useEffect(() => {
    (async () => {
      try {
        const last = await api.loadLastPath();
        if (last) {
          await openPath(last);
          return;
        }
      } catch {
        /* fall through to welcome screen */
      }
      setConnecting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recheckLock = useCallback(async () => {
    if (!dbPath) return;
    setBusy(true);
    try {
      const status = await api.checkLockStatus();
      setLock(status);
      if (status.connect_ok && !status.laccdb_present) {
        push("success", "Database is no longer locked.");
      } else if (!status.connect_ok) {
        push("error", status.message ?? "Still cannot connect.");
      } else {
        push(
          "info",
          "Lock file still present — the database seems to still be open in Access.",
        );
      }
    } catch (e) {
      push("error", toAppError(e).message);
    } finally {
      setBusy(false);
    }
  }, [dbPath, push]);

  // ---- Selecting a table / query ----------------------------------------
  const selectSource = useCallback(async (name: string, isQuery: boolean) => {
    setSelected({ name, isQuery });
    setSchema(null);
    setPageData(null);
    setViewError(null);
    setFilters([]);
    setGlobalSearch("");
    setDebouncedSearch("");
    setSort(null);
    setPage(0);
    setSelectedRows(new Set());
    setDetailIdx(null);
    try {
      const s = await api.getTableSchema(name, isQuery);
      setSchema(s);
    } catch (e) {
      const err = toAppError(e);
      setViewError(
        err.kind === "parameter_query"
          ? "This query requires parameters or is an action query and cannot be run from this app. Please run it in Microsoft Access."
          : err.message,
      );
    }
  }, []);

  // ---- Data fetching ------------------------------------------------------
  const buildParams = useCallback(
    (forExport = false): QueryParams | null => {
      if (!selected || !schema) return null;
      return {
        source: selected.name,
        filters,
        global_search: debouncedSearch || null,
        search_columns: debouncedSearch ? schema.columns.map((c) => c.name) : [],
        sort,
        page: forExport ? 0 : page,
        page_size: PAGE_SIZE,
      };
    },
    [selected, schema, filters, debouncedSearch, sort, page],
  );

  const refresh = useCallback(async () => {
    const params = buildParams();
    if (!params || !selected) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setViewError(null);
    try {
      const data = selected.isQuery
        ? await api.runSavedQuery(params)
        : await api.queryRows(params);
      if (seq === requestSeq.current) {
        setPageData(data);
        setSelectedRows(new Set());
        setDetailIdx(null);
      }
    } catch (e) {
      if (seq === requestSeq.current) {
        const err = toAppError(e);
        setViewError(
          err.kind === "parameter_query"
            ? "This query requires parameters or is an action query and cannot be run from this app. Please run it in Microsoft Access."
            : err.message,
        );
        setPageData(null);
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [buildParams, selected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Reset to first page when filters/search/sort change.
  useEffect(() => {
    setPage(0);
  }, [filters, debouncedSearch, sort]);

  // ---- Row helpers ---------------------------------------------------------
  const rowToValues = (rowIdx: number): RowValues => {
    const out: RowValues = {};
    if (!pageData) return out;
    pageData.columns.forEach((c, i) => {
      out[c] = pageData.rows[rowIdx]?.[i] ?? null;
    });
    return out;
  };

  const pkValues = (rowIdx: number): RowValues | null => {
    if (!schema || !pageData) return null;
    const out: RowValues = {};
    for (const pk of schema.primary_key) {
      const i = pageData.columns.indexOf(pk);
      if (i === -1) return null;
      out[pk] = pageData.rows[rowIdx]?.[i] ?? null;
    }
    return out;
  };

  const warnIfLocked = () => {
    if (lock && (lock.laccdb_present || !lock.connect_ok)) {
      push(
        "info",
        "Warning: the database appears to be open in Microsoft Access — this write may fail.",
      );
    }
  };

  // ---- CRUD actions ---------------------------------------------------------
  const submitForm = async (values: RowValues) => {
    if (!selected || !schema) return;
    warnIfLocked();
    setBusy(true);
    try {
      if (editingRowIdx !== null) {
        const pks = pkValues(editingRowIdx);
        if (!pks) {
          throw { kind: "no_primary_key", message: "Primary key not found in view." };
        }
        await api.updateRow(selected.name, pks, values);
        push("success", "Row updated.");
      } else {
        await api.insertRow(selected.name, values);
        push("success", "Row created.");
      }
      setFormOpen(false);
      setEditingRowIdx(null);
      await refresh();
    } catch (e) {
      push("error", toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const saveCell = async (rowIdx: number, column: string, value: string | null) => {
    if (!selected || !schema) return;
    warnIfLocked();
    const pks = pkValues(rowIdx);
    if (!pks) {
      push("error", "Cannot edit: primary key columns are not part of this view.");
      return;
    }
    setBusy(true);
    try {
      await api.updateRow(selected.name, pks, { [column]: value });
      push("success", `${column} updated.`);
      await refresh();
    } catch (e) {
      push("error", toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (rowIdxs: number[]) => {
    if (!selected || !schema) return;
    warnIfLocked();
    setBusy(true);
    try {
      const pkRows: RowValues[] = [];
      for (const i of rowIdxs) {
        const pks = pkValues(i);
        if (pks) pkRows.push(pks);
      }
      const n = await api.deleteRows(selected.name, pkRows);
      push("success", `${n} row${n === 1 ? "" : "s"} deleted.`);
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      push("error", toAppError(e).message);
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  };

  // ---- Export ---------------------------------------------------------------
  const exportCsv = async () => {
    if (!selected) return;
    const params = buildParams(true);
    if (!params) return;
    const dest = await saveDialog({
      defaultPath: `${selected.name}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      const n = await api.exportCsv(params, dest);
      push("success", `Exported ${n} rows to ${dest.split(/[\\/]/).pop()}.`);
    } catch (e) {
      push("error", toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Render -----------------------------------------------------------------
  if (connecting) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        Connecting to database…
      </div>
    );
  }

  if (!dbPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-5xl">🗄️</div>
        <h1 className="text-2xl font-semibold">Access DB Browser</h1>
        <p className="text-slate-500 text-sm max-w-md text-center">
          Open a Microsoft Access database (.accdb / .mdb) to browse its tables and
          saved queries, filter and edit data, and export to CSV.
        </p>
        {connectError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 max-w-lg whitespace-pre-wrap">
            {connectError}
          </div>
        )}
        <button
          onClick={pickAndOpen}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-5 py-2.5 font-medium"
        >
          Open database…
        </button>
      </div>
    );
  }

  const detailRow =
    detailIdx !== null && pageData && detailIdx < pageData.rows.length
      ? pageData.rows[detailIdx]
      : null;

  return (
    <div className="h-full flex flex-col">
      {lock && <LockBanner lock={lock} busy={busy} onRetry={recheckLock} />}
      <div className="flex flex-1 min-h-0">
        <Sidebar
          dbPath={dbPath}
          tables={tables}
          queries={queries}
          selected={selected}
          onSelect={selectSource}
          onOpenOther={pickAndOpen}
        />
        <main className="flex-1 min-w-0 flex flex-col p-4">
          {!selected && (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Select a table or query from the sidebar to browse its data.
            </div>
          )}
          {selected && (
            <>
              <div className="flex items-baseline gap-3 pb-2">
                <h1 className="text-xl font-semibold truncate">{selected.name}</h1>
                <span className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                  {selected.isQuery ? "Saved query (read-only)" : "Table"}
                </span>
              </div>
              {schema && (
                <FilterBar
                  schema={schema}
                  filters={filters}
                  globalSearch={globalSearch}
                  selectedCount={selectedRows.size}
                  busy={busy || loading}
                  onFiltersChange={setFilters}
                  onGlobalSearchChange={setGlobalSearch}
                  onNewRow={() => {
                    setEditingRowIdx(null);
                    setFormInitial(null);
                    setFormOpen(true);
                  }}
                  onDeleteSelected={() => setConfirmDelete([...selectedRows])}
                  onExportCsv={exportCsv}
                  onRefresh={refresh}
                />
              )}
              {viewError && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-2 whitespace-pre-wrap">
                  {viewError}
                </div>
              )}
              {schema && pageData && (
                <DataGrid
                  schema={schema}
                  page={pageData}
                  sort={sort}
                  loading={loading}
                  selectedRows={selectedRows}
                  onSortChange={setSort}
                  onPageChange={setPage}
                  onToggleRow={(i) =>
                    setSelectedRows((s) => {
                      const n = new Set(s);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })
                  }
                  onToggleAll={() =>
                    setSelectedRows((s) =>
                      pageData.rows.length > 0 && s.size === pageData.rows.length
                        ? new Set()
                        : new Set(pageData.rows.map((_, i) => i)),
                    )
                  }
                  onEditRow={(i) => {
                    setEditingRowIdx(i);
                    setFormInitial(rowToValues(i));
                    setFormOpen(true);
                  }}
                  onDeleteRow={(i) => setConfirmDelete([i])}
                  onShowDetail={(i) => setDetailIdx(i)}
                  onCellSave={saveCell}
                />
              )}
              {!schema && !viewError && (
                <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                  Loading schema…
                </div>
              )}
            </>
          )}
        </main>
        {detailRow && schema && pageData && (
          <DetailPanel
            schema={schema}
            columns={pageData.columns}
            row={detailRow}
            onClose={() => setDetailIdx(null)}
            onEdit={
              schema.read_only
                ? undefined
                : () => {
                    setEditingRowIdx(detailIdx);
                    setFormInitial(rowToValues(detailIdx!));
                    setFormOpen(true);
                  }
            }
          />
        )}
      </div>

      {formOpen && schema && (
        <RowForm
          schema={schema}
          initial={formInitial}
          busy={busy}
          onSubmit={submitForm}
          onClose={() => {
            setFormOpen(false);
            setEditingRowIdx(null);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete rows"
        message={`Are you sure you want to delete ${confirmDelete?.length ?? 0} row${
          (confirmDelete?.length ?? 0) === 1 ? "" : "s"
        }? This cannot be undone.`}
        confirmLabel={`Delete ${confirmDelete?.length ?? 0} row${
          (confirmDelete?.length ?? 0) === 1 ? "" : "s"
        }`}
        danger
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
