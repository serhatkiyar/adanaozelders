import { FormEvent, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import { useCloseDemand, useCreateDemand, useMyDemands } from "@/hooks/useDemands";
import { uniqueSubjects } from "@/lib/examTree";
import { formatDate } from "@/lib/datetime";
import { formatTRY, parseMoney } from "@/lib/money";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { DemandStatus, type DemandOut } from "@/types";

const SUBJECT_OPTIONS = uniqueSubjects();

const STATUS_META: Record<DemandStatus, { label: string; cls: string }> = {
  [DemandStatus.OPEN]: {
    label: "Açık",
    cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  [DemandStatus.CLOSED]: {
    label: "Kapalı",
    cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  },
  [DemandStatus.CANCELLED]: {
    label: "İptal",
    cls: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
  },
};

function budgetText(d: DemandOut): string | null {
  const min = parseMoney(d.budget_min);
  const max = parseMoney(d.budget_max);
  if (min !== null && max !== null) return `${formatTRY(d.budget_min)} – ${formatTRY(d.budget_max)}`;
  if (min !== null) return `${formatTRY(d.budget_min)}+`;
  if (max !== null) return `≤ ${formatTRY(d.budget_max)}`;
  return null;
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500";
const labelCls =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";

export default function StudentDemands() {
  const { data: demands, isLoading } = useMyDemands();
  const createDemand = useCreateDemand();
  const closeDemand = useCloseDemand();

  const [subject, setSubject] = useState(SUBJECT_OPTIONS[0]?.q ?? "");
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [description, setDescription] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Bir başlık gir.");
      return;
    }
    if (!subject) {
      toast.error("Bir ders seç.");
      return;
    }
    const min = budgetMin.trim() ? Number(budgetMin) : null;
    const max = budgetMax.trim() ? Number(budgetMax) : null;
    if (min !== null && max !== null && max < min) {
      toast.error("Maksimum bütçe minimumdan küçük olamaz.");
      return;
    }
    createDemand.mutate(
      {
        title: title.trim(),
        subject,
        level: level.trim() || null,
        budget_min: min,
        budget_max: max,
        description: description.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("Talebin yayınlandı.");
          setTitle("");
          setLevel("");
          setBudgetMin("");
          setBudgetMax("");
          setDescription("");
        },
        onError: (err) => toast.error(getErrorMessage(err, "Talep oluşturulamadı.")),
      }
    );
  };

  const onClose = (id: number) =>
    closeDemand.mutate(id, {
      onSuccess: () => toast.success("Talep kapatıldı."),
      onError: (err) => toast.error(getErrorMessage(err, "Kapatılamadı.")),
    });

  return (
    <DashboardShell title="Taleplerim" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-3xl space-y-6">
        {/* New demand form */}
        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700"
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Yeni Talep Oluştur
            </h2>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Aradığın dersi yayınla; uygun eğitmenler talebini görebilsin.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Başlık</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="ör. Hafta sonu TYT Matematik desteği"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Ders</label>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={inputCls}
              >
                {SUBJECT_OPTIONS.map((s) => (
                  <option key={s.q} value={s.q}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Seviye (opsiyonel)</label>
              <input
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                maxLength={100}
                placeholder="ör. 12. sınıf"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Min bütçe ₺ (opsiyonel)</label>
              <input
                type="number"
                min={0}
                value={budgetMin}
                onChange={(e) => setBudgetMin(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Max bütçe ₺ (opsiyonel)</label>
              <input
                type="number"
                min={0}
                value={budgetMax}
                onChange={(e) => setBudgetMax(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Açıklama (opsiyonel)</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Hedefin, uygun saatlerin, özel istekler…"
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={createDemand.isPending}
              className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:opacity-60"
            >
              {createDemand.isPending ? "Yayınlanıyor…" : "Talebi Yayınla"}
            </button>
          </div>
        </form>

        {/* My demands */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
            Taleplerim
          </h2>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          ) : !demands || demands.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">
                📢
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                Henüz talebin yok
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Yukarıdan ilk talebini oluştur.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {demands.map((d) => {
                const meta = STATUS_META[d.status];
                const budget = budgetText(d);
                return (
                  <div
                    key={d.id}
                    className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {d.title}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                            {meta.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-medium text-indigo-600 dark:text-indigo-400">
                            {d.subject}
                          </span>
                          {d.level && ` · ${d.level}`}
                          {budget && ` · ${budget}`}
                          {` · ${formatDate(d.created_at)}`}
                        </p>
                        {d.description && (
                          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                            {d.description}
                          </p>
                        )}
                      </div>
                      {d.status === DemandStatus.OPEN && (
                        <button
                          onClick={() => onClose(d.id)}
                          disabled={closeDemand.isPending}
                          className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        >
                          Kapat
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
