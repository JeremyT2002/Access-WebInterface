import type { LockStatus } from "../types";

interface Props {
  lock: LockStatus;
  busy: boolean;
  onRetry: () => void;
}

export function LockBanner({ lock, busy, onRetry }: Props) {
  if (lock.connect_ok && !lock.laccdb_present) return null;

  const hard = !lock.connect_ok;
  return (
    <div
      className={`${
        hard ? "bg-rose-600" : "bg-amber-500"
      } text-white px-4 py-2.5 flex items-center gap-3 text-sm shadow-md z-40`}
    >
      <span className="text-lg leading-none">⚠</span>
      <span className="flex-1">
        {hard
          ? `Cannot connect to the database — it appears to be exclusively locked. ${
              lock.message ?? ""
            }`
          : "This database is currently open in Microsoft Access. Please close it in Access to use the full functionality of this app (editing may fail or be blocked)."}
      </span>
      <button
        onClick={onRetry}
        disabled={busy}
        className="shrink-0 bg-white/20 hover:bg-white/30 disabled:opacity-50 rounded-lg px-3 py-1.5 font-medium"
      >
        {busy ? "Checking…" : "Retry / Reconnect"}
      </button>
    </div>
  );
}
