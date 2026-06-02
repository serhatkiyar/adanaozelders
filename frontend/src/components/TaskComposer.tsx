import { FormEvent, useEffect, useRef, useState } from "react";
import { useCreateLabel } from "@/hooks/useTasks";
import { parseQuickAdd } from "@/lib/quickParse";
import { isoToLocalInput } from "@/lib/taskView";
import { localInputToIso } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import ReminderEditor from "@/components/ReminderEditor";
import type { ReminderInput, TaskLabel, TaskList, TaskPriority } from "@/types";

// Todoist 'Add task' kartı: görev adı + açıklama + chip kontrolleri (tarih,
// öncelik, etiket, tekrar) + proje seçici + İptal/Görev ekle.

export interface ComposerPayload {
  title: string;
  description: string | null;
  priority: TaskPriority;
  due_at: string | null;
  recurrence: string | null;
  label_ids: number[];
  list_id: number;
  reminders: ReminderInput[];
}

interface Props {
  lists: TaskList[];
  labels: TaskLabel[];
  defaultListId?: number;
  projects: { id: number; name: string }[];
  labelRefs: { id: number; name: string }[];
  pending: boolean;
  onSubmit: (payload: ComposerPayload) => void;
  onCancel: () => void;
}

const PRIO: Record<TaskPriority, { label: string; flag: string }> = {
  1: { label: "P1", flag: "text-red-500" },
  2: { label: "P2", flag: "text-orange-500" },
  3: { label: "P3", flag: "text-blue-500" },
  4: { label: "P4", flag: "text-slate-400 dark:text-slate-500" },
};

const REC_OPTS: { value: string; label: string }[] = [
  { value: "", label: "Tekrar yok" },
  { value: "daily", label: "Her gün" },
  { value: "weekdays", label: "Hafta içi" },
  { value: "weekly", label: "Her hafta" },
  { value: "monthly", label: "Her ay" },
  { value: "yearly", label: "Her yıl" },
];
const REC_LABELS: Record<string, string> = Object.fromEntries(REC_OPTS.map((o) => [o.value, o.label]));

const hhmm = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const LABEL_COLOR = "#64748b";

function endOfDay(d: Date): Date { d.setHours(23, 59, 0, 0); return d; }
function offsetIso(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days); return endOfDay(d).toISOString();
}
function dueLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const isEod = d.getHours() === 23 && d.getMinutes() === 59;
  const time = isEod ? "" : ` ${hhmm.format(d)}`;
  if (d.toDateString() === today.toDateString()) return "Bugün" + time;
  if (d.toDateString() === tomorrow.toDateString()) return "Yarın" + time;
  return shortDate.format(d) + time;
}

