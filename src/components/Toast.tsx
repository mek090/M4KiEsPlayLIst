// Lightweight toast notification system.
//
// Usage:
//   const toast = useToasts();
//   toast.show("คัดลอกลิงก์แล้ว", "success");
//   toast.show("⚠ ใส่ URL ก่อน", "error");
//
// Renders a stack of dismissible cards in the top-right (top-center on mobile).
// Auto-dismiss after 3s; tap to dismiss earlier.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "info" | "success" | "error";

type Toast = {
  id: number;
  message: string;
  kind: ToastKind;
};

type ToastApi = {
  show: (message: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 3_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`toast toast-${t.kind}`}
            onClick={() => dismiss(t.id)}
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastApi {
  const ctx = useContext(ToastContext);
  // Fallback no-op so callers don't crash if provider missing in tests / SSR
  return ctx ?? { show: () => {} };
}

/** Stable utility: copy text + show a toast. */
export function useClipboardToast() {
  const toast = useToasts();
  return useCallback(
    async (text: string, successMsg = "คัดลอกแล้ว ✓") => {
      try {
        await navigator.clipboard.writeText(text);
        toast.show(successMsg, "success");
      } catch {
        toast.show("คัดลอกไม่สำเร็จ", "error");
      }
    },
    [toast],
  );
}

