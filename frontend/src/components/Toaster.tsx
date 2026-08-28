import type { ReactNode } from "react";
import { useToastStore, type Toast, type ToastType } from "@/store/toastStore";

/* ─── icon paths ─────────────────────────────────────── */

const ICONS: Record<ToastType, ReactNode> = {
  success: (
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  ),
  error: (
    <path strokeLinecap="round" strokeLinejoin="round"
      d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  ),
  warning: (
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
  ),
  info: (
    <path strokeLinecap="round" strokeLinejoin="round"
      d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
  ),
};

/* ─── per-type styles ────────────────────────────────── */

const TYPE_CLS: Record<ToastType, { border: string; icon: string; bar: string }> = {
  success: {
    border: "border-l-emerald-500",
    icon: "bg-emerald-50 text-emerald-600 ",
    bar:    "bg-emerald-400",
  },
  error: {
    border: "border-l-red-500",
    icon: "bg-red-50 text-red-600 ",
    bar:    "bg-red-400",
  },
  warning: {
    border: "border-l-amber-400",
    icon: "bg-amber-50 text-amber-600 ",
    bar:    "bg-amber-400",
  },
  info: {
    border: "border-l-indigo-500",
    icon: "bg-indigo-50 text-indigo-600 ",
    bar:    "bg-indigo-400",
  },
};

const DURATION_MS = 4500;

/* ─── single toast item ──────────────────────────────── */

function ToastItem({ t, dismiss }: { t: Toast; dismiss: (id: number) => void }) {
  const cls = TYPE_CLS[t.type];

  return (
    <div
      role="alert"
      className={`pointer-events-auto overflow-hidden rounded-2xl border-l-4 bg-white shadow-lg ring-1 ring-slate-100 ${cls.border}`}
      style={{ animation: "toast-in 0.24s cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
    >
      {/* Content row */}
      <div className="flex items-start gap-3 px-4 py-3.5">
        {/* Icon badge */}
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${cls.icon}`}>
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-4 w-4"
          >
            {ICONS[t.type]}
          </svg>
        </span>

        {/* Message */}
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-800 ">
          {t.message}
        </p>

        {/* Dismiss */}
        <button
          aria-label="Kapat"
          onClick={() => dismiss(t.id)}
          className="mt-0.5 shrink-0 rounded text-slate-300 transition hover:text-slate-500 "
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div
        className={`h-0.5 ${cls.bar}`}
        style={{
          animation: `toast-progress ${DURATION_MS}ms linear forwards`,
          transformOrigin: "left",
        }}
      />
    </div>
  );
}

/* ─── container ──────────────────────────────────────── */

export function Toaster() {
  const toasts  = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-4 bottom-4 z-[999] flex w-full max-w-sm flex-col-reverse gap-2.5"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} dismiss={dismiss} />
      ))}
    </div>
  );
}
