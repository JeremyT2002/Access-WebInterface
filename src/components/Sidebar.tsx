interface Props {
  dbPath: string;
  tables: string[];
  queries: string[];
  selected: { name: string; isQuery: boolean } | null;
  onSelect: (name: string, isQuery: boolean) => void;
  onOpenOther: () => void;
  onHome: () => void;
  onBackup: () => void;
}

export function Sidebar({
  dbPath,
  tables,
  queries,
  selected,
  onSelect,
  onOpenOther,
  onHome,
  onBackup,
}: Props) {
  const fileName = dbPath.split(/[\\/]/).pop() ?? dbPath;

  const item = (name: string, isQuery: boolean) => {
    const active = selected?.name === name && selected.isQuery === isQuery;
    return (
      <button
        key={`${isQuery}-${name}`}
        onClick={() => onSelect(name, isQuery)}
        title={name}
        className={`w-full text-left px-3 py-1.5 rounded-lg text-sm truncate transition-colors ${
          active
            ? "bg-blue-600 text-white"
            : "text-slate-700 hover:bg-slate-200"
        }`}
      >
        <span className="mr-1.5 opacity-60">{isQuery ? "🔍" : "▤"}</span>
        {name}
      </button>
    );
  };

  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col h-full">
      <div className="p-3 border-b border-slate-200">
        <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Database</div>
        <div className="text-sm font-medium truncate mt-0.5" title={dbPath}>
          {fileName}
        </div>
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={onHome}
            className={`flex-1 text-xs border rounded-lg px-2 py-1.5 ${
              selected === null
                ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                : "border-slate-300 hover:bg-slate-100"
            }`}
          >
            🏠 Übersicht
          </button>
          <button
            onClick={onOpenOther}
            className="flex-1 text-xs border border-slate-300 rounded-lg px-2 py-1.5 hover:bg-slate-100"
          >
            Andere DB…
          </button>
        </div>
        <button
          onClick={onBackup}
          className="mt-1.5 w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 hover:bg-slate-100"
          title="Kopie der Datenbankdatei mit Zeitstempel speichern"
        >
          💾 Backup erstellen
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        <div>
          <div className="px-2 pb-1 text-xs uppercase tracking-wide text-slate-400 font-semibold">
            Tables ({tables.length})
          </div>
          <div className="space-y-0.5">{tables.map((t) => item(t, false))}</div>
          {tables.length === 0 && (
            <div className="px-3 text-xs text-slate-400">No user tables found.</div>
          )}
        </div>
        <div>
          <div className="px-2 pb-1 text-xs uppercase tracking-wide text-slate-400 font-semibold">
            Queries ({queries.length})
          </div>
          <div className="space-y-0.5">{queries.map((q) => item(q, true))}</div>
          {queries.length === 0 && (
            <div className="px-3 text-xs text-slate-400">No saved queries found.</div>
          )}
        </div>
      </div>
    </aside>
  );
}
