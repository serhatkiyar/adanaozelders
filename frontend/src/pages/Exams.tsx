import { FormEvent, useEffect, useMemo, useState } from "react";
import { Field } from "@/components/ui/Field";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import { useCreateExam, useExams } from "@/hooks/useExams";
import { EXAM_TEMPLATES } from "@/lib/examTemplates";
import { upcomingExams } from "@/lib/examDates";
import { formatDate } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { ExamSubjectCreate, PracticeExamOut } from "@/types";

const PENALTY = 4; // net = doğru − yanlış / 4 (standart deneme hesabı)

interface Row {
  subject: string;
  correct: string;
  wrong: string;
  blank: string;
  max: number;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toNum(s: string | number | null | undefined): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function netOf(correct: number, wrong: number): number {
  return correct - wrong / PENALTY;
}

function fmtNet(n: number): string {
  return n.toFixed(2);
}

function templateRows(key: string): Row[] {
  const t = EXAM_TEMPLATES.find((x) => x.key === key);
  if (!t || t.subjects.length === 0) {
    return [{ subject: "", correct: "", wrong: "", blank: "", max: 0 }];
  }
  return t.subjects.map((s) => ({
    subject: s.subject,
    correct: "",
    wrong: "",
    blank: "",
    max: s.max,
  }));
}

/* ─── stats card ─────────────────────────────────────────── */

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 ">
      <p className="text-xs font-medium text-slate-400 ">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900 ">
        {value}
      </p>
    </div>
  );
}

/* ─── history item ───────────────────────────────────────── */

