import { useEffect } from "react";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastBase {
  id: string;
  message: string;
}

export type ToastEntry =
  | (ToastBase & { kind: "success" | "info"; action?: ToastAction })
  | (ToastBase & { kind: "error"; action: ToastAction });

export interface ToastViewportProps {
  toasts: readonly ToastEntry[];
  onDismiss: (id: string) => void;
  surface?: "shade" | "paper";
}

const AUTO_DISMISS_MS = 4_000;
const MAX_TOASTS = 3;

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (toast.kind === "error") return undefined;

    const timer = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.id, toast.kind]);

  return (
    <div
      data-testid="toast-item"
      role={toast.kind === "error" ? "alert" : "status"}
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      className={`bg-overlay border-border shadow-sh-2 rounded-lg border p-4 ${
        toast.kind === "error" ? "border-danger" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <p className="t-body-s min-w-0 flex-1">{toast.message}</p>
        <button
          type="button"
          aria-label={`${toast.kind === "error" ? "오류" : "알림"} 알림 닫기`}
          onClick={() => onDismiss(toast.id)}
          className="text-fg-2 -m-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {toast.action ? (
        <button
          type="button"
          onClick={toast.action.onClick}
          className="t-body-s mt-3 min-h-10 font-semibold underline underline-offset-4"
          style={{ color: "var(--brand)" }}
        >
          {toast.action.label}
        </button>
      ) : null}
    </div>
  );
}

export function ToastViewport({ toasts, onDismiss, surface = "paper" }: ToastViewportProps) {
  const visibleToasts = toasts.slice(-MAX_TOASTS);

  return (
    <div
      aria-live="polite"
      aria-label="알림"
      className={`fixed flex flex-col gap-3 ${
        surface === "shade" ? "right-6 bottom-6" : "top-4 right-4 left-4"
      }`}
      style={{
        zIndex: "var(--z-toast)",
        width: "min(400px, calc(100vw - 32px))",
        ...(surface === "paper"
          ? { top: "max(16px, env(safe-area-inset-top))", marginLeft: "auto" }
          : undefined),
      }}
    >
      {visibleToasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
