import { FormEvent, useMemo, useRef, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBookings } from "@/hooks/useBookings";
import {
  useCreateLabel,
  useCreateTask,
  useCreateTaskList,
  useCreateSubtask,
  useDeleteLabel,
  useDeleteSubtask,
  useDeleteTask,
  useDeleteTaskList,
  useLabels,
  useReorderTaskLists,
  useReorderTasks,
  useTaskLists,
  useTasks,
  useToggleTask,
  useUpdateLabel,
  useUpdateSubtask,
  useUpdateTask,
  useUpdateTaskList,
} from "@/hooks/useTasks";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { classifyDue, isoToLocalInput, type DueGroup } from "@/lib/taskView";
import { parseQuickAdd } from "@/lib/quickParse";
import { localInputToIso } from "@/lib/datetime";
import {
  ROLE_IDS,
  type Task,
  type TaskLabel,
  type TaskList,
  type TaskPriority,
} from "@/types";

type SmartView = "today" | "upcoming" | "all" | "completed";
type Selection =
  | { kind: "list"; id: number }
  | { kind: "label"; id: number }
  | { kind: "view"; view: SmartView };

const SMART_VIEWS: { view: SmartView; label: string; icon: string }[] = [
  { view: "today", label: "Bugün", icon: "M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
  { view: "upcoming", label: "Yaklaşan", icon: "M8 7V3m8 4V3M3 11h18M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" },
  { view: "all", label: "Tüm Aktif", icon: "M3.75 5.25h16.5m-16.5 6.75h16.5m-16.5 6.75h16.5" },
  { view: "completed", label: "Tamamlananlar", icon: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
];

// P1 (acil) … P4 (varsayılan) — Todoist renk paleti.
const PRIO: Record<TaskPriority, { label: string; flag: string; chip: string }> = {
  1: { label: "P1", flag: "text-red-500", chip: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300" },
  2: { label: "P2", flag: "text-orange-500", chip: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300" },
  3: { label: "P3", flag: "text-blue-500", chip: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" },
  4: { label: "P4", flag: "text-slate-300 dark:text-slate-600", chip: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300" },
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

const DUE_CLS: Record<DueGroup, string> = {
  overdue: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300",
  today: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  upcoming: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
  none: "",
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white";

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
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
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
function ListModal({ list, onClose }: { list?: TaskList | null; onClose: () => void }) {
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
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? "Proje güncellendi." : "Proje oluşturuldu.");
        onClose();
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
    };
    if (isEdit) update.mutate({ id: list!.id, payload: { name: trimmed, color } }, opts);
    else create.mutate({ name: trimmed, color }, opts);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 dark:bg-slate-900 dark:ring-slate-800 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{isEdit ? "Projeyi Düzenle" : "Yeni Proje"}</h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <input autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. Matematik" className={inputCls} />
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Renk ${c}`}
                className={`h-7 w-7 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-900" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">İptal</button>
            <button type="submit" disabled={pending} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {pending ? "Kaydediliyor…" : isEdit ? "Kaydet" : "Oluştur"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Etiket düzenle ──
function LabelModal({ label, onClose }: { label: TaskLabel; onClose: () => void }) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<string | null>(label.color ?? COLORS[8]);
  const update = useUpdateLabel();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    update.mutate(
      { id: label.id, payload: { name: name.trim(), color } },
      {
        onSuccess: () => {
          toast.success("Etiket güncellendi.");
          onClose();
        },
        onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 dark:bg-slate-900 dark:ring-slate-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Etiketi Düzenle</h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <input autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} className={`h-7 w-7 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-900" : ""}`} style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">İptal</button>
            <button type="submit" disabled={update.isPending} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">Kaydet</button>
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
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 dark:bg-slate-900 dark:ring-slate-800 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Görev Detayı</h2>
          <button onClick={onClose} aria-label="Kapat" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Başlık *</label>
            <input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Açıklama</label>
            <textarea rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Öncelik</label>
              <div className="flex gap-1.5">
                {([1, 2, 3, 4] as TaskPriority[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-lg border py-2 text-xs font-semibold transition ${
                      priority === p ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/15" : "border-slate-200 dark:border-slate-600"
                    }`}
                  >
                    <PriorityFlag p={p} className="h-3.5 w-3.5" />
                    {PRIO[p].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Son tarih</label>
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Tekrar</label>
              <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={inputCls}>
                <option value="">Tekrar yok</option>
                <option value="daily">Her gün</option>
                <option value="weekdays">Hafta içi</option>
                <option value="weekly">Her hafta</option>
                <option value="monthly">Her ay</option>
                <option value="yearly">Her yıl</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Proje</label>
              <select value={listId} onChange={(e) => setListId(Number(e.target.value))} className={inputCls}>
                {lists.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Ders (opsiyonel)</label>
            <select value={bookingId} onChange={(e) => setBookingId(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
              <option value="">— Yok —</option>
              {(bookings ?? []).map((b) => (
                <option key={b.id} value={b.id}>{(isClient ? b.tutor_name : b.client_name) || `Ders #${b.id}`}</option>
              ))}
            </select>
          </div>

          {/* Etiketler */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Etiketler</label>
            <div className="flex flex-wrap gap-1.5">
              {allLabels.map((l) => {
                const on = labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggleLabel(l.id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${on ? "ring-2 ring-offset-1 dark:ring-offset-slate-900" : "opacity-60"}`}
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
              <button type="button" onClick={addNewLabel} className="rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600">Ekle</button>
            </div>
          </div>

          {/* Alt görevler */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Alt görevler ({subtasks.filter((s) => s.is_done).length}/{subtasks.length})
            </label>
            <div className="space-y-1.5">
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800">
                  <input type="checkbox" checked={s.is_done} onChange={() => updateSub.mutate({ id: s.id, payload: { is_done: !s.is_done } })} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <span className={`flex-1 text-sm ${s.is_done ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>{s.title}</span>
                  <button onClick={() => deleteSub.mutate(s.id)} aria-label="Sil" className="rounded p-1 text-slate-400 hover:text-red-500">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = newSub.trim(); if (!t) return; createSub.mutate({ taskId: task.id, title: t }, { onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")) }); setNewSub(""); }}>
              <input value={newSub} maxLength={200} onChange={(e) => setNewSub(e.target.value)} placeholder="Alt görev ekle…" className={inputCls} />
              <button type="submit" className="rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600">Ekle</button>
            </form>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button onClick={() => del.mutate(task.id, { onSuccess: () => { toast.success("Görev silindi."); onClose(); }, onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")) })} disabled={del.isPending} className="rounded-xl px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20">Sil</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">Kapat</button>
            <button onClick={save} disabled={update.isPending} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{update.isPending ? "Kaydediliyor…" : "Kaydet"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Görev satırı (sürükle-bırak destekli) ──
function TaskRow({ task, onOpen, draggable, onDragStart, onDragOver, onDrop }: {
  task: Task;
  onOpen: () => void;
  draggable: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
}) {
  const toggle = useToggleTask();
  const done = !!task.completed_at;
  const subDone = task.subtasks.filter((s) => s.is_done).length;

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="group flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm transition hover:border-indigo-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-500/40"
    >
      {draggable && (
        <span className="hidden cursor-grab text-slate-300 group-hover:block dark:text-slate-600" aria-hidden>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" /></svg>
        </span>
      )}
      <button
        onClick={() => toggle.mutate(task.id, {
          onSuccess: () => { if (task.recurrence && task.due_at) toast.success("Sonraki tekrara taşındı."); },
          onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
        })}
        aria-label={done ? "Geri al" : "Tamamla"}
        className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 transition ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-400 dark:border-slate-600"}`}
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      </button>

      {task.priority !== 4 && !done && <PriorityFlag p={task.priority} className="h-4 w-4 flex-none" />}

      <button onClick={onOpen} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className={`truncate text-sm font-medium ${done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"}`}>{task.title}</span>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {!done && <DueChip iso={task.due_at} recurrence={task.recurrence} />}
          {task.labels.map((l) => (<LabelChip key={l.id} label={l} />))}
          {task.subtasks.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">☑ {subDone}/{task.subtasks.length}</span>
          )}
          {task.booking_id && (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-600 dark:bg-sky-500/15 dark:text-sky-300">Derse bağlı</span>
          )}
        </div>
      </button>

      <button onClick={onOpen} aria-label="Detay" className="flex-none rounded-lg p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-500 dark:hover:bg-slate-700">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
}

export default function Tasks() {
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : STUDENT_NAV;

  const { data: lists, isLoading: listsLoading } = useTaskLists();
  const { data: labels } = useLabels();
  const [selection, setSelection] = useState<Selection>({ kind: "view", view: "today" });
  const [creatingList, setCreatingList] = useState(false);
  const [editingList, setEditingList] = useState<TaskList | null>(null);
  const [editingLabel, setEditingLabel] = useState<TaskLabel | null>(null);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [quickText, setQuickText] = useState("");

  const createTask = useCreateTask();
  const createLabel = useCreateLabel();
  const deleteList = useDeleteTaskList();
  const deleteLabel = useDeleteLabel();
  const reorderTasks = useReorderTasks();
  const reorderLists = useReorderTaskLists();

  // Akıllı görünümler + Bugün rozeti için her zaman aktif görevleri çek.
  const allActive = useTasks({ status: "active" });
  const listTasks = useTasks({ listId: selection.kind === "list" ? selection.id : null, status: "all", enabled: selection.kind === "list" });
  const labelTasks = useTasks({ labelId: selection.kind === "label" ? selection.id : null, status: "active", enabled: selection.kind === "label" });
  const completedTasks = useTasks({ status: "completed", enabled: selection.kind === "view" && selection.view === "completed" });

  const projects = useMemo(() => (lists ?? []).map((l) => ({ id: l.id, name: l.name })), [lists]);
  const labelRefs = useMemo(() => (labels ?? []).map((l) => ({ id: l.id, name: l.name })), [labels]);
  const parsed = useMemo(
    () => parseQuickAdd(quickText, { projects, labels: labelRefs }),
    [quickText, projects, labelRefs]
  );

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
    if (selection.view === "completed") return { source: completedTasks.data ?? [], loading: completedTasks.isLoading };
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
  const headerTitle =
    selection.kind === "list" ? lists?.find((l) => l.id === selection.id)?.name ?? "Proje"
    : selection.kind === "label" ? `@${labels?.find((l) => l.id === selection.id)?.name ?? "etiket"}`
    : SMART_VIEWS.find((v) => v.view === selection.view)?.label ?? "Görevler";

  const dndEnabled = selection.kind === "list";
  const dragId = useRef<number | null>(null);
  const handleDrop = (targetId: number) => {
    const from = dragId.current;
    dragId.current = null;
    if (from == null || from === targetId) return;
    const ids = visibleTasks.map((t) => t.id);
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);
    reorderTasks.mutate(ids, { onError: (err) => toast.error(getErrorMessage(err, "Sıralanamadı.")) });
  };

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

  const quickAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.title) {
      toast.error("Görev başlığı boş olamaz.");
      return;
    }
    const targetListId = parsed.listId ?? (selection.kind === "list" ? selection.id : inboxId);
    if (!targetListId) {
      toast.error("Önce bir proje oluştur.");
      return;
    }
    const labelIds = [...parsed.labelIds];
    for (const name of parsed.newLabelNames) {
      try {
        const lbl = await createLabel.mutateAsync({ name, color: COLORS[8] });
        labelIds.push(lbl.id);
      } catch {
        /* etiket oluşturulamazsa görevi yine de ekle */
      }
    }
    createTask.mutate(
      {
        listId: targetListId,
        payload: {
          title: parsed.title,
          priority: (parsed.priority as TaskPriority) ?? undefined,
          due_at: parsed.dueIso,
          recurrence: parsed.recurrence,
          label_ids: labelIds.length ? labelIds : undefined,
        },
      },
      { onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")) }
    );
    setQuickText("");
  };

  const openTask = visibleTasks.find((t) => t.id === openTaskId) ?? source.find((t) => t.id === openTaskId);

  return (
    <DashboardShell title="Görevlerim" navItems={navItems}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row">
        {/* Kenar çubuğu */}
        <aside className="lg:w-64 lg:flex-none">
          <nav className="space-y-1">
            {SMART_VIEWS.map((v) => {
              const active = selection.kind === "view" && selection.view === v.view;
              const badge = v.view === "today" ? todayCount : v.view === "upcoming" ? upcomingCount : 0;
              return (
                <button key={v.view} onClick={() => setSelection({ kind: "view", view: v.view })}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                  <svg className="h-4 w-4 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={v.icon} /></svg>
                  <span className="flex-1 text-left">{v.label}</span>
                  {badge > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>{badge}</span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Projeler */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Projeler</span>
              <button onClick={() => setCreatingList(true)} aria-label="Yeni proje" className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              </button>
            </div>
            {listsLoading ? (
              <div className="space-y-1.5 px-3">{Array.from({ length: 3 }).map((_, i) => (<div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />))}</div>
            ) : (
              <nav className="space-y-1">
                {(lists ?? []).map((l) => {
                  const active = selection.kind === "list" && selection.id === l.id;
                  return (
                    <div key={l.id}
                      draggable={!l.is_inbox}
                      onDragStart={() => { if (!l.is_inbox) dragListId.current = l.id; }}
                      onDragOver={(e) => { if (!l.is_inbox) e.preventDefault(); }}
                      onDrop={() => { if (!l.is_inbox) handleListDrop(l.id); }}
                      className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}>
                      <button onClick={() => setSelection({ kind: "list", id: l.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        {l.is_inbox ? (
                          <svg className="h-3.5 w-3.5 flex-none text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M2 13h4l2 4h8l2-4h4M5 5h14l3 8v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6L5 5Z" /></svg>
                        ) : (
                          <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: l.color || "#94a3b8" }} />
                        )}
                        <span className={`truncate font-medium ${active ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-300"}`}>{l.name}</span>
                        {l.overdue_count > 0 ? (
                          <span className="ml-auto flex-none rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-500/15 dark:text-red-300">{l.overdue_count}</span>
                        ) : l.active_count > 0 ? (
                          <span className="ml-auto flex-none rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">{l.active_count}</span>
                        ) : null}
                      </button>
                      {!l.is_inbox && (
                        <div className="flex flex-none items-center opacity-0 transition group-hover:opacity-100">
                          <button onClick={() => setEditingList(l)} aria-label="Düzenle" className="rounded p-1 text-slate-400 hover:text-indigo-600">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
                          </button>
                          <button onClick={() => { if (!window.confirm(`"${l.name}" projesi ve görevleri silinsin mi?`)) return; deleteList.mutate(l.id, { onSuccess: () => { toast.success("Proje silindi."); if (active) setSelection({ kind: "view", view: "today" }); }, onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")) }); }} aria-label="Sil" className="rounded p-1 text-slate-400 hover:text-red-500">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            )}
          </div>

          {/* Etiketler */}
          {(labels ?? []).length > 0 && (
            <div className="mt-6">
              <span className="mb-2 block px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Etiketler</span>
              <div className="flex flex-wrap gap-1.5 px-3">
                {(labels ?? []).map((l) => {
                  const active = selection.kind === "label" && selection.id === l.id;
                  return (
                    <span key={l.id} className="group/lbl relative inline-flex items-center">
                      <button onClick={() => setSelection({ kind: "label", id: l.id })} className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${active ? "ring-2 ring-offset-1 dark:ring-offset-slate-900" : ""}`} style={{ backgroundColor: (l.color || "#64748b") + "22", color: l.color || "#64748b" }}>@{l.name}</button>
                      <span className="ml-0.5 hidden gap-0.5 group-hover/lbl:inline-flex">
                        <button onClick={() => setEditingLabel(l)} aria-label="Etiketi düzenle" className="text-slate-400 hover:text-indigo-600">
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
                        </button>
                        <button onClick={() => { if (!window.confirm(`"@${l.name}" etiketi silinsin mi?`)) return; deleteLabel.mutate(l.id, { onSuccess: () => { toast.success("Etiket silindi."); if (active) setSelection({ kind: "view", view: "today" }); } }); }} aria-label="Etiketi sil" className="text-slate-400 hover:text-red-500">
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                        </button>
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* Ana sütun */}
        <main className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{headerTitle}</h1>

          <form onSubmit={quickAdd} className="mt-4">
            <div className="flex gap-2">
              <input value={quickText} maxLength={300} onChange={(e) => setQuickText(e.target.value)}
                placeholder="Görev ekle — örn: Rapor yarın 17:00 !1 #İş @acil"
                className={inputCls} />
              <button type="submit" disabled={createTask.isPending} className="flex-none rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">Ekle</button>
            </div>
            {/* Canlı ayrıştırma önizlemesi */}
            {quickText.trim() && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[11px]">
                {parsed.dueIso && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">📅 {dueChipLabel(parsed.dueIso)}</span>}
                {parsed.recurrence && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">🔁 {REC_LABELS[parsed.recurrence]}</span>}
                {parsed.priority && <span className={`rounded-full px-2 py-0.5 font-semibold ${PRIO[parsed.priority as TaskPriority].chip}`}>P{parsed.priority}</span>}
                {parsed.listId && <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">#{lists?.find((l) => l.id === parsed.listId)?.name}</span>}
                {parsed.labelIds.map((id) => (<span key={id} className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">@{labels?.find((l) => l.id === id)?.name}</span>))}
                {parsed.newLabelNames.map((n) => (<span key={n} className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">@{n} (yeni)</span>))}
              </div>
            )}
          </form>

          <div className="mt-5">
            {loading ? (
              <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => (<div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />))}</div>
            ) : visibleTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-2xl dark:bg-indigo-500/15">✓</div>
                <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                  {selection.kind === "view" && selection.view === "completed" ? "Henüz tamamlanan görev yok." : "Görev yok — harika!"}
                </p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Yukarıdan doğal dille hızlıca görev ekle.</p>
              </div>
            ) : selection.kind === "view" && selection.view === "upcoming" ? (
              <UpcomingGroups tasks={visibleTasks} onOpen={(id) => setOpenTaskId(id)} />
            ) : (
              <div className="space-y-2.5">
                {visibleTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)}
                    draggable={dndEnabled}
                    onDragStart={() => { dragId.current = t.id; }}
                    onDragOver={(e) => { if (dndEnabled) e.preventDefault(); }}
                    onDrop={() => handleDrop(t.id)} />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {creatingList && <ListModal onClose={() => setCreatingList(false)} />}
      {editingList && <ListModal list={editingList} onClose={() => setEditingList(null)} />}
      {editingLabel && <LabelModal label={editingLabel} onClose={() => setEditingLabel(null)} />}
      {openTask && <TaskDetailModal task={openTask} lists={lists ?? []} allLabels={labels ?? []} onClose={() => setOpenTaskId(null)} />}
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
          <h3 className="mb-2 text-sm font-bold capitalize text-slate-700 dark:text-slate-200">{g.label}</h3>
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
