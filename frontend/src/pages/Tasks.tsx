import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Field } from "@/components/ui/Field";
import { DashboardShell } from "@/components/DashboardShell";
import { navForRole, UYE_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBookings } from "@/hooks/useBookings";
import {
  useCreateLabel,
  useCreateTask,
  useCreateTaskFilter,
  useCreateTaskList,
  useCreateSubtask,
  useDeleteLabel,
  useDeleteSubtask,
  useDeleteTask,
  useDeleteTaskFilter,
  useDeleteTaskList,
  useLabels,
  useReorderTaskLists,
  useReorderTasks,
  useTaskFilters,
  useTaskLists,
  useTasks,
  useToggleTask,
  useUpdateLabel,
  useUpdateSubtask,
  useUpdateTask,
  useUpdateTaskFilter,
  useUpdateTaskList,
} from "@/hooks/useTasks";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { classifyDue, isoToLocalInput, type DueGroup } from "@/lib/taskView";
import {
  EMPTY_CRITERIA,
  activeFacetCount,
  applyTaskFilter,
  criteriaActive,
  fromStored,
  sameStored,
  toStored,
  type TaskCriteria,
} from "@/lib/taskFilter";
import { parseQuickAdd } from "@/lib/quickParse";
import { localInputToIso } from "@/lib/datetime";
import TaskCommandPalette, { type RecentRef } from "@/components/TaskCommandPalette";
import TaskComposer from "@/components/TaskComposer";
import ReminderEditor from "@/components/ReminderEditor";
import {
  ROLE_IDS,
  type DueGroupKey,
  type ReminderInput,
  type Task,
  type TaskFilter,
  type TaskLabel,
  type TaskList,
  type TaskPriority,
  type TaskSort,
} from "@/types";

type SmartView = "today" | "upcoming" | "all" | "completed";
type Selection =
  | { kind: "list"; id: number }
  | { kind: "label"; id: number }
  | { kind: "view"; view: SmartView }
  | { kind: "manage" };

const SMART_VIEWS: { view: SmartView; label: string; icon: string }[] = [
  { view: "today", label: "Bugün", icon: "M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
  { view: "upcoming", label: "Yaklaşan", icon: "M8 7V3m8 4V3M3 11h18M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" },
];

// P1 (acil) … P4 (varsayılan) — Todoist renk paleti.
const PRIO: Record<TaskPriority, { label: string; flag: string; chip: string }> = {
  1: { label: "P1", flag: "text-red-500", chip: "bg-red-50 text-red-600 " },
  2: { label: "P2", flag: "text-orange-500", chip: "bg-orange-50 text-orange-600 " },
  3: { label: "P3", flag: "text-blue-500", chip: "bg-blue-50 text-blue-600 " },
  4: { label: "P4", flag: "text-slate-300 ", chip: "bg-slate-100 text-slate-500 " },
};

const REC_LABELS: Record<string, string> = {
  daily: "Her gün",
  weekly: "Her hafta",
  weekdays: "Hafta içi",
  monthly: "Her ay",
  yearly: "Her yıl",
};

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#6366f1", "#a855f7", "#ec4899", "#64748b",
];

const DUE_FILTERS: { key: DueGroupKey; label: string }[] = [
  { key: "overdue", label: "Gecikmiş" },
  { key: "today", label: "Bugün" },
  { key: "upcoming", label: "Yaklaşan" },
  { key: "none", label: "Tarihsiz" },
];

const SORT_OPTS: { value: TaskSort; label: string }[] = [
  { value: "smart", label: "Akıllı sıra" },
  { value: "due", label: "Son tarihe göre" },
  { value: "priority", label: "Önceliğe göre" },
  { value: "alpha", label: "Ada göre" },
];

const DUE_CLS: Record<DueGroup, string> = {
  overdue: "bg-red-50 text-red-600 ",
  today: "bg-amber-50 text-amber-600 ",
  upcoming: "bg-marka-soft text-marka-soft-fg ",
  none: "",
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 ";

const hhmm = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const dayHeaderFmt = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" });

function dueChipLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const isEod = d.getHours() === 23 && d.getMinutes() === 59;
  const timePart = isEod ? "" : ` ${hhmm.format(d)}`;
  let dayPart: string;
  if (d.toDateString() === today.toDateString()) dayPart = "Bugün";
  else if (d.toDateString() === tomorrow.toDateString()) dayPart = "Yarın";
  else dayPart = shortDate.format(d);
  return dayPart + timePart;
}

// ── Küçük UI parçaları ──
function PriorityFlag({ p, className = "h-4 w-4" }: { p: TaskPriority; className?: string }) {
  return (
    <svg className={`${className} ${PRIO[p].flag}`} viewBox="0 0 24 24" fill={p === 4 ? "none" : "currentColor"} stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 21V4h11l-1.5 3.5L15 11H4" />
    </svg>
  );
}

function LabelChip({ label, onClick }: { label: TaskLabel; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${onClick ? "cursor-pointer" : ""}`}
      style={{
        backgroundColor: (label.color || "#64748b") + "22",
        color: label.color || "#64748b",
      }}
    >
      @{label.name}
    </span>
  );
}

function DueChip({ iso, recurrence }: { iso?: string | null; recurrence?: string | null }) {
  if (!iso) {
    if (recurrence) {
      return (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ">
          🔁 {REC_LABELS[recurrence] ?? "Tekrar"}
        </span>
      );
    }
    return null;
  }
  const group = classifyDue(iso);
  if (group === "none") return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${DUE_CLS[group]}`}>
      {group === "overdue" ? "⚠ " : ""}
      {dueChipLabel(iso)}
      {recurrence ? ` · 🔁 ${REC_LABELS[recurrence] ?? ""}` : ""}
    </span>
  );
}

