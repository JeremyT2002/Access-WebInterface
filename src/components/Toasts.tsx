import { createContext, useCallback, useContext, useRef, useState } from "react";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

interface ToastContextValue {
  push: (kind: Toast["kind"], text: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ push: () => {} });

export function useToasts() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    // Errors stay longer so they can be read.
    const ttl = kind === "error" ? 8000 : 3500;
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  const colors: Record<Toast["kind"], string> = {
    success: "bg-emerald-600",
    error: "bg-rose-600",
    info: "bg-slate-700",
  };

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-md">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${colors[t.kind]} text-white text-sm rounded-lg shadow-lg px-4 py-3 flex items-start gap-2`}
          >
            <span className="flex-1 break-words whitespace-pre-wrap">{t.text}</span>
            <button
              className="opacity-70 hover:opacity-100 shrink-0"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
