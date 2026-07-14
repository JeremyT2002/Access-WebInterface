import type { Cell, TableSchema } from "../types";

interface Props {
  schema: TableSchema;
  columns: string[];
  row: Cell[];
  onClose: () => void;
  onEdit?: () => void;
}

/** Side panel showing all fields of one row — handy for wide tables. */
export function DetailPanel({ schema, columns, row, onClose, onEdit }: Props) {
  const colByName = new Map(schema.columns.map((c) => [c.name, c]));
  return (
    <div className="w-80 shrink-0 border-l border-slate-200 bg-white h-full flex flex-col">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h3 className="font-semibold text-sm">Row details</h3>
        <div className="flex gap-2">
          {onEdit && (
            <button
              onClick={onEdit}
              className="text-xs text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg px-2 py-1"
            >
              ✎ Edit
            </button>
          )}
          <button className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {columns.map((c, i) => {
          const col = colByName.get(c);
          const v = row[i];
          return (
            <div key={c}>
              <div className="text-xs text-slate-400 font-medium flex items-center gap-1">
                {col?.is_primary_key && <span>🔑</span>}
                {c}
                <span className="opacity-60">· {col?.type_name}</span>
              </div>
              <div
                className={`text-sm mt-0.5 break-words whitespace-pre-wrap ${
                  v === null ? "text-slate-300 italic" : "text-slate-800"
                }`}
              >
                {v === null ? "NULL" : v === "" ? " " : v}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