// ── Liste (proje) oluştur / düzenle ──
function ListModal({ list, onClose, onCreated }: { list?: TaskList | null; onClose: () => void; onCreated?: (l: TaskList) => void }) {
  const [name, setName] = useState(list?.name ?? "");
  const [color, setColor] = useState<string | null>(list?.color ?? COLORS[5]);
  const create = useCreateTaskList();
  const update = useUpdateTaskList();
  const isEdit = !!list;
  const pending = create.isPending || update.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Proje adı boş olamaz.");
      return;
    }
    const onError = (err: unknown) => toast.error(getErrorMessage(err, "İşlem başarısız."));
    if (isEdit) {
      update.mutate({ id: list!.id, payload: { name: trimmed, color } }, {
        onSuccess: () => { toast.success("Proje güncellendi."); onClose(); },
        onError,
      });
    } else {
      create.mutate({ name: trimmed, color }, {
        onSuccess: (created) => { toast.success("Proje oluşturuldu."); onCreated?.(created); onClose(); },
        onError,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900 ">{isEdit ? "Projeyi Düzenle" : "Yeni Proje"}</h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <input autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. Matematik" className={inputCls} />
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Renk ${c}`}
                className={`h-7 w-7 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-slate-400 " : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 ">İptal</button>
            <button type="submit" disabled={pending} className="rounded-xl bg-marka px-5 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-60">
              {pending ? "Kaydediliyor…" : isEdit ? "Kaydet" : "Oluştur"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Etiket oluştur / düzenle ──
function LabelModal({ label, onClose }: { label?: TaskLabel | null; onClose: () => void }) {
  const [name, setName] = useState(label?.name ?? "");
  const [color, setColor] = useState<string | null>(label?.color ?? COLORS[8]);
  const create = useCreateLabel();
  const update = useUpdateLabel();
  const isEdit = !!label;
  const pending = create.isPending || update.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Etiket adı boş olamaz.");
      return;
    }
    const onError = (err: unknown) => toast.error(getErrorMessage(err, "İşlem başarısız."));
    if (isEdit) {
      update.mutate(
        { id: label!.id, payload: { name: trimmed, color } },
        { onSuccess: () => { toast.success("Etiket güncellendi."); onClose(); }, onError }
      );
    } else {
      create.mutate(
        { name: trimmed, color },
        { onSuccess: () => { toast.success("Etiket oluşturuldu."); onClose(); }, onError }
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 " onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900 ">{isEdit ? "Etiketi Düzenle" : "Yeni Etiket"}</h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <input autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. acil" className={inputCls} />
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} className={`h-7 w-7 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-slate-400 " : ""}`} style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 ">İptal</button>
            <button type="submit" disabled={pending} className="rounded-xl bg-marka px-5 py-2 text-sm font-semibold text-marka-fg hover:bg-marka-hover disabled:opacity-60">{pending ? "Kaydediliyor…" : isEdit ? "Kaydet" : "Oluştur"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Görev detay modalı ──
function TaskDetailModal({ task, lists, allLabels, onClose }: { task: Task; lists: TaskList[]; allLabels: TaskLabel[]; onClose: () => void }) {
  const { data: user } = useCurrentUser();
  const isClient = user?.role_id === ROLE_IDS.CLIENT;
  const update = useUpdateTask();
  const del = useDeleteTask();
  const createSub = useCreateSubtask();
  const updateSub = useUpdateSubtask();
  const deleteSub = useDeleteSubtask();
  const createLabel = useCreateLabel();
  const { data: bookings } = useBookings({});

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [due, setDue] = useState(isoToLocalInput(task.due_at));
  const [recurrence, setRecurrence] = useState(task.recurrence ?? "");
  const [listId, setListId] = useState(task.list_id);
  const [bookingId, setBookingId] = useState<number | "">(task.booking_id ?? "");
  const [labelIds, setLabelIds] = useState<number[]>(task.labels.map((l) => l.id));
  const [reminders, setReminders] = useState<ReminderInput[]>(
    task.reminders.map((r) => ({ type: r.type, offset_minutes: r.offset_minutes, remind_at: r.remind_at }))
  );
  const [newSub, setNewSub] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const toggleLabel = (id: number) =>
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const addNewLabel = async () => {
    const n = newLabel.trim();
    if (!n) return;
    try {
      const lbl = await createLabel.mutateAsync({ name: n, color: COLORS[8] });
      setLabelIds((prev) => (prev.includes(lbl.id) ? prev : [...prev, lbl.id]));
      setNewLabel("");
    } catch (err) {
      toast.error(getErrorMessage(err, "Etiket eklenemedi."));
    }
  };

  const save = () => {
    if (!title.trim()) {
      toast.error("Görev başlığı boş olamaz.");
      return;
    }
    update.mutate(
      {
        id: task.id,
        payload: {
          title: title.trim(),
          description: description.trim() || null,
          priority,
          due_at: due ? localInputToIso(due) : null,
          recurrence: recurrence || null,
          list_id: listId,
          booking_id: bookingId === "" ? null : Number(bookingId),
          label_ids: labelIds,
          reminders: reminders.filter((r) => (r.type === "absolute" ? !!r.remind_at : true)),
        },
      },
      {
        onSuccess: () => {
          toast.success("Görev güncellendi.");
          onClose();
        },
        onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
      }
    );
  };

  const subtasks = task.subtasks ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-slate-900 ">Görev Detayı</h2>
          <button onClick={onClose} aria-label="Kapat" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 ">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <Field label="Başlık" required labelClassName="mb-1.5 block text-xs font-medium text-slate-500 ">
            {(id) => (
                <input
                    id={id} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            )}
          </Field>
          <Field label="Açıklama" labelClassName="mb-1.5 block text-xs font-medium text-slate-500 ">
            {(id) => (
                <textarea
                    id={id} rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-slate-500 ">Öncelik</span>
              <div role="group" aria-label="Öncelik" className="flex gap-1.5">
                {([1, 2, 3, 4] as TaskPriority[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-lg border py-2 text-xs font-semibold transition ${
                      priority === p ? "border-marka-mid bg-marka-soft " : "border-slate-200 "
                    }`}
                  >
                    <PriorityFlag p={p} className="h-3.5 w-3.5" />
                    {PRIO[p].label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Son tarih" labelClassName="mb-1.5 block text-xs font-medium text-slate-500 ">
              {(id) => (
                  <input
                    id={id} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
              )}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tekrar" labelClassName="mb-1.5 block text-xs font-medium text-slate-500 ">
              {(id) => (
                  <select
                    id={id} value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={inputCls}>
                    <option value="">Tekrar yok</option>
                    <option value="daily">Her gün</option>
                    <option value="weekdays">Hafta içi</option>
                    <option value="weekly">Her hafta</option>
                    <option value="monthly">Her ay</option>
                    <option value="yearly">Her yıl</option>
                  </select>
              )}
            </Field>
            <Field label="Proje" labelClassName="mb-1.5 block text-xs font-medium text-slate-500 ">
              {(id) => (
                  <select
                    id={id} value={listId} onChange={(e) => setListId(Number(e.target.value))} className={inputCls}>
                    {lists.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
                  </select>
              )}
            </Field>
          </div>

          {/* Hatırlatıcılar */}
          <div>
            {/* Alt bileşen kendi kontrollerini çizer; <label> hiçbir kontrole
                bağlanamaz, grup adı olarak duyurulur. */}
            <span className="mb-1.5 block text-xs font-medium text-slate-500 ">Hatırlatıcılar</span>
            <div role="group" aria-label="Hatırlatıcılar">
              <ReminderEditor reminders={reminders} due={due ? localInputToIso(due) : null} onChange={setReminders} />
            </div>
          </div>

          <Field label="Ders (opsiyonel)" labelClassName="mb-1.5 block text-xs font-medium text-slate-500 ">
            {(id) => (
                <select
                    id={id} value={bookingId} onChange={(e) => setBookingId(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
                  <option value="">— Yok —</option>
                  {(bookings ?? []).map((b) => (
                    <option key={b.id} value={b.id}>{(isClient ? b.tutor_name : b.client_name) || `Ders #${b.id}`}</option>
                  ))}
                </select>
            )}
          </Field>

          {/* Etiketler */}
          <div>
            <span className="mb-1.5 block text-xs font-medium text-slate-500 ">Etiketler</span>
            <div role="group" aria-label="Etiketler" className="flex flex-wrap gap-1.5">
              {allLabels.map((l) => {
                const on = labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggleLabel(l.id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${on ? "ring-2 ring-offset-1 " : "opacity-60"}`}
                    style={{ backgroundColor: (l.color || "#64748b") + "22", color: l.color || "#64748b" }}
                  >
                    @{l.name}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={newLabel} maxLength={60} onChange={(e) => setNewLabel(e.target.value)} placeholder="Yeni etiket…" className={inputCls}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewLabel(); } }} />
              <button type="button" onClick={addNewLabel} className="rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-200 ">Ekle</button>
            </div>
          </div>

          {/* Alt görevler */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500 ">
              Alt görevler ({subtasks.filter((s) => s.is_done).length}/{subtasks.length})
            </label>
            <div className="space-y-1.5">
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 ">
                  <input type="checkbox" checked={s.is_done} onChange={() => updateSub.mutate({ id: s.id, payload: { is_done: !s.is_done } })} className="h-4 w-4 rounded border-slate-300 text-marka-metin focus:ring-marka-focus accent-marka" />
                  <span className={`flex-1 text-sm ${s.is_done ? "text-slate-400 line-through" : "text-slate-700 "}`}>{s.title}</span>
                  <button onClick={() => deleteSub.mutate(s.id)} aria-label="Sil" className="rounded p-1 text-slate-400 hover:text-red-500">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = newSub.trim(); if (!t) return; createSub.mutate({ taskId: task.id, title: t }, { onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")) }); setNewSub(""); }}>
              <input value={newSub} maxLength={200} onChange={(e) => setNewSub(e.target.value)} placeholder="Alt görev ekle…" className={inputCls} />
              <button type="submit" className="rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-200 ">Ekle</button>
            </form>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button onClick={() => del.mutate(task.id, { onSuccess: () => { toast.success("Görev silindi."); onClose(); }, onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")) })} disabled={del.isPending} className="rounded-xl px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 ">Sil</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 ">Kapat</button>
            <button onClick={save} disabled={update.isPending} className="rounded-xl bg-marka px-5 py-2 text-sm font-semibold text-marka-fg hover:bg-marka-hover disabled:opacity-60">{update.isPending ? "Kaydediliyor…" : "Kaydet"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Görev satırı (sürükle-bırak destekli) ──
function TaskRow({
  task, onOpen, depth = 0, draggable = false,
  onDragStart, onDragOverRow, onDrop, onDragEnd,
  dropMode = null, childCount = 0, collapsed = false, onToggleCollapse,
}: {
  task: Task;
  onOpen: () => void;
  depth?: number;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOverRow?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  dropMode?: "child" | "sibling" | null;
  childCount?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const toggle = useToggleTask();
  const del = useDeleteTask();
  const done = !!task.completed_at;
  const subDone = task.subtasks.filter((s) => s.is_done).length;

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOverRow}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{ marginLeft: depth * 26 }}
      className={`group relative flex items-center gap-1.5 rounded-xl border bg-white px-2 py-2.5 transition-colors ${
        dropMode === "child"
          ? "border-transparent ring-2 ring-inset ring-marka-focus"
          : "border-slate-100 hover:bg-slate-50 "
      }`}
    >
      {/* Kardeş bırakma çizgisi (layout shift yok) */}
      {dropMode === "sibling" && <span className="pointer-events-none absolute -top-1 left-0 right-0 h-0.5 rounded bg-marka-mid" />}

      {/* Tutma tutamacı — rezerve gutter, hover'da görünür */}
      <span className={`flex w-4 flex-none justify-center text-slate-300 ${draggable ? "cursor-grab opacity-0 group-hover:opacity-100" : "opacity-0"}`} aria-hidden>
        {draggable && (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" /></svg>
        )}
      </span>

      {/* Aç/kapa oku (alt görev varsa) */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
        aria-label={collapsed ? "Genişlet" : "Daralt"}
        className={`flex h-4 w-4 flex-none items-center justify-center rounded text-slate-400 transition hover:bg-slate-200 ${childCount > 0 ? "" : "invisible"}`}
      >
        <svg className={`h-3.5 w-3.5 transition ${collapsed ? "" : "rotate-90"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>

      <button
        onClick={() => toggle.mutate(task.id, {
          onSuccess: () => { if (task.recurrence && task.due_at) toast.success("Sonraki tekrara taşındı."); },
          onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
        })}
        aria-label={done ? "Geri al" : "Tamamla"}
        className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 transition ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-400 "}`}
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      </button>

      {task.priority !== 4 && !done && <PriorityFlag p={task.priority} className="h-4 w-4 flex-none" />}

      <button onClick={onOpen} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className={`truncate text-sm font-medium ${done ? "text-slate-400 line-through" : "text-slate-800 "}`}>{task.title}</span>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {!done && <DueChip iso={task.due_at} recurrence={task.recurrence} />}
          {task.labels.map((l) => (<LabelChip key={l.id} label={l} />))}
          {childCount > 0 && (
            <span className="rounded-full bg-marka-soft px-2 py-0.5 text-[11px] font-medium text-marka-soft-fg ">⊟ {childCount} alt görev</span>
          )}
          {task.subtasks.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ">☑ {subDone}/{task.subtasks.length}</span>
          )}
          {task.booking_id && (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-600 ">Derse bağlı</span>
          )}
        </div>
      </button>

      {/* Düzenleme ikonları — hover'da, layout shift yok */}
      <div className="flex flex-none items-center gap-0.5 text-slate-400 opacity-0 transition group-hover:opacity-100">
        <button onClick={onOpen} aria-label="Düzenle" className="rounded-lg p-1.5 hover:bg-slate-100 hover:text-marka-metin ">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
        </button>
        <button onClick={() => { if (!window.confirm(`"${task.title}" görevi${childCount > 0 ? " ve alt görevleri" : ""} silinsin mi?`)) return; del.mutate(task.id, { onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")) }); }} aria-label="Sil" className="rounded-lg p-1.5 hover:bg-slate-100 hover:text-red-500 ">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
        </button>
      </div>
    </div>
  );
}

// ── Görev ağacı (iç içe alt görev + sürükle-bırak/girinti) ──
function TaskTree({ tasks, onOpen, onReorder, onReparent }: {
  tasks: Task[];
  onOpen: (id: number) => void;
  onReorder: (ids: number[]) => void;
  onReparent: (id: number, parentId: number | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const dragId = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: number; mode: "child" | "sibling" } | null>(null);

  const { byId, childrenOf, rows } = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const childrenOf = new Map<number | null, Task[]>();
    for (const t of tasks) {
      const p = t.parent_id != null && byId.has(t.parent_id) ? t.parent_id : null;
      const arr = childrenOf.get(p) ?? [];
      arr.push(t);
      childrenOf.set(p, arr);
    }
    const rows: { task: Task; depth: number }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const t of childrenOf.get(parent) ?? []) {
        rows.push({ task: t, depth });
        if (!collapsed.has(t.id)) walk(t.id, depth + 1);
      }
    };
    walk(null, 0);
    return { byId, childrenOf, rows };
  }, [tasks, collapsed]);

  const isDescendant = (ancestorId: number, nodeId: number): boolean => {
    let cur = byId.get(nodeId);
    const guard = new Set<number>();
    while (cur && cur.parent_id != null && !guard.has(cur.id)) {
      guard.add(cur.id);
      if (cur.parent_id === ancestorId) return true;
      cur = byId.get(cur.parent_id);
    }
    return false;
  };

  const toggleCollapse = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const onDragOverRow = (e: React.DragEvent, targetId: number) => {
    const from = dragId.current;
    if (from == null || from === targetId) return;
    if (isDescendant(from, targetId)) return; // kendi alt ağacına bırakılamaz
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setDropTarget({ id: targetId, mode: x > 48 ? "child" : "sibling" });
  };

  const onDrop = (targetId: number) => {
    const from = dragId.current;
    const dt = dropTarget;
    dragId.current = null;
    setDropTarget(null);
    if (from == null || dt == null || dt.id !== targetId || from === targetId) return;
    if (isDescendant(from, targetId)) return;
    const target = byId.get(targetId);
    const dragged = byId.get(from);
    if (!target || !dragged) return;

    if (dt.mode === "child") {
      onReparent(from, targetId);
      setCollapsed((prev) => { const n = new Set(prev); n.delete(targetId); return n; });
      return;
    }
    // Kardeş: hedefin üst görevinin altına.
    const newParent = target.parent_id ?? null;
    if ((dragged.parent_id ?? null) !== newParent) {
      onReparent(from, newParent);
      return;
    }
    const siblings = (childrenOf.get(newParent) ?? []).map((s) => s.id);
    const fromIdx = siblings.indexOf(from);
    const toIdx = siblings.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    siblings.splice(toIdx, 0, siblings.splice(fromIdx, 1)[0]);
    onReorder(siblings);
  };

  return (
    <div className="space-y-1.5">
      {rows.map(({ task, depth }) => (
        <TaskRow
          key={task.id}
          task={task}
          depth={depth}
          onOpen={() => onOpen(task.id)}
          draggable
          onDragStart={() => { dragId.current = task.id; }}
          onDragOverRow={(e) => onDragOverRow(e, task.id)}
          onDrop={() => onDrop(task.id)}
          onDragEnd={() => { dragId.current = null; setDropTarget(null); }}
          dropMode={dropTarget?.id === task.id ? dropTarget.mode : null}
          childCount={(childrenOf.get(task.id) ?? []).length}
          collapsed={collapsed.has(task.id)}
          onToggleCollapse={() => toggleCollapse(task.id)}
        />
      ))}
    </div>
  );
}

// ── Filtre Ekle/Düzenle modalı (Todoist 'Add filter') ──
function FilterBuilderModal({ mode, filter, initialCriteria, labels, tasks, projects, labelRefs, pending, onSubmit, onClose }: {
  mode: "create" | "edit";
  filter?: TaskFilter | null;
  initialCriteria?: TaskCriteria;
  labels: TaskLabel[];
  tasks: Task[];
  projects: { id: number; name: string }[];
  labelRefs: { id: number; name: string }[];
  pending: boolean;
  onSubmit: (data: { name: string; color: string | null; is_favorite: boolean; criteria: TaskCriteria }) => void;
  onClose: () => void;
}) {
  const isEdit = mode === "edit";
  const [name, setName] = useState(filter?.name ?? "");
  const [color, setColor] = useState<string | null>(filter?.color ?? COLORS[8]);
  const [isFavorite, setIsFavorite] = useState(filter?.is_favorite ?? false);
  const [criteria, setCriteria] = useState<TaskCriteria>(
    isEdit && filter ? fromStored(filter.criteria) : (initialCriteria ?? EMPTY_CRITERIA)
  );
  const [assist, setAssist] = useState("");

  const togglePriority = (p: TaskPriority) =>
    setCriteria((c) => ({ ...c, priorities: c.priorities.includes(p) ? c.priorities.filter((x) => x !== p) : [...c.priorities, p] }));
  const toggleLabel = (id: number) =>
    setCriteria((c) => ({ ...c, labelIds: c.labelIds.includes(id) ? c.labelIds.filter((x) => x !== id) : [...c.labelIds, id] }));
  const toggleDue = (key: DueGroupKey) =>
    setCriteria((c) => ({ ...c, due: c.due.includes(key) ? c.due.filter((x) => x !== key) : [...c.due, key] }));

  const runAssist = () => {
    const text = assist.trim();
    if (!text) return;
    const p = parseQuickAdd(text, { projects, labels: labelRefs });
    const g = p.dueIso ? classifyDue(p.dueIso) : null;
    setCriteria({
      q: p.title || "",
      priorities: p.priority ? [p.priority as TaskPriority] : [],
      labelIds: p.labelIds,
      due: g && g !== "none" ? [g as DueGroupKey] : [],
      sort: criteria.sort,
    });
    if (!name.trim()) setName(text.length > 40 ? text.slice(0, 40) : text);
  };

  const preview = applyTaskFilter(tasks, criteria);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Filtre adı boş olamaz."); return; }
    onSubmit({ name: trimmed, color, is_favorite: isFavorite, criteria });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[8vh] backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[84vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 ">{isEdit ? "Filtreyi Düzenle" : "Filtre Ekle"}</h2>
          <button onClick={onClose} aria-label="Kapat" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 ">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-4">
          {/* Filtre Yardımcısı (doğal dil → kriter) */}
          <div className="rounded-2xl border border-marka-line bg-marka-soft/60 p-3 ">
            <div className="flex items-center gap-2">
              <span className="text-base">✨</span>
              <span className="text-sm font-semibold text-slate-800 ">Filtre Yardımcısı</span>
            </div>
            <p className="mt-1 text-xs text-slate-500 ">İstediğin filtreyi yaz; kriterleri senin için çıkaralım. Örn: “bugün !1 @acil”.</p>
            <div className="mt-2 flex gap-2">
              <input value={assist} onChange={(e) => setAssist(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runAssist(); } }}
                placeholder="Filtreyi tarif et…" className={inputCls} />
              <button type="button" onClick={runAssist} className="flex-none rounded-xl bg-marka px-4 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover">Dene</button>
            </div>
          </div>

          {/* Ad */}
          <Field label="Ad" labelClassName="mb-1.5 block text-xs font-medium text-slate-500 ">
            {(id) => (
                <input
                    id={id} autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. Acil & bugün" className={inputCls} />
            )}
          </Field>

          {/* Renk + favori */}
          <div className="flex items-end justify-between gap-4">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-slate-500 ">Renk</span>
              <div role="group" aria-label="Renk" className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Renk ${c}`}
                    className={`h-7 w-7 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-slate-400 " : ""}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <button type="button" onClick={() => setIsFavorite((v) => !v)} className="flex items-center gap-2 pb-1">
              <span className={`relative h-5 w-9 flex-none rounded-full transition ${isFavorite ? "bg-marka" : "bg-slate-300 "}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${isFavorite ? "left-[18px]" : "left-0.5"}`} />
              </span>
              <span className="text-sm font-medium text-slate-600 ">Favorilere ekle</span>
            </button>
          </div>

          {/* Kriterler */}
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 ">
            <Field label="Metin içerir" labelClassName="mb-1.5 block text-xs font-medium text-slate-500 ">
              {(id) => (
                  <input
                    id={id} value={criteria.q} onChange={(e) => setCriteria((c) => ({ ...c, q: e.target.value }))} placeholder="Görev başlığı/açıklamasında ara…" className={inputCls} />
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 flex-none text-xs font-semibold text-slate-400">Öncelik</span>
              {([1, 2, 3, 4] as TaskPriority[]).map((p) => {
                const on = criteria.priorities.includes(p);
                return (
                  <button key={p} type="button" onClick={() => togglePriority(p)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${on ? "border-marka-mid bg-marka-soft text-marka-metin-hover " : "border-slate-200 text-slate-500 "}`}>
                    <PriorityFlag p={p} className="h-3.5 w-3.5" />{PRIO[p].label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 flex-none text-xs font-semibold text-slate-400">Tarih</span>
              {DUE_FILTERS.map((d) => {
                const on = criteria.due.includes(d.key);
                return (
                  <button key={d.key} type="button" onClick={() => toggleDue(d.key)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? "border-marka-mid bg-marka-soft text-marka-metin-hover " : "border-slate-200 text-slate-500 "}`}>{d.label}</button>
                );
              })}
            </div>
            {labels.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 flex-none text-xs font-semibold text-slate-400">Etiket</span>
                {labels.map((l) => {
                  const on = criteria.labelIds.includes(l.id);
                  return (
                    <button key={l.id} type="button" onClick={() => toggleLabel(l.id)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${on ? "ring-2 ring-offset-1 " : "opacity-60 hover:opacity-100"}`}
                      style={{ backgroundColor: (l.color || "#64748b") + "22", color: l.color || "#64748b" }}>@{l.name}</button>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 ">
              <span className="w-16 flex-none text-xs font-semibold text-slate-400">Sırala</span>
              <select value={criteria.sort} onChange={(e) => setCriteria((c) => ({ ...c, sort: e.target.value as TaskSort }))}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 outline-none focus:border-marka-mid ">
                {SORT_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
              </select>
            </div>
          </div>

          {/* Önizleme */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 ">Önizleme</span>
              <span className="text-xs font-semibold text-marka-metin ">{preview.length} görev</span>
            </div>
            <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-2 ">
              {preview.length === 0 ? (
                <p className="px-1 py-2 text-xs text-slate-400">Eşleşen görev yok.</p>
              ) : (
                preview.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 px-1 py-1 text-sm text-slate-600 ">
                    {t.priority !== 4 && <PriorityFlag p={t.priority} className="h-3.5 w-3.5 flex-none" />}
                    <span className="truncate">{t.title}</span>
                  </div>
                ))
              )}
              {preview.length > 5 && <p className="px-1 pt-1 text-[11px] text-slate-400">+{preview.length - 5} görev daha</p>}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 ">İptal</button>
            <button type="submit" disabled={pending} className="rounded-xl bg-marka px-5 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-60">{pending ? "Kaydediliyor…" : isEdit ? "Kaydet" : "Ekle"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Filtre çubuğu (öncelik / etiket / son-tarih / sıralama + kaydet) ──
function FilterBar({ criteria, setCriteria, labels, dirty, activeFilterId, savePending, onSaveNew, onUpdate, onClear }: {
  criteria: TaskCriteria;
  setCriteria: (c: TaskCriteria) => void;
  labels: TaskLabel[];
  dirty: boolean;
  activeFilterId: number | null;
  savePending: boolean;
  onSaveNew: () => void;
  onUpdate: () => void;
  onClear: () => void;
}) {
  const togglePriority = (p: TaskPriority) =>
    setCriteria({ ...criteria, priorities: criteria.priorities.includes(p) ? criteria.priorities.filter((x) => x !== p) : [...criteria.priorities, p] });
  const toggleLabel = (id: number) =>
    setCriteria({ ...criteria, labelIds: criteria.labelIds.includes(id) ? criteria.labelIds.filter((x) => x !== id) : [...criteria.labelIds, id] });
  const toggleDue = (key: DueGroupKey) =>
    setCriteria({ ...criteria, due: criteria.due.includes(key) ? criteria.due.filter((x) => x !== key) : [...criteria.due, key] });

  const facets = activeFacetCount(criteria);

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 ">
      {/* Öncelik */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 flex-none text-xs font-semibold text-slate-400">Öncelik</span>
        {([1, 2, 3, 4] as TaskPriority[]).map((p) => {
          const on = criteria.priorities.includes(p);
          return (
            <button key={p} type="button" onClick={() => togglePriority(p)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${on ? "border-marka-mid bg-marka-soft text-marka-metin-hover " : "border-slate-200 text-slate-500 hover:border-slate-300 "}`}>
              <PriorityFlag p={p} className="h-3.5 w-3.5" />
              {PRIO[p].label}
            </button>
          );
        })}
      </div>

      {/* Son tarih */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 flex-none text-xs font-semibold text-slate-400">Tarih</span>
        {DUE_FILTERS.map((d) => {
          const on = criteria.due.includes(d.key);
          return (
            <button key={d.key} type="button" onClick={() => toggleDue(d.key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? "border-marka-mid bg-marka-soft text-marka-metin-hover " : "border-slate-200 text-slate-500 hover:border-slate-300 "}`}>
              {d.label}
            </button>
          );
        })}
      </div>

      {/* Etiket */}
      {labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 flex-none text-xs font-semibold text-slate-400">Etiket</span>
          {labels.map((l) => {
            const on = criteria.labelIds.includes(l.id);
            return (
              <button key={l.id} type="button" onClick={() => toggleLabel(l.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${on ? "ring-2 ring-offset-1 " : "opacity-60 hover:opacity-100"}`}
                style={{ backgroundColor: (l.color || "#64748b") + "22", color: l.color || "#64748b" }}>
                @{l.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Sıralama + aksiyonlar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 ">
        <span className="w-16 flex-none text-xs font-semibold text-slate-400">Sırala</span>
        <select value={criteria.sort} onChange={(e) => setCriteria({ ...criteria, sort: e.target.value as TaskSort })}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 outline-none focus:border-marka-mid ">
          {SORT_OPTS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {facets > 0 && (
            <button type="button" onClick={onClear} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-200 ">
              Temizle
            </button>
          )}
          {activeFilterId !== null && dirty && (
            <button type="button" onClick={onUpdate} disabled={savePending} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
              Filtreyi güncelle
            </button>
          )}
          {facets > 0 && (
            <button type="button" onClick={onSaveNew} disabled={savePending} className="rounded-lg bg-marka px-3 py-1.5 text-xs font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-60">
              {activeFilterId !== null ? "Farklı kaydet" : "Filtreyi kaydet"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Filtreler ve Etiketler yönetim sayfası (Todoist 'Filters & Labels') ──
function FiltersAndLabelsPanel({
  filters, labels, labelCounts,
  onApplyFilter, onEditFilter, onDeleteFilter, onToggleFilterFav, onAddFilter,
  onSelectLabel, onEditLabel, onDeleteLabel, onToggleLabelFav, onAddLabel,
}: {
  filters: TaskFilter[];
  labels: TaskLabel[];
  labelCounts: Map<number, number>;
  onApplyFilter: (f: TaskFilter) => void;
  onEditFilter: (f: TaskFilter) => void;
  onDeleteFilter: (f: TaskFilter) => void;
  onToggleFilterFav: (f: TaskFilter) => void;
  onAddFilter: () => void;
  onSelectLabel: (l: TaskLabel) => void;
  onEditLabel: (l: TaskLabel) => void;
  onDeleteLabel: (l: TaskLabel) => void;
  onToggleLabelFav: (l: TaskLabel) => void;
  onAddLabel: () => void;
}) {
  const Pencil = () => (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
  );
  const Trash = () => (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
  );
  const AddBtn = ({ onClick, label }: { onClick: () => void; label: string }) => (
    <button onClick={onClick} aria-label={label} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-marka-metin ">
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
    </button>
  );

  return (
    <div className="space-y-8">
      {/* Filtrelerim */}
      <section>
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 ">
          <h2 className="text-base font-bold text-slate-800 ">Filtrelerim</h2>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ">{filters.length} filtre</span>
          <span className="ml-auto" />
          <AddBtn onClick={onAddFilter} label="Filtre ekle" />
        </div>
        {filters.length === 0 ? (
          <p className="px-1 py-4 text-sm text-slate-400">Henüz filtre yok. Sağ üstteki + ile ekle.</p>
        ) : (
          <div className="mt-1">
            {filters.map((f) => (
              <div key={f.id} className="group flex items-center gap-3 border-b border-slate-50 px-1 py-2.5 transition hover:bg-slate-50 ">
                <button onClick={() => onApplyFilter(f)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <svg className="h-5 w-5 flex-none" viewBox="0 0 24 24" fill="none" stroke={f.color || "#64748b"} strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18l-7 8v6l-4 2v-8l-7-8Z" /></svg>
                  <span className="truncate text-sm font-medium text-slate-700 ">{f.name}</span>
                </button>
                <div className="flex flex-none items-center gap-0.5 text-slate-400 opacity-0 transition group-hover:opacity-100">
                  <FavStar on={f.is_favorite} onClick={() => onToggleFilterFav(f)} />
                  <button onClick={() => onEditFilter(f)} aria-label="Düzenle" className="rounded p-1 hover:text-marka-metin"><Pencil /></button>
                  <button onClick={() => onDeleteFilter(f)} aria-label="Sil" className="rounded p-1 hover:text-red-500"><Trash /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Etiketler */}
      <section>
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2 ">
          <h2 className="text-base font-bold text-slate-800 ">Etiketler</h2>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ">{labels.length} etiket</span>
          <span className="ml-auto" />
          <AddBtn onClick={onAddLabel} label="Etiket ekle" />
        </div>
        {labels.length === 0 ? (
          <p className="px-1 py-4 text-sm text-slate-400">Henüz etiket yok. Sağ üstteki + ile ekle.</p>
        ) : (
          <div className="mt-1">
            {labels.map((l) => {
              const count = labelCounts.get(l.id) ?? 0;
              return (
                <div key={l.id} className="group flex items-center gap-3 border-b border-slate-50 px-1 py-2.5 transition hover:bg-slate-50 ">
                  <button onClick={() => onSelectLabel(l)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <svg className="h-5 w-5 flex-none" viewBox="0 0 24 24" fill="none" stroke={l.color || "#94a3b8"} strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581a2.25 2.25 0 0 0 3.182 0l4.318-4.318a2.25 2.25 0 0 0 0-3.182L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" /></svg>
                    <span className="truncate text-sm font-medium text-slate-700 ">{l.name}</span>
                  </button>
                  {count > 0 && <span className="flex-none text-xs font-semibold text-slate-400 group-hover:hidden">{count}</span>}
                  <div className="flex flex-none items-center gap-0.5 text-slate-400 opacity-0 transition group-hover:opacity-100">
                    <FavStar on={l.is_favorite} onClick={() => onToggleLabelFav(l)} />
                    <button onClick={() => onEditLabel(l)} aria-label="Düzenle" className="rounded p-1 hover:text-marka-metin"><Pencil /></button>
                    <button onClick={() => onDeleteLabel(l)} aria-label="Sil" className="rounded p-1 hover:text-red-500"><Trash /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Favori yıldızı (proje/etiket/filtre satırlarında) ──
function FavStar({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={on ? "Favorilerden çıkar" : "Favorilere ekle"}
      className={`rounded p-1 transition ${on ? "text-amber-400" : "text-slate-400 hover:text-amber-400"}`}
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.5l2.2 4.46 4.92.72-3.56 3.47.84 4.9-4.4-2.31-4.4 2.31.84-4.9-3.56-3.47 4.92-.72 2.2-4.46Z" />
      </svg>
    </button>
  );
}

// Renkli '#' proje ikonu (Todoist tarzı).
function HashIcon({ color }: { color?: string | null }) {
  return (
    <span className="flex-none text-sm font-bold leading-none" style={{ color: color || "#94a3b8" }}>#</span>
  );
}

export default function Tasks() {
  const { data: user } = useCurrentUser();
  const navItems = navForRole(user?.role_id) ?? UYE_NAV;

  const { data: lists, isLoading: listsLoading } = useTaskLists();
  const { data: labels } = useLabels();
  const { data: filters } = useTaskFilters();
  const [selection, setSelection] = useState<Selection>({ kind: "view", view: "today" });
  const [creatingList, setCreatingList] = useState(false);
  const [editingList, setEditingList] = useState<TaskList | null>(null);
  const [editingLabel, setEditingLabel] = useState<TaskLabel | null>(null);
  const [creatingLabel, setCreatingLabel] = useState(false);
  // Filtre oluştur/düzenle modalı (Todoist 'Add filter').
  const [builder, setBuilder] = useState<{ mode: "create" | "edit"; filter?: TaskFilter | null; initialCriteria?: TaskCriteria } | null>(null);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);

  // Arama + filtre çubuğu durumu (camelCase çalışma kriteri).
  const [criteria, setCriteria] = useState<TaskCriteria>(EMPTY_CRITERIA);
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Favoriler / projeler bölümü açık-kapalı.
  const [favOpen, setFavOpen] = useState(true);
  const [projOpen, setProjOpen] = useState(true);
  // Komut paleti (Todoist 'Search', Ctrl/⌘+K) ve liste-altı görev ekleme composer'ı.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [recents, setRecents] = useState<RecentRef[]>(() => {
    try { return JSON.parse(localStorage.getItem("task_recents") || "[]"); } catch { return []; }
  });

  // Ctrl/⌘+K ile komut paletini aç/kapat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pushRecent = (r: RecentRef) => {
    setRecents((prev) => {
      const next = [r, ...prev.filter((x) => !(x.kind === r.kind && x.id === r.id))].slice(0, 8);
      try { localStorage.setItem("task_recents", JSON.stringify(next)); } catch { /* yoksay */ }
      return next;
    });
  };

  const createTask = useCreateTask();
  const deleteList = useDeleteTaskList();
  const deleteLabel = useDeleteLabel();
  const reorderTasks = useReorderTasks();
  const reorderLists = useReorderTaskLists();
  const createFilter = useCreateTaskFilter();
  const updateFilter = useUpdateTaskFilter();
  const deleteFilter = useDeleteTaskFilter();
  const updateListFav = useUpdateTaskList();
  const updateLabelFav = useUpdateLabel();
  const updateTask = useUpdateTask();

  // Akıllı görünümler + Bugün rozeti için her zaman aktif görevleri çek.
  const allActive = useTasks({ status: "active" });
  const listTasks = useTasks({ listId: selection.kind === "list" ? selection.id : null, status: "all", enabled: selection.kind === "list" });
  const labelTasks = useTasks({ labelId: selection.kind === "label" ? selection.id : null, status: "active", enabled: selection.kind === "label" });
  const completedTasks = useTasks({ status: "completed", enabled: selection.kind === "view" && selection.view === "completed" });

  const projects = useMemo(() => (lists ?? []).map((l) => ({ id: l.id, name: l.name })), [lists]);
  const labelRefs = useMemo(() => (labels ?? []).map((l) => ({ id: l.id, name: l.name })), [labels]);

  const todayCount = useMemo(
    () => (allActive.data ?? []).filter((t) => ["today", "overdue"].includes(classifyDue(t.due_at) ?? "")).length,
    [allActive.data]
  );
  const upcomingCount = useMemo(
    () => (allActive.data ?? []).filter((t) => classifyDue(t.due_at) === "upcoming").length,
    [allActive.data]
  );

  const { source, loading } = useMemo(() => {
    if (selection.kind === "list") return { source: listTasks.data ?? [], loading: listTasks.isLoading };
    if (selection.kind === "label") return { source: labelTasks.data ?? [], loading: labelTasks.isLoading };
    if (selection.kind === "view" && selection.view === "completed") return { source: completedTasks.data ?? [], loading: completedTasks.isLoading };
    return { source: allActive.data ?? [], loading: allActive.isLoading };
  }, [selection, listTasks, labelTasks, completedTasks, allActive]);

  const visibleTasks = useMemo(() => {
    if (selection.kind === "view" && selection.view === "today") {
      return source.filter((t) => ["today", "overdue"].includes(classifyDue(t.due_at) ?? ""));
    }
    if (selection.kind === "view" && selection.view === "upcoming") {
      return source.filter((t) => classifyDue(t.due_at) === "upcoming");
    }
    return source;
  }, [source, selection]);

  const inboxId = lists?.find((l) => l.is_inbox)?.id ?? lists?.[0]?.id;

  // ── Arama / filtre modu ──
  const filterMode = criteriaActive(criteria);
  const filteredTasks = useMemo(
    () => applyTaskFilter(allActive.data ?? [], criteria),
    [allActive.data, criteria]
  );
  const activeFilter = (filters ?? []).find((f) => f.id === activeFilterId) ?? null;
  const filterDirty = activeFilter
    ? !sameStored(toStored(criteria), activeFilter.criteria)
    : false;
  const facetCount = activeFacetCount(criteria);

  const updateCriteria = (c: TaskCriteria) => {
    setCriteria(c);
    if (!criteriaActive(c)) setActiveFilterId(null);
  };
  const selectNav = (s: Selection) => {
    setCriteria(EMPTY_CRITERIA);
    setActiveFilterId(null);
    setShowFilters(false);
    setSelection(s);
    if (s.kind === "list" && !(lists ?? []).find((l) => l.id === s.id)?.is_inbox) pushRecent({ kind: "list", id: s.id });
    else if (s.kind === "label") pushRecent({ kind: "label", id: s.id });
  };
  const applySavedFilter = (f: TaskFilter) => {
    setCriteria(fromStored(f.criteria));
    setActiveFilterId(f.id);
    setShowFilters(true);
    pushRecent({ kind: "filter", id: f.id });
  };
  const searchAll = (q: string) => {
    setActiveFilterId(null);
    setCriteria({ ...EMPTY_CRITERIA, q });
  };
  const clearFilter = () => {
    setCriteria(EMPTY_CRITERIA);
    setActiveFilterId(null);
  };
  const onFilterErr = (err: unknown) => toast.error(getErrorMessage(err, "İşlem başarısız."));
  // FilterBuilderModal submit — oluştur veya düzenle.
  const submitBuilder = (data: { name: string; color: string | null; is_favorite: boolean; criteria: TaskCriteria }) => {
    const payload = { name: data.name, color: data.color, is_favorite: data.is_favorite, criteria: toStored(data.criteria) };
    if (builder?.mode === "edit" && builder.filter) {
      updateFilter.mutate(
        { id: builder.filter.id, payload },
        { onSuccess: () => { toast.success("Filtre güncellendi."); setBuilder(null); }, onError: onFilterErr }
      );
    } else {
      createFilter.mutate(payload, {
        onSuccess: () => { toast.success("Filtre oluşturuldu."); setBuilder(null); },
        onError: onFilterErr,
      });
    }
  };
  // FilterBar 'Filtreyi güncelle' — aktif filtrenin kriterlerini günceller.
  const updateFilterCriteria = () => {
    if (activeFilterId == null) return;
    updateFilter.mutate(
      { id: activeFilterId, payload: { criteria: toStored(criteria) } },
      { onSuccess: () => toast.success("Filtre güncellendi."), onError: onFilterErr }
    );
  };

  // ── Favoriler ──
  const toggleListFav = (l: TaskList) =>
    updateListFav.mutate({ id: l.id, payload: { is_favorite: !l.is_favorite } }, { onError: onFilterErr });
  const toggleLabelFav = (l: TaskLabel) =>
    updateLabelFav.mutate({ id: l.id, payload: { is_favorite: !l.is_favorite } }, { onError: onFilterErr });
  const toggleFilterFav = (f: TaskFilter) =>
    updateFilter.mutate({ id: f.id, payload: { is_favorite: !f.is_favorite } }, { onError: onFilterErr });

  const inbox = (lists ?? []).find((l) => l.is_inbox);
  const projectsOnly = (lists ?? []).filter((l) => !l.is_inbox);
  const favProjects = projectsOnly.filter((l) => l.is_favorite);
  const favLabels = (labels ?? []).filter((l) => l.is_favorite);
  const favFilters = (filters ?? []).filter((f) => f.is_favorite);
  const hasFavorites = favProjects.length + favLabels.length + favFilters.length > 0;

  // Etikete bağlı aktif görev sayısı (yönetim sayfası rozetleri).
  const labelCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of allActive.data ?? []) for (const l of t.labels) m.set(l.id, (m.get(l.id) || 0) + 1);
    return m;
  }, [allActive.data]);

  const headerTitle =
    filterMode ? (activeFilter?.name ?? "Filtre sonuçları")
    : selection.kind === "list" ? lists?.find((l) => l.id === selection.id)?.name ?? "Proje"
    : selection.kind === "label" ? `@${labels?.find((l) => l.id === selection.id)?.name ?? "etiket"}`
    : selection.kind === "manage" ? "Filtreler ve Etiketler"
    : SMART_VIEWS.find((v) => v.view === selection.view)?.label ?? "Görevler";

  // Proje sürükle-bırak (Gelen Kutusu hariç).
  const dragListId = useRef<number | null>(null);
  const handleListDrop = (targetId: number) => {
    const from = dragListId.current;
    dragListId.current = null;
    const movable = (lists ?? []).filter((l) => !l.is_inbox);
    if (from == null || from === targetId) return;
    const ids = movable.map((l) => l.id);
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);
    reorderLists.mutate(ids, { onError: (err) => toast.error(getErrorMessage(err, "Sıralanamadı.")) });
  };

  const openTask =
    filteredTasks.find((t) => t.id === openTaskId) ??
    visibleTasks.find((t) => t.id === openTaskId) ??
    source.find((t) => t.id === openTaskId);

  return (
    <DashboardShell title="Görevlerim" navItems={navItems}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row">
        {/* Kenar çubuğu */}
        <aside className="lg:w-64 lg:flex-none">
          {/* Görev Ekle (Todoist tarzı: renkli artı + metin, dolu arka plan yok) */}
          <button onClick={() => setComposerOpen(true)} className="group mb-2 flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-sm font-semibold text-marka-metin transition hover:bg-slate-100 ">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-marka text-marka-fg transition group-hover:bg-marka-hover">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" /></svg>
            </span>
            Görev Ekle
          </button>

          {/* Üst gezinme */}
          <nav className="space-y-1">
            {/* Ara (Todoist 'Search') — komut paletini açar (Ctrl/⌘+K) */}
            <button onClick={() => setPaletteOpen(true)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 ">
              <svg className="h-4 w-4 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" /></svg>
              <span className="flex-1 text-left">Ara</span>
              <kbd className="flex-none rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 ">Ctrl K</kbd>
            </button>
            {inbox && (() => {
              const active = !filterMode && selection.kind === "list" && selection.id === inbox.id;
              return (
                <button onClick={() => selectNav({ kind: "list", id: inbox.id })}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? "bg-marka text-marka-fg shadow-sm" : "text-slate-600 hover:bg-slate-100 "}`}>
                  <svg className="h-4 w-4 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M2 13h4l2 4h8l2-4h4M5 5h14l3 8v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6L5 5Z" /></svg>
                  <span className="flex-1 text-left">Gelen Kutusu</span>
                  {inbox.active_count > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600 "}`}>{inbox.active_count}</span>
                  )}
                </button>
              );
            })()}
            {SMART_VIEWS.map((v) => {
              const active = !filterMode && selection.kind === "view" && selection.view === v.view;
              const badge = v.view === "today" ? todayCount : v.view === "upcoming" ? upcomingCount : 0;
              return (
                <button key={v.view} onClick={() => selectNav({ kind: "view", view: v.view })}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? "bg-marka text-marka-fg shadow-sm" : "text-slate-600 hover:bg-slate-100 "}`}>
                  <svg className="h-4 w-4 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={v.icon} /></svg>
                  <span className="flex-1 text-left">{v.label}</span>
                  {badge > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600 "}`}>{badge}</span>
                  )}
                </button>
              );
            })}
            {/* Filtreler ve Etiketler — yönetim sayfasını açar */}
            <button onClick={() => selectNav({ kind: "manage" })}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${!filterMode && selection.kind === "manage" ? "bg-marka text-marka-fg shadow-sm" : "text-slate-600 hover:bg-slate-100 "}`}>
              <svg className="h-4 w-4 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 6a1 1 0 0 0-1 1v1.5a1 1 0 0 0 .3.7l5.4 5.3a1 1 0 0 1 .3.7V20l4-2.5v-3.6a1 1 0 0 1 .3-.7l5.4-5.3a1 1 0 0 0 .3-.7V7a1 1 0 0 0-1-1" /></svg>
              <span className="flex-1 text-left">Filtreler ve Etiketler</span>
            </button>
          </nav>

          {/* Favoriler */}
          {hasFavorites && (
            <div className="mt-6">
              <button onClick={() => setFavOpen((s) => !s)} className="mb-2 flex w-full items-center gap-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 transition hover:text-slate-500">
                <svg className={`h-3 w-3 transition ${favOpen ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                Favoriler
              </button>
              {favOpen && (
                <nav className="space-y-1">
                  {favProjects.map((l) => {
                    const active = !filterMode && selection.kind === "list" && selection.id === l.id;
                    return (
                      <div key={`fp${l.id}`} className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-slate-100 " : "hover:bg-slate-50 "}`}>
                        <button onClick={() => selectNav({ kind: "list", id: l.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <HashIcon color={l.color} />
                          <span className={`truncate font-medium ${active ? "text-slate-900 " : "text-slate-600 "}`}>{l.name}</span>
                          {l.active_count > 0 && <span className="ml-auto flex-none text-[11px] font-semibold text-slate-400">{l.active_count}</span>}
                        </button>
                        <span className="flex-none opacity-0 transition group-hover:opacity-100"><FavStar on onClick={() => toggleListFav(l)} /></span>
                      </div>
                    );
                  })}
                  {favFilters.map((f) => {
                    const active = activeFilterId === f.id;
                    return (
                      <div key={`ff${f.id}`} className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-slate-100 " : "hover:bg-slate-50 "}`}>
                        <button onClick={() => applySavedFilter(f)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <svg className="h-3.5 w-3.5 flex-none" viewBox="0 0 24 24" fill="none" stroke={f.color || "#64748b"} strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18l-7 8v6l-4 2v-8l-7-8Z" /></svg>
                          <span className={`truncate font-medium ${active ? "text-slate-900 " : "text-slate-600 "}`}>{f.name}</span>
                        </button>
                        <span className="flex-none opacity-0 transition group-hover:opacity-100"><FavStar on onClick={() => toggleFilterFav(f)} /></span>
                      </div>
                    );
                  })}
                  {favLabels.map((l) => {
                    const active = !filterMode && selection.kind === "label" && selection.id === l.id;
                    return (
                      <div key={`fl${l.id}`} className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-slate-100 " : "hover:bg-slate-50 "}`}>
                        <button onClick={() => selectNav({ kind: "label", id: l.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <span className="flex-none text-sm font-bold leading-none" style={{ color: l.color || "#64748b" }}>@</span>
                          <span className={`truncate font-medium ${active ? "text-slate-900 " : "text-slate-600 "}`}>{l.name}</span>
                        </button>
                        <span className="flex-none opacity-0 transition group-hover:opacity-100"><FavStar on onClick={() => toggleLabelFav(l)} /></span>
                      </div>
                    );
                  })}
                </nav>
              )}
            </div>
          )}

          {/* Projelerim */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between px-3">
              <button onClick={() => setProjOpen((s) => !s)} className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400 transition hover:text-slate-500">
                <svg className={`h-3 w-3 transition ${projOpen ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                Projelerim
              </button>
              <button onClick={() => setCreatingList(true)} aria-label="Yeni proje" className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-marka-metin ">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              </button>
            </div>
            {projOpen && (listsLoading ? (
              <div className="space-y-1.5 px-3">{Array.from({ length: 3 }).map((_, i) => (<div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100 " />))}</div>
            ) : (
              <nav className="space-y-1">
                {projectsOnly.map((l) => {
                  const active = !filterMode && selection.kind === "list" && selection.id === l.id;
                  return (
                    <div key={l.id}
                      draggable
                      onDragStart={() => { dragListId.current = l.id; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleListDrop(l.id)}
                      className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-slate-100 " : "hover:bg-slate-50 "}`}>
                      <button onClick={() => selectNav({ kind: "list", id: l.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <HashIcon color={l.color} />
                        <span className={`truncate font-medium ${active ? "text-slate-900 " : "text-slate-600 "}`}>{l.name}</span>
                        {l.overdue_count > 0 ? (
                          <span className="ml-auto flex-none rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 ">{l.overdue_count}</span>
                        ) : l.active_count > 0 ? (
                          <span className="ml-auto flex-none text-[11px] font-semibold text-slate-400">{l.active_count}</span>
                        ) : null}
                      </button>
                      <div className="flex flex-none items-center opacity-0 transition group-hover:opacity-100">
                        <FavStar on={l.is_favorite} onClick={() => toggleListFav(l)} />
                        <button onClick={() => setEditingList(l)} aria-label="Düzenle" className="rounded p-1 text-slate-400 hover:text-marka-metin">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
                        </button>
                        <button onClick={() => { if (!window.confirm(`"${l.name}" projesi ve görevleri silinsin mi?`)) return; deleteList.mutate(l.id, { onSuccess: () => { toast.success("Proje silindi."); if (active) selectNav({ kind: "view", view: "today" }); }, onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")) }); }} aria-label="Sil" className="rounded p-1 text-slate-400 hover:text-red-500">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </nav>
            ))}
          </div>

        </aside>

        {/* Ana sütun */}
        <main className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 ">{headerTitle}</h1>
            {filterMode && (
              <span className="rounded-full bg-marka-soft px-2.5 py-0.5 text-xs font-semibold text-marka-soft-fg ">
                {filteredTasks.length} sonuç
              </span>
            )}
            {filterMode && (
              <button onClick={clearFilter} className="ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 ">
                Filtreyi kapat
              </button>
            )}
          </div>

          {(showFilters || facetCount > 0) && (
            <FilterBar
              criteria={criteria}
              setCriteria={updateCriteria}
              labels={labels ?? []}
              dirty={filterDirty}
              activeFilterId={activeFilterId}
              savePending={createFilter.isPending || updateFilter.isPending}
              onSaveNew={() => setBuilder({ mode: "create", initialCriteria: criteria })}
              onUpdate={updateFilterCriteria}
              onClear={clearFilter}
            />
          )}

          <div className="mt-5">
            {selection.kind === "manage" && !filterMode ? (
              <FiltersAndLabelsPanel
                filters={filters ?? []}
                labels={labels ?? []}
                labelCounts={labelCounts}
                onApplyFilter={(f) => applySavedFilter(f)}
                onEditFilter={(f) => setBuilder({ mode: "edit", filter: f })}
                onDeleteFilter={(f) => { if (!window.confirm(`"${f.name}" filtresi silinsin mi?`)) return; deleteFilter.mutate(f.id, { onSuccess: () => { toast.success("Filtre silindi."); if (activeFilterId === f.id) clearFilter(); }, onError: onFilterErr }); }}
                onToggleFilterFav={(f) => toggleFilterFav(f)}
                onAddFilter={() => setBuilder({ mode: "create" })}
                onSelectLabel={(l) => selectNav({ kind: "label", id: l.id })}
                onEditLabel={(l) => setEditingLabel(l)}
                onDeleteLabel={(l) => { if (!window.confirm(`"@${l.name}" etiketi silinsin mi?`)) return; deleteLabel.mutate(l.id, { onSuccess: () => toast.success("Etiket silindi."), onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")) }); }}
                onToggleLabelFav={(l) => toggleLabelFav(l)}
                onAddLabel={() => setCreatingLabel(true)}
              />
            ) : filterMode ? (
              allActive.isLoading ? (
                <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => (<div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100 " />))}</div>
              ) : filteredTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-16 text-center ">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl ">🔍</div>
                  <p className="mt-4 text-sm font-medium text-slate-700 ">Eşleşen görev yok.</p>
                  <p className="mt-1 text-xs text-slate-400 ">Arama veya filtre ölçütlerini gevşetmeyi dene.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredTasks.map((t) => (
                    <TaskRow key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)} draggable={false} />
                  ))}
                </div>
              )
            ) : loading ? (
              <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => (<div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100 " />))}</div>
            ) : visibleTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-16 text-center ">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-marka-soft text-2xl ">✓</div>
                <p className="mt-4 text-sm font-medium text-slate-700 ">
                  {selection.kind === "view" && selection.view === "completed" ? "Henüz tamamlanan görev yok." : "Görev yok, harika!"}
                </p>
                <p className="mt-1 text-xs text-slate-400 ">Aşağıdaki “Görev ekle” ile başla.</p>
              </div>
            ) : selection.kind === "view" && selection.view === "upcoming" ? (
              <UpcomingGroups tasks={visibleTasks} onOpen={(id) => setOpenTaskId(id)} />
            ) : selection.kind === "list" ? (
              <TaskTree
                tasks={visibleTasks}
                onOpen={(id) => setOpenTaskId(id)}
                onReorder={(ids) => reorderTasks.mutate(ids, { onError: (err) => toast.error(getErrorMessage(err, "Sıralanamadı.")) })}
                onReparent={(id, parentId) => updateTask.mutate(
                  { id, payload: { parent_id: parentId } },
                  { onSuccess: () => { if (parentId != null) toast.success("Alt görev yapıldı."); }, onError: (err) => toast.error(getErrorMessage(err, "Taşınamadı.")) }
                )}
              />
            ) : (
              <div className="space-y-1.5">
                {visibleTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)} />
                ))}
              </div>
            )}
          </div>

          {/* Görev ekleme tetikleyicisi — composer ayrı pencerede (modal) açılır */}
          {!filterMode && selection.kind !== "manage" && !(selection.kind === "view" && selection.view === "completed") && (
            <div className="mt-4">
              <button onClick={() => setComposerOpen(true)} className="group flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-slate-400 transition hover:text-marka-metin">
                <span className="flex h-5 w-5 items-center justify-center rounded-full text-marka-metin transition group-hover:bg-marka group-hover:text-marka-fg">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" /></svg>
                </span>
                Görev ekle
              </button>
            </div>
          )}
        </main>
      </div>

      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setComposerOpen(false)}>
          <div className="w-full max-w-xl animate-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <TaskComposer
              lists={lists ?? []}
              labels={labels ?? []}
              defaultListId={selection.kind === "list" ? selection.id : inboxId}
              projects={projects}
              labelRefs={labelRefs}
              pending={createTask.isPending}
              onCancel={() => setComposerOpen(false)}
              onSubmit={(payload) => createTask.mutate(
                {
                  listId: payload.list_id,
                  payload: {
                    title: payload.title,
                    description: payload.description,
                    priority: payload.priority,
                    due_at: payload.due_at,
                    recurrence: payload.recurrence,
                    label_ids: payload.label_ids.length ? payload.label_ids : undefined,
                    reminders: payload.reminders,
                  },
                },
                { onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")) }
              )}
            />
          </div>
        </div>
      )}
      {creatingList && <ListModal onCreated={(l) => selectNav({ kind: "list", id: l.id })} onClose={() => setCreatingList(false)} />}
      {editingList && <ListModal list={editingList} onClose={() => setEditingList(null)} />}
      {editingLabel && <LabelModal label={editingLabel} onClose={() => setEditingLabel(null)} />}
      {creatingLabel && <LabelModal onClose={() => setCreatingLabel(false)} />}
      {builder && (
        <FilterBuilderModal
          mode={builder.mode}
          filter={builder.filter}
          initialCriteria={builder.initialCriteria}
          labels={labels ?? []}
          tasks={allActive.data ?? []}
          projects={projects}
          labelRefs={labelRefs}
          pending={createFilter.isPending || updateFilter.isPending}
          onSubmit={submitBuilder}
          onClose={() => setBuilder(null)}
        />
      )}
      {openTask && <TaskDetailModal task={openTask} lists={lists ?? []} allLabels={labels ?? []} onClose={() => setOpenTaskId(null)} />}
      <TaskCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        lists={lists ?? []}
        labels={labels ?? []}
        filters={filters ?? []}
        tasks={allActive.data ?? []}
        recent={recents}
        onPickView={(view) => selectNav({ kind: "view", view })}
        onPickList={(id) => selectNav({ kind: "list", id })}
        onPickLabel={(id) => selectNav({ kind: "label", id })}
        onPickFilter={(f) => applySavedFilter(f)}
        onOpenTask={(id) => setOpenTaskId(id)}
        onSearchAll={searchAll}
        onOpenFiltersLabels={() => selectNav({ kind: "manage" })}
      />
    </DashboardShell>
  );
}

// ── Yaklaşan: güne göre gruplu ──
function UpcomingGroups({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: number) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; ts: number; items: Task[] }>();
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    for (const t of tasks) {
      if (!t.due_at) continue;
      const d = new Date(t.due_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) {
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const label = dayStart.toDateString() === tomorrow.toDateString() ? "Yarın" : dayHeaderFmt.format(dayStart);
        map.set(key, { label, ts: dayStart.getTime(), items: [] });
      }
      map.get(key)!.items.push(t);
    }
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  }, [tasks]);

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.ts}>
          <h3 className="mb-2 text-sm font-bold capitalize text-slate-700 ">{g.label}</h3>
          <div className="space-y-2.5">
            {g.items.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={() => onOpen(t.id)} draggable={false} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
