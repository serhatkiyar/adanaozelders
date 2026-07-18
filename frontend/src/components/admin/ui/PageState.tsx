import type { ReactNode } from "react";
import { Button } from "./Button";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  description: string;
  onRetry?: () => void;
}

export function ErrorState({ title = "Veriler yüklenemedi", description, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="mt-1 text-sm opacity-80">{description}</p>
      {onRetry && <Button className="mt-4" size="sm" variant="danger" onClick={onRetry}>Yeniden dene</Button>}
    </div>
  );
}

export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-label="Yükleniyor" aria-busy="true" className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800" />
      ))}
    </div>
  );
}