// Küçük popover sarmalayıcı (chip altında açılır; dışına tıkla kapanır).
function Pop({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute left-0 top-full z-20 mt-1.5 min-w-[200px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>
  );
}

const chipCls = "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700/50";
const chipActiveCls = "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/60 dark:bg-indigo-500/15 dark:text-indigo-300";

function Flag({ p }: { p: TaskPriority }) {
  return (
    <svg className={`h-3.5 w-3.5 ${PRIO[p].flag}`} viewBox="0 0 24 24" fill={p === 4 ? "none" : "currentColor"} stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 21V4h11l-1.5 3.5L15 11H4" />
    </svg>
  );
}

export default function TaskComposer({ lists, labels, defaultListId, projects, labelRefs, pending, onSubmit, onCancel }: Props) {
  const createLabel = useCreateLabel();
  const titleRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(4);
  const [dueIso, setDueIso] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState("");
  const [labelIds, setLabelIds] = useState<number[]>([]);
  const [reminders, setReminders] = useState<ReminderInput[]>([]);
  const [showReminders, setShowReminders] = useState(false);
  const [listId, setListId] = useState<number | undefined>(defaultListId);
  const [menu, setMenu] = useState<"date" | "priority" | "labels" | "recur" | "project" | null>(null);
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => { if (defaultListId != null && listId == null) setListId(defaultListId); }, [defaultListId, listId]);

  const project = lists.find((l) => l.id === listId);
  const selectedLabels = labels.filter((l) => labelIds.includes(l.id));

  const toggleLabel = (id: number) =>
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const addNewLabel = async () => {
    const n = newLabel.trim();
    if (!n) return;
    try {
      const lbl = await createLabel.mutateAsync({ name: n, color: LABEL_COLOR });
      setLabelIds((prev) => (prev.includes(lbl.id) ? prev : [...prev, lbl.id]));
      setNewLabel("");
    } catch (err) {
      toast.error(getErrorMessage(err, "Etiket eklenemedi."));
    }
  };

  const reset = () => {
    setTitle(""); setDescription(""); // hızlı ardışık girişte tarih/öncelik/proje korunur
    setReminders([]); setShowReminders(false);
    setMenu(null);
    titleRef.current?.focus();
  };

  // absolute hatırlatmalarda boş remind_at'leri ele (geçersiz).
  const validReminders = () => reminders.filter((r) => (r.type === "absolute" ? !!r.remind_at : true));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Açık alanları doğal dilden tamamla (chip'ler önceliklidir).
    const parsed = parseQuickAdd(title, { projects, labels: labelRefs });
    const finalTitle = (parsed.title || title).trim();
    if (!finalTitle) { toast.error("Görev adı boş olamaz."); return; }
    const target = listId ?? parsed.listId ?? defaultListId;
    if (!target) { toast.error("Önce bir proje oluştur."); return; }

    const due = dueIso ?? parsed.dueIso ?? null;
    const prio: TaskPriority = priority !== 4 ? priority : ((parsed.priority as TaskPriority) ?? 4);
    const rec = recurrence || parsed.recurrence || null;
    const ids = Array.from(new Set([...labelIds, ...parsed.labelIds]));

    const finish = (allIds: number[]) => {
      onSubmit({
        title: finalTitle,
        description: description.trim() || null,
        priority: prio,
        due_at: due,
        recurrence: rec,
        label_ids: allIds,
        list_id: target,
        reminders: validReminders(),
      });
      reset();
    };

    // Doğal dilden gelen yeni etiketleri oluştur, sonra gönder.
    if (parsed.newLabelNames.length) {
      (async () => {
        const extra: number[] = [];
        for (const name of parsed.newLabelNames) {
          try { const lbl = await createLabel.mutateAsync({ name, color: LABEL_COLOR }); extra.push(lbl.id); } catch { /* atla */ }
        }
        finish(Array.from(new Set([...ids, ...extra])));
      })();
    } else {
      finish(ids);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-800">
      <input
        ref={titleRef}
        value={title}
        maxLength={300}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        placeholder="Görev adı"
        className="w-full bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-400 dark:text-white"
      />
      <input
        value={description}
        maxLength={4000}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Açıklama"
        className="mt-1 w-full bg-transparent text-sm text-slate-600 outline-none placeholder:text-slate-400 dark:text-slate-300"
      />

      {/* Chip satırı */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Tarih */}
        <div className="relative">
          <button type="button" onClick={() => setMenu(menu === "date" ? null : "date")} className={`${chipCls} ${dueIso ? chipActiveCls : ""}`}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M3 11h18M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" /></svg>
            {dueIso ? dueLabel(dueIso) : "Tarih"}
            {dueIso && <span role="button" onClick={(e) => { e.stopPropagation(); setDueIso(null); }} className="ml-0.5 text-slate-400 hover:text-slate-600">×</span>}
          </button>
          <Pop open={menu === "date"} onClose={() => setMenu(null)}>
            <div className="flex flex-col gap-1">
              <button type="button" onClick={() => { setDueIso(offsetIso(0)); setMenu(null); }} className="rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">Bugün</button>
              <button type="button" onClick={() => { setDueIso(offsetIso(1)); setMenu(null); }} className="rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">Yarın</button>
              <button type="button" onClick={() => { setDueIso(offsetIso(7)); setMenu(null); }} className="rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">Gelecek hafta</button>
              <input type="datetime-local" value={isoToLocalInput(dueIso)} onChange={(e) => setDueIso(e.target.value ? localInputToIso(e.target.value) : null)}
                className="mt-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200" />
              {dueIso && <button type="button" onClick={() => { setDueIso(null); setMenu(null); }} className="rounded-lg px-2 py-1.5 text-left text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">Tarihi kaldır</button>}
            </div>
          </Pop>
        </div>

        {/* Öncelik */}
        <div className="relative">
          <button type="button" onClick={() => setMenu(menu === "priority" ? null : "priority")} className={`${chipCls} ${priority !== 4 ? chipActiveCls : ""}`}>
            <Flag p={priority} />
            {priority !== 4 ? PRIO[priority].label : "Öncelik"}
          </button>
          <Pop open={menu === "priority"} onClose={() => setMenu(null)}>
            <div className="flex flex-col gap-1">
              {([1, 2, 3, 4] as TaskPriority[]).map((p) => (
                <button key={p} type="button" onClick={() => { setPriority(p); setMenu(null); }} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 ${priority === p ? "bg-slate-100 dark:bg-slate-700" : ""}`}>
                  <Flag p={p} /> {PRIO[p].label}
                </button>
              ))}
            </div>
          </Pop>
        </div>

        {/* Etiketler */}
        <div className="relative">
          <button type="button" onClick={() => setMenu(menu === "labels" ? null : "labels")} className={`${chipCls} ${selectedLabels.length ? chipActiveCls : ""}`}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581a2.25 2.25 0 0 0 3.182 0l4.318-4.318a2.25 2.25 0 0 0 0-3.182L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" /></svg>
            {selectedLabels.length ? (selectedLabels.length === 1 ? `@${selectedLabels[0].name}` : `${selectedLabels.length} etiket`) : "Etiketler"}
          </button>
          <Pop open={menu === "labels"} onClose={() => setMenu(null)}>
            <div className="max-h-56 overflow-y-auto">
              {labels.length === 0 && <p className="px-2 py-1 text-xs text-slate-400">Etiket yok.</p>}
              {labels.map((l) => {
                const on = labelIds.includes(l.id);
                return (
                  <button key={l.id} type="button" onClick={() => toggleLabel(l.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700">
                    <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${on ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-300 dark:border-slate-500"}`}>
                      {on && <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </span>
                    <span style={{ color: l.color || LABEL_COLOR }}>@{l.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1 border-t border-slate-100 pt-1.5 dark:border-slate-700">
              <input value={newLabel} maxLength={60} onChange={(e) => setNewLabel(e.target.value)} placeholder="Yeni etiket…"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewLabel(); } }}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200" />
              <button type="button" onClick={addNewLabel} className="rounded-lg bg-slate-100 px-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200">Ekle</button>
            </div>
          </Pop>
        </div>

        {/* Tekrar */}
        <div className="relative">
          <button type="button" onClick={() => setMenu(menu === "recur" ? null : "recur")} className={`${chipCls} ${recurrence ? chipActiveCls : ""}`}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 9a7 7 0 0 1 12-2.5L20 9M18.5 15a7 7 0 0 1-12 2.5L4 15" /></svg>
            {recurrence ? REC_LABELS[recurrence] : "Tekrar"}
          </button>
          <Pop open={menu === "recur"} onClose={() => setMenu(null)}>
            <div className="flex flex-col gap-1">
              {REC_OPTS.map((o) => (
                <button key={o.value} type="button" onClick={() => { setRecurrence(o.value); setMenu(null); }} className={`rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 ${recurrence === o.value ? "bg-slate-100 dark:bg-slate-700" : ""}`}>{o.label}</button>
              ))}
            </div>
          </Pop>
        </div>

        {/* Hatırlatıcı */}
        <button type="button" onClick={() => setShowReminders((s) => !s)} className={`${chipCls} ${reminders.length ? chipActiveCls : ""}`}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" /></svg>
          {reminders.length ? `Hatırlatıcı (${reminders.length})` : "Hatırlatıcı"}
        </button>
      </div>

      {/* Hatırlatıcılar bölümü */}
      {(showReminders || reminders.length > 0) && (
        <div className="mt-3 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
          <ReminderEditor reminders={reminders} due={dueIso} onChange={setReminders} />
        </div>
      )}

      {/* Alt bar: proje seçici + aksiyonlar */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
        <div className="relative">
          <button type="button" onClick={() => setMenu(menu === "project" ? null : "project")} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">
            <span className="text-base font-bold leading-none" style={{ color: project?.color || "#94a3b8" }}>{project?.is_inbox ? "📥" : "#"}</span>
            {project?.name ?? "Proje seç"}
            <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
          </button>
          <Pop open={menu === "project"} onClose={() => setMenu(null)}>
            <div className="max-h-56 overflow-y-auto">
              {lists.map((l) => (
                <button key={l.id} type="button" onClick={() => { setListId(l.id); setMenu(null); }} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 ${listId === l.id ? "bg-slate-100 dark:bg-slate-700" : ""}`}>
                  <span className="text-sm font-bold leading-none" style={{ color: l.color || "#94a3b8" }}>{l.is_inbox ? "📥" : "#"}</span>
                  <span className="text-slate-700 dark:text-slate-200">{l.name}</span>
                </button>
              ))}
            </div>
          </Pop>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600">İptal</button>
          <button type="submit" disabled={pending || !title.trim()} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">Görev ekle</button>
        </div>
      </div>
    </form>
  );
}
