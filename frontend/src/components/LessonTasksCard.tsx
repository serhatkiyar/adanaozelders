import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import {
  useCreateTask,
  useTaskLists,
  useTasksForBooking,
  useToggleTask,
} from "@/hooks/useTasks";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROUTES } from "@/lib/routes";

/** Ders detayında, bu derse bağlı görevleri gösteren kompakt kart.
 *  Görev eklenince kullanıcının ilk listesine bu ders bağlanarak oluşturulur. */
export function LessonTasksCard({ bookingId }: { bookingId: number }) {
  const { data: tasks } = useTasksForBooking(bookingId);
  const { data: lists } = useTaskLists();
  const toggle = useToggleTask();
  const createTask = useCreateTask();
  const [title, setTitle] = useState("");

  const firstList = lists?.[0];

  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    if (!firstList) {
      toast.error("Önce Görevlerim'de bir liste oluştur.");
      return;
    }
    createTask.mutate(
      { listId: firstList.id, payload: { title: t, booking_id: bookingId } },
      {
        onSuccess: () => toast.success("Görev eklendi."),
        onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")),
      }
    );
    setTitle("");
  };

  const items = tasks ?? [];

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700 lg:col-span-1">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          Bu Derse Ait Görevler
        </h3>
        <Link
          to={ROUTES.tasks}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          Görevlerim →
        </Link>
      </div>

      <div className="mt-4 space-y-1.5">
        {items.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            Henüz görev yok. Aşağıdan ekleyebilirsin.
          </p>
        ) : (
          items.map((t) => {
            const done = !!t.completed_at;
            return (
              <div
                key={t.id}
                className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/40"
              >
                <button
                  onClick={() =>
                    toggle.mutate(t.id, {
                      onError: (err) =>
                        toast.error(getErrorMessage(err, "Güncellenemedi.")),
                    })
                  }
                  aria-label={done ? "Geri al" : "Tamamla"}
                  className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 transition ${
                    done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-slate-300 text-transparent hover:border-emerald-400 dark:border-slate-600"
                  }`}
                >
                  <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <span className={`flex-1 text-sm ${done ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>
                  {t.title}
                </span>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={add} className="mt-3 flex gap-2">
        <input
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Derse görev ekle…"
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
        <button
          type="submit"
          disabled={createTask.isPending}
          className="flex-none rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          Ekle
        </button>
      </form>
    </section>
  );
}
