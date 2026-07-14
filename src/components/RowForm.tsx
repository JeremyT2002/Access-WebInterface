import { useEffect, useState } from "react";
import type { Column, TableSchema } from "../types";
import type { RowValues } from "../api";

interface Props {
  schema: TableSchema;
  /** null => create mode; otherwise edit mode with initial values */
  initial: RowValues | null;
  busy: boolean;
  onSubmit: (values: RowValues) => void;
  onClose: () => void;
}

/** Normalize an Access datetime string to what <input type=datetime-local> wants. */
function toDatetimeLocal(v: string | null): string {
  if (!v) return "";
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  const d = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (d) return `${d[1]}-${d[2]}-${d[3]}T00:00`;
  return "";
}

function isTruthy(v: string | null): boolean {
  if (!v) return false;
  return ["1", "true", "yes", "-1"].includes(v.toLowerCase());
}

export function RowForm({ schema, initial, busy, onSubmit, onClose }: Props) {
  const isEdit = initial !== null;
  const editableCols = schema.columns.filter((c) => !c.is_autonumber);

  const [values, setValues] = useState<Record<string, string>>({});
  const [nulls, setNulls] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const v: Record<string, string> = {};
    const n: Record<string, boolean> = {};
    for (const c of editableCols) {
      const raw = initial ? initial[c.name] ?? null : null;
      n[c.name] = initial ? raw === null : false;
      if (c.category === "date") v[c.name] = toDatetimeLocal(raw);
      else if (c.category === "boolean") v[c.name] = isTruthy(raw) ? "true" : "false";
      else v[c.name] = raw ?? "";
    }
    setValues(v);
    setNulls(n);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.name, initial]);

  const set = (col: string, val: string) => {
    setValues((v) => ({ ...v, [col]: val }));
    setNulls((n) => ({ ...n, [col]: false }));
  };

  const validate = (): RowValues | null => {
    const errs: Record<string, string> = {};
    const out: RowValues = {};
    for (const c of editableCols) {
      const isNull = nulls[c.name] || (c.category !== "text" && values[c.name] === "");
      const raw = values[c.name] ?? "";
      if (isNull || (c.category === "text" && raw === "" && c.nullable && !isEdit)) {
        if (!c.nullable && c.category !== "boolean") {
          errs[c.name] = "This field is required.";
          continue;
        }
        out[c.name] = c.category === "boolean" && !isNull ? "false" : null;
        continue;
      }
      if (c.category === "integer" && raw !== "" && !/^-?\d+$/.test(raw.trim())) {
        errs[c.name] = "Must be a whole number.";
        continue;
      }
      if (c.category === "float" && raw !== "" && isNaN(Number(raw.replace(",", ".")))) {
        errs[c.name] = "Must be a number.";
        continue;
      }
      out[c.name] = raw;
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return null;
    }
    return out;
  };

  const submit = () => {
    const out = validate();
    if (out) onSubmit(out);
  };

  const field = (c: Column) => {
    const isNull = nulls[c.name] ?? false;
    const err = errors[c.name];
    const common =
      "w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 " +
      (err ? "border-rose-400" : "border-slate-300 dark:border-slate-600") +
      (isNull ? " opacity-40" : "");

    let input: React.ReactNode;
    switch (c.category) {
      case "boolean":
        input = (
          <input
            type="checkbox"
            className="h-5 w-5 accent-blue-600"
            checked={values[c.name] === "true"}
            disabled={isNull}
            onChange={(e) => set(c.name, e.target.checked ? "true" : "false")}
          />
        );
        break;
      case "integer":
        input = (
          <input type="number" step="1" className={common} value={values[c.name] ?? ""}
            disabled={isNull} onChange={(e) => set(c.name, e.target.value)} />
        );
        break;
      case "float":
        input = (
          <input type="number" step="any" className={common} value={values[c.name] ?? ""}
            disabled={isNull} onChange={(e) => set(c.name, e.target.value)} />
        );
        break;
      case "date":
        input = (
          <input type="datetime-local" className={common} value={values[c.name] ?? ""}
            disabled={isNull} onChange={(e) => set(c.name, e.target.value)} />
        );
        break;
      default:
        input =
          (c.size ?? 0) > 255 ? (
            <textarea rows={3} className={common} value={values[c.name] ?? ""}
              disabled={isNull} onChange={(e) => set(c.name, e.target.value)} />
          ) : (
            <input type="text" className={common} maxLength={c.size ?? undefined}
              value={values[c.name] ?? ""} disabled={isNull}
              onChange={(e) => set(c.name, e.target.value)} />
          );
    }

    return (
      <div key={c.name}>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {c.name}
            {!c.nullable && <span className="text-rose-500 ml-0.5">*</span>}
            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">{c.type_name}</span>
            {c.is_primary_key && (
              <span className="ml-1 text-xs text-amber-600 font-semibold">PK</span>
            )}
          </label>
          {c.nullable && (
            <label className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={isNull}
                onChange={(e) => setNulls((n) => ({ ...n, [c.name]: e.target.checked }))}
              />
              NULL
            </label>
          )}
        </div>
        {input}
        {err && <div className="text-xs text-rose-600 mt-1">{err}</div>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEdit ? `Edit row in ${schema.name}` : `New row in ${schema.name}`}
          </h2>
          <button className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300" onClick={onClose}>✕</button>
        </div>
        <div className="px-6 py-4 overflow-y-auto space-y-4 flex-1">
          {schema.columns.some((c) => c.is_autonumber) && !isEdit && (
            <div className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-500 dark:text-slate-400">
              AutoNumber column
              {schema.columns.filter((c) => c.is_autonumber).map((c) => ` "${c.name}"`)} will be
              assigned automatically by Access.
            </div>
          )}
          {editableCols.map(field)}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
          <button
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/60"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={busy}
            onClick={submit}
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create row"}
          </button>
        </div>
      </div>
    </div>
  );
}
