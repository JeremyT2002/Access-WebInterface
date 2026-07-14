import type { LockStatus } from "../types";

interface Props {
  lock: LockStatus;
  busy: boolean;
  onRetry: () => void;
}

export function LockBanner({ lock, busy, onRetry }: Props) {
  if (lock.connect_ok && !lock.laccdb_present) return null;

  const hard = !lock.connect_ok;

  // De-duplicate and format the machine/user pairs from the .laccdb file.
  const holders = lock.holders.filter((h) => h.machine !== "?" || h.user !== "?");
  const holderText = holders
    .map((h) => (h.user !== "?" ? `${h.user} (${h.machine})` : h.machine))
    .join(", ");

  return (
    <div
      className={`${
        hard ? "bg-rose-600" : "bg-amber-500"
      } text-white px-4 py-2.5 flex items-center gap-3 text-sm shadow-md z-40`}
    >
      <span className="text-lg leading-none">⚠</span>
      <span className="flex-1">
        {hard
          ? `Verbindung zur Datenbank nicht möglich — sie ist offenbar exklusiv gesperrt. ${
              lock.message ?? ""
            }`
          : "Diese Datenbank ist aktuell in Microsoft Access geöffnet. Bitte schließe sie in Access, um den vollen Funktionsumfang zu nutzen (Bearbeiten kann fehlschlagen oder blockiert sein)."}
        {holderText && (
          <span className="block mt-0.5 font-medium">
            Geöffnet von: {holderText}
          </span>
        )}
      </span>
      <button
        onClick={onRetry}
        disabled={busy}
        className="shrink-0 bg-white/20 hover:bg-white/30 disabled:opacity-50 rounded-lg px-3 py-1.5 font-medium"
      >
        {busy ? "Prüfe…" : "Erneut verbinden"}
      </button>
    </div>
  );
}