function HistoryItem({ exam }: { exam: PracticeExamOut }) {
  const [open, setOpen] = useState(false);
  const net = toNum(exam.net_score);
  const hasSubjects = exam.subjects.length > 0;

  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 ">
      <button
        type="button"
        onClick={() => hasSubjects && setOpen((o) => !o)}
        className={`flex w-full items-center gap-4 px-5 py-4 text-left ${
          hasSubjects ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 ">
              {exam.title}
            </span>
            {exam.exam_type && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 ">
                {exam.exam_type}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400 ">
            {exam.exam_date ? formatDate(exam.exam_date) : formatDate(exam.created_at)}
            {" · "}
            <span className="text-emerald-600 ">
              {exam.correct_count} D
            </span>{" "}
            <span className="text-rose-600 ">
              {exam.wrong_count} Y
            </span>{" "}
            <span className="text-slate-400">{exam.blank_count} B</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl font-bold text-slate-900 ">
            {fmtNet(net)}
          </p>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
            net
          </p>
        </div>
        {hasSubjects && (
          <svg
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
              open ? "rotate-180" : ""
            }`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        )}
      </button>

      {open && hasSubjects && (
        <div className="border-t border-slate-100 px-5 py-3 ">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 ">
                <th className="pb-2 font-medium">Ders</th>
                <th className="pb-2 text-center font-medium">D</th>
                <th className="pb-2 text-center font-medium">Y</th>
                <th className="pb-2 text-center font-medium">B</th>
                <th className="pb-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 ">
              {exam.subjects.map((s) => (
                <tr key={s.id} className="text-slate-700 ">
                  <td className="py-1.5 font-medium">{s.subject}</td>
                  <td className="py-1.5 text-center text-emerald-600 ">
                    {s.correct_count}
                  </td>
                  <td className="py-1.5 text-center text-rose-600 ">
                    {s.wrong_count}
                  </td>
                  <td className="py-1.5 text-center text-slate-400">
                    {s.blank_count}
                  </td>
                  <td className="py-1.5 text-right font-semibold">
                    {fmtNet(toNum(s.net_score))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── main page ──────────────────────────────────────────── */

export default function Exams() {
  const { data: exams, isLoading } = useExams();
  const createExam = useCreateExam();

  const [templateKey, setTemplateKey] = useState(EXAM_TEMPLATES[0].key);
  const [examDate, setExamDate] = useState(toDateStr(new Date()));
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<Row[]>(() => templateRows(EXAM_TEMPLATES[0].key));

  // Şablon değişince satırları ve varsayılan başlığı yenile.
  useEffect(() => {
    const t = EXAM_TEMPLATES.find((x) => x.key === templateKey);
    setRows(templateRows(templateKey));
    setTitle(t && t.examType ? `${t.examType} Denemesi` : "Deneme");
  }, [templateKey]);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((prev) => [...prev, { subject: "", correct: "", wrong: "", blank: "", max: 0 }]);

  const removeRow = (i: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const totals = useMemo(() => {
    let c = 0;
    let w = 0;
    let b = 0;
    for (const r of rows) {
      c += toNum(r.correct);
      w += toNum(r.wrong);
      b += toNum(r.blank);
    }
    return { correct: c, wrong: w, blank: b, net: netOf(c, w) };
  }, [rows]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const subjects: ExamSubjectCreate[] = rows
      .filter((r) => r.subject.trim())
      .map((r) => ({
        subject: r.subject.trim(),
        correct_count: toNum(r.correct),
        wrong_count: toNum(r.wrong),
        blank_count: toNum(r.blank),
      }));

    if (subjects.length === 0) {
      toast.error("En az bir ders adı gir.");
      return;
    }
    if (totals.correct + totals.wrong + totals.blank === 0) {
      toast.error("En az bir ders için sonuç gir.");
      return;
    }
    const overflow = rows.find(
      (r) =>
        r.max > 0 &&
        toNum(r.correct) + toNum(r.wrong) + toNum(r.blank) > r.max
    );
    if (overflow) {
      toast.error(`${overflow.subject}: soru sayısı ${overflow.max}'i aşamaz.`);
      return;
    }

    const t = EXAM_TEMPLATES.find((x) => x.key === templateKey);
    createExam.mutate(
      {
        title: title.trim() || "Deneme",
        exam_type: t && t.examType ? t.examType : null,
        exam_date: examDate || null,
        subjects,
      },
      {
        onSuccess: () => {
          toast.success("Deneme kaydedildi.");
          setRows(templateRows(templateKey));
        },
        onError: (err) => toast.error(getErrorMessage(err, "Deneme kaydedilemedi.")),
      }
    );
  };

  const stats = useMemo(() => {
    if (!exams || exams.length === 0) return null;
    const nets = exams.map((e) => toNum(e.net_score));
    const best = Math.max(...nets);
    const avg = nets.reduce((a, n) => a + n, 0) / nets.length;
    return { count: exams.length, best, avg, last: nets[0] };
  }, [exams]);

  const trend = useMemo(() => {
    if (!exams) return [];
    return [...exams]
      .reverse()
      .map((e) => toNum(e.net_score))
      .slice(-12);
  }, [exams]);
  const trendMax = trend.length ? Math.max(...trend, 1) : 1;
  const examCountdown = upcomingExams();

  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ";

  return (
    <DashboardShell title="Denemelerim" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-4xl space-y-6">
        {/* ── Sınav geri sayımı ── */}
        {examCountdown.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {examCountdown.slice(0, 6).map((e) => (
              <div
                key={e.name}
                className="flex shrink-0 flex-col items-center rounded-2xl bg-white px-5 py-3 shadow-sm ring-1 ring-slate-100 "
              >
                <span className="text-2xl font-bold leading-none text-indigo-600 ">
                  {e.days}
                </span>
                <span className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                  gün
                </span>
                <span className="mt-1 text-xs font-semibold text-slate-700 ">
                  {e.name}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Stats + trend ── */}
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBox label="Toplam deneme" value={String(stats.count)} />
            <StatBox label="En yüksek net" value={fmtNet(stats.best)} />
            <StatBox label="Ortalama net" value={fmtNet(stats.avg)} />
            <StatBox label="Son net" value={fmtNet(stats.last)} />
          </div>
        )}

        {trend.length >= 2 && (
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 ">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
              Net gelişimi (son {trend.length})
            </p>
            <div className="flex h-28 items-end gap-1.5">
              {trend.map((n, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-gradient-to-t from-indigo-500 to-violet-500"
                  style={{ height: `${Math.max(4, (Math.max(0, n) / trendMax) * 100)}%` }}
                  title={fmtNet(n)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Yeni deneme formu ── */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 "
        >
          <h2 className="text-base font-semibold text-slate-900 ">
            Yeni Deneme Ekle
          </h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Sınav türü" labelClassName="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 ">
              {(id) => (
                  <select
                    id={id}
                    value={templateKey}
                    onChange={(e) => setTemplateKey(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
                  >
                    {EXAM_TEMPLATES.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
              )}
            </Field>
            <Field label="Başlık" labelClassName="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 ">
              {(id) => (
                  <input
                    id={id}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="ör. TYT Denemesi 3"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
                  />
              )}
            </Field>
            <Field label="Tarih" labelClassName="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 ">
              {(id) => (
                  <input
                    id={id}
                    type="date"
                    value={examDate}
                    max={toDateStr(new Date())}
                    onChange={(e) => setExamDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
                  />
              )}
            </Field>
          </div>

          {/* Konu satırları */}
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-y-1.5">
              <thead>
                <tr className="text-xs text-slate-400 ">
                  <th className="px-1 text-left font-medium">Ders</th>
                  <th className="px-1 font-medium">Doğru</th>
                  <th className="px-1 font-medium">Yanlış</th>
                  <th className="px-1 font-medium">Boş</th>
                  <th className="px-1 text-right font-medium">Net</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const rowNet = netOf(toNum(r.correct), toNum(r.wrong));
                  const sum = toNum(r.correct) + toNum(r.wrong) + toNum(r.blank);
                  const over = r.max > 0 && sum > r.max;
                  return (
                    <tr key={i}>
                      <td className="pr-2">
                        <input
                          value={r.subject}
                          onChange={(e) => setRow(i, { subject: e.target.value })}
                          placeholder="Ders"
                          className="w-full min-w-[7rem] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
                        />
                        {r.max > 0 && (
                          <span
                            className={`ml-1 text-[10px] ${
                              over ? "text-rose-500" : "text-slate-400"
                            }`}
                          >
                            {sum}/{r.max}
                          </span>
                        )}
                      </td>
                      <td className="px-1">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={r.correct}
                          onChange={(e) => setRow(i, { correct: e.target.value })}
                          className={`${inputCls} w-16`}
                        />
                      </td>
                      <td className="px-1">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={r.wrong}
                          onChange={(e) => setRow(i, { wrong: e.target.value })}
                          className={`${inputCls} w-16`}
                        />
                      </td>
                      <td className="px-1">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={r.blank}
                          onChange={(e) => setRow(i, { blank: e.target.value })}
                          className={`${inputCls} w-16`}
                        />
                      </td>
                      <td className="px-1 text-right text-sm font-semibold text-slate-700 ">
                        {fmtNet(rowNet)}
                      </td>
                      <td className="text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          aria-label="Satırı sil"
                          className="rounded-lg p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 "
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={addRow}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 "
            >
              + Ders ekle
            </button>
            <div className="text-sm text-slate-500 ">
              Toplam:{" "}
              <span className="font-semibold text-emerald-600 ">
                {totals.correct} D
              </span>{" "}
              <span className="font-semibold text-rose-600 ">
                {totals.wrong} Y
              </span>{" "}
              <span className="text-slate-400">{totals.blank} B</span>
              {" — "}
              <span className="font-bold text-slate-900 ">
                {fmtNet(totals.net)} net
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={createExam.isPending}
            className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createExam.isPending ? "Kaydediliyor…" : "Denemeyi Kaydet"}
          </button>
        </form>

        {/* ── Geçmiş ── */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-slate-900 ">
            Geçmiş Denemeler
          </h2>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-2xl bg-slate-100 "
                />
              ))}
            </div>
          ) : !exams || exams.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center ">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl ">
                📊
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700 ">
                Henüz deneme eklemedin
              </p>
              <p className="mt-1 text-xs text-slate-400 ">
                Yukarıdan ilk denemeni ekle, netlerini takip etmeye başla.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {exams.map((exam) => (
                <HistoryItem key={exam.id} exam={exam} />
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
