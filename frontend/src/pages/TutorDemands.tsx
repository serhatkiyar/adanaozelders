import { useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { TUTOR_NAV } from "@/lib/nav";
import { useOpenDemands } from "@/hooks/useDemands";
import { uniqueSubjects } from "@/lib/examTree";
import { formatDate } from "@/lib/datetime";
import { formatTRY, parseMoney } from "@/lib/money";
import { getErrorMessage } from "@/lib/errors";
import type { DemandOut } from "@/types";

const SUBJECT_OPTIONS = uniqueSubjects();

function budgetText(d: DemandOut): string | null {
  const min = parseMoney(d.budget_min);
  const max = parseMoney(d.budget_max);
  if (min !== null && max !== null) return `${formatTRY(d.budget_min)} – ${formatTRY(d.budget_max)}`;
  if (min !== null) return `${formatTRY(d.budget_min)}+`;
  if (max !== null) return `≤ ${formatTRY(d.budget_max)}`;
  return null;
}

export default function TutorDemands() {
  const [subject, setSubject] = useState("");
  const { data: demands, isLoading, isError, error } = useOpenDemands(subject);

  return (
    <DashboardShell title="Talepler" navItems={TUTOR_NAV}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Öğrenci Talepleri
          </h2>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            Öğrencilerin aradığı dersler. İlanını ve branşlarını bu talebe göre güncelleyebilirsin.
          </p>
        </div>

        {/* Subject filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Ders:
          </label>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
          >
            <option value="">Tümü</option>
            {SUBJECT_OPTIONS.map((s) => (
              <option key={s.q} value={s.q}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-800/30">
            <span>⚠</span>
            {getErrorMessage(error, "Talepler yüklenemedi. İlanın onaylı olmalı.")}
          </div>
        ) : !demands || demands.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">
              📭
            </div>
            <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
              Açık talep yok
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {subject ? "Bu derste açık talep bulunamadı." : "Şu an bekleyen öğrenci talebi yok."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {demands.map((d) => {
              const budget = budgetText(d);
              return (
                <div
                  key={d.id}
                  className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      {d.title}
                    </span>
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                      {d.subject}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {d.level && `${d.level} · `}
                    {budget && `${budget} · `}
                    {formatDate(d.created_at)}
                  </p>
                  {d.description && (
                    <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {d.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
