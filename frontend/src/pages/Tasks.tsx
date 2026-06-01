import { FormEvent, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBookings } from "@/hooks/useBookings";
import {
  useCreateSubtask,
  useCreateTask,
  useCreateTaskList,
  useDeleteSubtask,
  useDeleteTask,
  useDeleteTaskList,
  useTaskLists,
  useTasks,
  useToggleTask,
  useUpdateSubtask,
  useUpdateTask,
  useUpdateTaskList,
} from "@/hooks/useTasks";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { classifyDue, isoToLocalInput, type DueGroup } from "@/lib/taskView";
import { formatDateTime, localInputToIso } from "@/lib/datetime";
import {
  ROLE_IDS,
  type Task,
  type TaskList,
  type TaskPriority,
  type TaskStatusFilter,
} from "@/types";

type SmartView = "today" | "upcoming" | "all" | "completed";
type Selection = { kind: "list"; id: number } | { kind: "view"; view: SmartView };

const SMART_VIEWS: { view: SmartView; label: string; icon: string }[] = [
  { view: "today", label: "Bugün", icon: "M12 6v6l4 2" },
  { view: "upcoming", label: "Yaklaşan", icon: "M8 7V3m8 4V3M3 11h18M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" },
  { view: "all", label: "Tüm Aktif", icon: "M3.75 5.25h16.5m-16.5 6.75h16.5m-16.5 6.75h16.5" },
  { view: "completed", label: "Tamamlananlar", icon: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
];

const PRIORITY_META: Record<TaskPriority, { label: string; cls: string }> = {
  HIGH: { label: "Yüksek", cls: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300" },
  MEDIUM: { label: "Orta", cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" },
  LOW: { label: "Düşük", cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300" },
};

const DUE_CLS: Record<DueGroup, string> = {
  overdue: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300",
  today: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  upcoming: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
  none: "",
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white";

function selectionToQuery(sel: Selection): {
  listId: number | null;
  status: TaskStatusFilter;
} {
  if (sel.kind === "list") return { listId: sel.id, status: "all" };
  if (sel.view === "completed") return { listId: null, status: "completed" };
  return { listId: null, status: "active" };
}

// ── Küçük UI parçaları ──
function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function DueChip({ dueIso }: { dueIso?: string | null }) {
  if (!dueIso) return null;
  const group = classifyDue(dueIso);
  if (group === "none") return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${DUE_CLS[group]}`}>
      {group === "overdue" ? "⚠ " : ""}
      {formatDateTime(dueIso)}
    </span>
  );
}

// ── Liste oluştur / düzenle modalı ──
function ListModal({ list, onClose }: { list?: TaskList | null; onClose: () => void }) {
  const [name, setName] = useState(list?.name ?? "");
  const create = useCreateTaskList();
  const update = useUpdateTaskList();
  const isEdit = !!list;
  const pending = create.isPending || update.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Liste adı boş olamaz.");
      return;
    }
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? "Liste güncellendi." : "Liste oluşturuldu.");
        onClose();
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
    };
    if (isEdit) update.mutate({ id: list!.id, payload: { name: trimmed } }, opts);
    else create.mutate({ name: trimmed }, opts);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 dark:bg-slate-900 dark:ring-slate-800 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          {isEdit ? "Listeyi Düzenle" : "Yeni Liste"}
        </h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <input
            autoFocus
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Örn. Matematik Çalışması"
            className={inputCls}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
              İptal
            </button>
            <button type="submit" disabled={pending} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {pending ? "Kaydediliyor…" : isEdit ? "Kaydet" : "Oluştur"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Görev detay / düzenleme modalı (açıklama, öncelik, son tarih, liste, ders, alt görevler) ──
function TaskDetailModal({
  task,
  lists,
  onClose,
}: {
  task: Task;
  lists: TaskList[];
  onClose: () => void;
}) {
  const { data: user } = useCurrentUser();
  const isClient = user?.role_id === ROLE_IDS.CLIENT;
  const update = useUpdateTask();
  const del = useDeleteTask();
  const createSub = useCreateSubtask();
  const updateSub = useUpdateSubtask();
  const deleteSub = useDeleteSubtask();
  const { data: bookings } = useBookings({});

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [due, setDue] = useState(isoToLocalInput(task.due_at));
  const [listId, setListId] = useState(task.list_id);
  const [bookingId, setBookingId] = useState<number | "">(task.booking_id ?? "");
  const [newSub, setNewSub] = useState("");

  const save = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Görev başlığı boş olamaz.");
      return;
    }
    update.mutate(
      {
        id: task.id,
        payload: {
          title: trimmed,
          description: description.trim() || null,
          priority,
          due_at: due ? localInputToIso(due) : null,
          list_id: listId,
          booking_id: bookingId === "" ? null : Number(bookingId),
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
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 dark:bg-slate-900 dark:ring-slate-800 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Görev Detayı</h2>
          <button onClick={onClose} aria-label="Kapat" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
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
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={inputCls}>
                <option value="LOW">Düşük</option>
                <option value="MEDIUM">Orta</option>
                <option value="HIGH">Yüksek</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Son tarih</label>
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Liste</label>
              <select value={listId} onChange={(e) => setListId(Number(e.target.value))} className={inputCls}>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Ders (opsiyonel)</label>
              <select
                value={bookingId}
                onChange={(e) => setBookingId(e.target.value === "" ? "" : Number(e.target.value))}
                className={inputCls}
              >
                <option value="">— Yok —</option>
                {(bookings ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {(isClient ? b.tutor_name : b.client_name) || `Ders #${b.id}`} • {formatDateTime(b.start_at)}
                  </option>
                ))}
              </select>
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
                  <input
                    type="checkbox"
                    checked={s.is_done}
                    onChange={() =>
                      updateSub.mutate({ id: s.id, payload: { is_done: !s.is_done } })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className={`flex-1 text-sm ${s.is_done ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>
                    {s.title}
                  </span>
                  <button
                    onClick={() => deleteSub.mutate(s.id)}
                    aria-label="Alt görevi sil"
                    className="rounded p-1 text-slate-400 transition hover:text-red-500"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = newSub.trim();
                if (!t) return;
                createSub.mutate(
                  { taskId: task.id, title: t },
                  { onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")) }
                );
                setNewSub("");
              }}
            >
              <input
                value={newSub}
                maxLength={200}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder="Alt görev ekle…"
                className={inputCls}
              />
              <button type="submit" className="rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600">
                Ekle
              </button>
            </form>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() =>
              del.mutate(task.id, {
                onSuccess: () => {
                  toast.success("Görev silindi.");
                  onClose();
                },
                onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")),
              })
            }
            disabled={del.isPending}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Sil
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
              Kapat
            </button>
            <button onClick={save} disabled={update.isPending} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60">
              {update.isPending ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Görev satırı ──
function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const toggle = useToggleTask();
  const done = !!task.completed_at;
  const subDone = task.subtasks.filter((s) => s.is_done).length;

  return (
    <div className="group flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm transition hover:border-indigo-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-500/40">
      <button
        onClick={() =>
          toggle.mutate(task.id, {
            onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
          })
        }
        aria-label={done ? "Tamamlandı olarak işaretle kaldır" : "Tamamla"}
        className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 transition ${
          done
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-slate-300 text-transparent hover:border-emerald-400 dark:border-slate-600"
        }`}
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </button>

      <button onClick={onOpen} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className={`truncate text-sm font-medium ${done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"}`}>
          {task.title}
        </span>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {!done && <PriorityBadge priority={task.priority} />}
          {!done && <DueChip dueIso={task.due_at} />}
          {task.subtasks.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
              ☑ {subDone}/{task.subtasks.length}
            </span>
          )}
          {task.booking_id && (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-600 dark:bg-sky-500/15 dark:text-sky-300">
              Derse bağlı
            </span>
          )}
        </div>
      </button>

      <button onClick={onOpen} aria-label="Detay" className="flex-none rounded-lg p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-500 dark:hover:bg-slate-700">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

export default function Tasks() {
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : STUDENT_NAV;

  const { data: lists, isLoading: listsLoading } = useTaskLists();
  const [selection, setSelection] = useState<Selection>({ kind: "view", view: "today" });
  const [creatingList, setCreatingList] = useState(false);
  const [editingList, setEditingList] = useState<TaskList | null>(null);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [quickTitle, setQuickTitle] = useState("");

  const { listId, status } = selectionToQuery(selection);
  const { data: tasks, isLoading: tasksLoading } = useTasks(listId, status);
  const createTask = useCreateTask();
  const deleteList = useDeleteTaskList();

  const visibleTasks = useMemo(() => {
    const all = tasks ?? [];
    if (selection.kind === "view" && selection.view === "today") {
      return all.filter((t) => ["today", "overdue"].includes(classifyDue(t.due_at)));
    }
    if (selection.kind === "view" && selection.view === "upcoming") {
      return all.filter((t) => classifyDue(t.due_at) === "upcoming");
    }
    return all;
  }, [tasks, selection]);

  // Hızlı eklemenin hedef listesi: seçili liste, yoksa ilk liste.
  const targetList =
    selection.kind === "list"
      ? lists?.find((l) => l.id === selection.id)
      : lists?.[0];

  const headerTitle =
    selection.kind === "list"
      ? lists?.find((l) => l.id === selection.id)?.name ?? "Liste"
      : SMART_VIEWS.find((v) => v.view === selection.view)?.label ?? "Görevler";

  const quickAdd = (e: FormEvent) => {
    e.preventDefault();
    const t = quickTitle.trim();
    if (!t) return;
    if (!targetList) {
      toast.error("Önce bir liste oluştur.");
      return;
    }
    // Akıllı "Bugün" görünümünde eklenen görev bugüne tarihlensin.
    const due_at =
      selection.kind === "view" && selection.view === "today"
        ? new Date(new Date().setHours(23, 59, 0, 0)).toISOString()
        : null;
    createTask.mutate(
      { listId: targetList.id, payload: { title: t, due_at } },
      { onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")) }
    );
    setQuickTitle("");
  };

  return (
    <DashboardShell title="Görevlerim" navItems={navItems}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row">
        {/* ── Kenar çubuğu: akıllı görünümler + listeler ── */}
        <aside className="lg:w-64 lg:flex-none">
          <nav className="space-y-1">
            {SMART_VIEWS.map((v) => {
              const active = selection.kind === "view" && selection.view === v.view;
              return (
                <button
                  key={v.view}
                  onClick={() => setSelection({ kind: "view", view: v.view })}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  <svg className="h-4 w-4 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={v.icon} />
                  </svg>
                  {v.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Listeler</span>
              <button
                onClick={() => setCreatingList(true)}
                aria-label="Yeni liste"
                className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </div>
            {listsLoading ? (
              <div className="space-y-1.5 px-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : (
              <nav className="space-y-1">
                {(lists ?? []).map((l) => {
                  const active = selection.kind === "list" && selection.id === l.id;
                  return (
                    <div
                      key={l.id}
                      className={`group flex items-center gap-1 rounded-xl px-3 py-2 text-sm transition ${
                        active ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <button
                        onClick={() => setSelection({ kind: "list", id: l.id })}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className={`truncate font-medium ${active ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-300"}`}>
                          {l.name}
                        </span>
                        {l.overdue_count > 0 ? (
                          <span className="ml-auto flex-none rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-500/15 dark:text-red-300">
                            {l.overdue_count}
                          </span>
                        ) : l.active_count > 0 ? (
                          <span className="ml-auto flex-none rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                            {l.active_count}
                          </span>
                        ) : null}
                      </button>
                      <div className="flex flex-none items-center opacity-0 transition group-hover:opacity-100">
                        <button onClick={() => setEditingList(l)} aria-label="Düzenle" className="rounded p-1 text-slate-400 hover:text-indigo-600">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            if (!window.confirm(`"${l.name}" listesi ve içindeki görevler silinsin mi?`)) return;
                            deleteList.mutate(l.id, {
                              onSuccess: () => {
                                toast.success("Liste silindi.");
                                if (selection.kind === "list" && selection.id === l.id) {
                                  setSelection({ kind: "view", view: "today" });
                                }
                              },
                              onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")),
                            });
                          }}
                          aria-label="Sil"
                          className="rounded p-1 text-slate-400 hover:text-red-500"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
                {(lists ?? []).length === 0 && (
                  <button
                    onClick={() => setCreatingList(true)}
                    className="w-full rounded-xl border border-dashed border-slate-300 px-3 py-2 text-left text-sm text-slate-400 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700"
                  >
                    + İlk listeni oluştur
                  </button>
                )}
              </nav>
            )}
          </div>
        </aside>

        {/* ── Ana sütun ── */}
        <main className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{headerTitle}</h1>

          <form onSubmit={quickAdd} className="mt-4 flex gap-2">
            <input
              value={quickTitle}
              maxLength={200}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder={
                targetList
                  ? `${targetList.name} listesine görev ekle…`
                  : "Önce bir liste oluştur"
              }
              disabled={!targetList}
              className={inputCls}
            />
            <button
              type="submit"
              disabled={!targetList || createTask.isPending}
              className="flex-none rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              Ekle
            </button>
          </form>

          <div className="mt-5 space-y-2.5">
            {tasksLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
              ))
            ) : visibleTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-2xl dark:bg-indigo-500/15">✓</div>
                <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                  {selection.kind === "view" && selection.view === "completed"
                    ? "Henüz tamamlanan görev yok."
                    : "Görev yok — harika!"}
                </p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {targetList ? "Yukarıdan hızlıca yeni görev ekleyebilirsin." : "Başlamak için bir liste oluştur."}
                </p>
              </div>
            ) : (
              visibleTasks.map((t) => (
                <TaskRow key={t.id} task={t} onOpen={() => setOpenTask(t)} />
              ))
            )}
          </div>
        </main>
      </div>

      {creatingList && <ListModal onClose={() => setCreatingList(false)} />}
      {editingList && <ListModal list={editingList} onClose={() => setEditingList(null)} />}
      {openTask && (
        <TaskDetailModal
          task={visibleTasks.find((t) => t.id === openTask.id) ?? openTask}
          lists={lists ?? []}
          onClose={() => setOpenTask(null)}
        />
      )}
    </DashboardShell>
  );
}
