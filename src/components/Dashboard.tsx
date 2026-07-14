import type { DashboardStats, TableStat } from "../types";
import { formatBytes, formatCompact, formatInt } from "../format";

interface Props {
  stats: DashboardStats | null;
  loading: boolean;
  error: string | null;
  onOpen: (name: string, isQuery: boolean) => void;
  onReload: () => void;
  onBackup: () => void;
}

function StatTile({
  label,
  value,
  hero = false,
}: {
  label: string;
  value: string;
  hero?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-5 py-4 flex flex-col justify-between">
      <div className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold">
        {label}
      </div>
      <div className={`font-semibold text-slate-800 dark:text-slate-100 ${hero ? "text-4xl" : "text-2xl"} mt-1`}>
        {value}
      </div>
    </div>
  );
}

/** Horizontal magnitude bars — one blue hue, lighter track, value in a column. */
function BarList({
  items,
  onOpen,
}: {
  items: TableStat[];
  onOpen: (name: string, isQuery: boolean) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.row_count ?? 0));
  return (
    <div className="space-y-1.5">
      {items.map((it) => {
        const pct = it.row_count != null ? Math.max(2, (it.row_count / max) * 100) : 0;
        return (
          <button
            key={`${it.is_query}-${it.name}`}
            onClick={() => onOpen(it.name, it.is_query)}
            className="w-full flex items-center gap-3 group text-left px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
            title={`${it.name} öffnen`}
          >
            <span className="w-44 shrink-0 truncate text-sm text-slate-700 dark:text-slate-200 group-hover:text-slate-900">
              <span className="mr-1.5 opacity-50">{it.is_query ? "🔍" : "▤"}</span>
              {it.name}
            </span>
            <span className="flex-1 h-5 bg-blue-100 dark:bg-blue-900/40 rounded overflow-hidden">
              <span
                className="block h-full bg-blue-500 rounded group-hover:bg-blue-600 transition-colors"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-24 shrink-0 text-right text-sm tabular-nums text-slate-500 dark:text-slate-400">
              {it.row_count != null ? formatInt(it.row_count) : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Dashboard({ stats, loading, error, onOpen, onReload, onBackup }: Props) {
  if (loading && !stats) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
        Lade Übersicht…
      </div>
    );
  }
  if (error && !stats) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 max-w-lg whitespace-pre-wrap">
          {error}
        </div>
        <button
          onClick={onReload}
          className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/60"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }
  if (!stats) return null;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100 truncate">{stats.file_name}</h1>
          <div className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5" title={stats.db_path}>
            {stats.db_path}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onBackup}
            className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/60"
            title="Kopie der Datenbankdatei mit Zeitstempel speichern"
          >
            💾 Backup
          </button>
          <button
            onClick={onReload}
            disabled={loading}
            className="border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/60 disabled:opacity-50"
          >
            ⟳ Aktualisieren
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatTile label="Datensätze gesamt" value={formatCompact(stats.total_rows)} hero />
        <StatTile label="Tabellen" value={formatInt(stats.table_count)} />
        <StatTile label="Abfragen" value={formatInt(stats.query_count)} />
        <StatTile label="Dateigröße" value={formatBytes(stats.file_size_bytes)} />
      </div>

      {stats.file_modified && (
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-6">
          Zuletzt geändert: {stats.file_modified}
        </div>
      )}

      {/* Tables */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
          Tabellen nach Datensatzanzahl
        </h2>
        {stats.tables.length > 0 ? (
          <BarList items={stats.tables} onOpen={onOpen} />
        ) : (
          <div className="text-sm text-slate-400 dark:text-slate-500">Keine Tabellen gefunden.</div>
        )}
      </section>

      {/* Queries */}
      {stats.queries.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">Gespeicherte Abfragen</h2>
          <BarList items={stats.queries} onOpen={onOpen} />
        </section>
      )}
    </div>
  );
}
