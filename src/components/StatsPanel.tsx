import { useEffect, useState } from "react";
import { api } from "../api";
import type { ColumnCategory, ColumnStats, QueryParams } from "../types";
import { toAppError } from "../types";
import { formatInt } from "../format";

interface Props {
  params: QueryParams;
  column: string;
  category: ColumnCategory;
  onClose: () => void;
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold">
        {label}
      </div>
      <div className="text-lg font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{value}</div>
    </div>
  );
}

function fmtNum(n: number): string {
  return Math.abs(n) >= 1000 || Number.isInteger(n)
    ? formatInt(Math.round(n * 100) / 100)
    : n.toFixed(2);
}

export function StatsPanel({ params, column, category, onClose }: Props) {
  const [stats, setStats] = useState<ColumnStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .getColumnStats(params, column, category)
      .then((s) => alive && setStats(s))
      .catch((e) => alive && setError(toAppError(e).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column]);

  const fillPct =
    stats && stats.total > 0 ? Math.round((stats.non_null / stats.total) * 100) : 0;
  const maxTop = stats ? Math.max(1, ...stats.top_values.map((t) => t.count)) : 1;
  const numeric = category === "integer" || category === "float";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Statistik: {column}</h2>
            <div className="text-xs text-slate-400 dark:text-slate-500">
              {category}
              {params.filters.length > 0 || params.global_search
                ? " · über die aktuell gefilterte Ansicht"
                : ""}
            </div>
          </div>
          <button className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {loading && <div className="text-sm text-slate-400 dark:text-slate-500 py-8 text-center">Berechne…</div>}
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 whitespace-pre-wrap">
              {error}
            </div>
          )}
          {stats && !loading && (
            <div className="space-y-5">
              {/* KPI tiles */}
              <div className="grid grid-cols-2 gap-2">
                <KpiTile label="Datensätze" value={formatInt(stats.total)} />
                <KpiTile label="Eindeutige Werte" value={formatInt(stats.distinct)} />
                <KpiTile label="Gefüllt" value={`${formatInt(stats.non_null)} (${fillPct}%)`} />
                <KpiTile label="Leer (NULL)" value={formatInt(stats.nulls)} />
              </div>

              {/* Fill meter */}
              <div>
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                  <span>Befüllungsgrad</span>
                  <span className="tabular-nums">{fillPct}%</span>
                </div>
                <div className="h-2.5 bg-blue-100 dark:bg-blue-900/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
              </div>

              {/* Min / Max / Avg */}
              {(stats.min != null || stats.max != null || stats.avg != null) && (
                <div className="grid grid-cols-3 gap-2">
                  <KpiTile label="Minimum" value={stats.min ?? "—"} />
                  <KpiTile label="Maximum" value={stats.max ?? "—"} />
                  <KpiTile
                    label="Durchschnitt"
                    value={numeric && stats.avg != null ? fmtNum(stats.avg) : "—"}
                  />
                </div>
              )}

              {/* Top values bar chart (single-hue frequency ranking) */}
              {stats.top_values.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2">
                    Häufigste Werte
                  </h3>
                  <div className="space-y-1.5">
                    {stats.top_values.map((t, i) => {
                      const label =
                        t.value === null ? "(leer)" : t.value === "" ? "(leerer Text)" : t.value;
                      const pct = Math.max(2, (t.count / maxTop) * 100);
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span
                            className={`w-40 shrink-0 truncate text-sm ${
                              t.value === null ? "text-slate-400 dark:text-slate-500 italic" : "text-slate-700 dark:text-slate-200"
                            }`}
                            title={label}
                          >
                            {label}
                          </span>
                          <span className="flex-1 h-4 bg-blue-100 dark:bg-blue-900/40 rounded overflow-hidden">
                            <span
                              className="block h-full bg-blue-500 rounded"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className="w-16 shrink-0 text-right text-sm tabular-nums text-slate-500 dark:text-slate-400">
                            {formatInt(t.count)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
