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
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_SATIR_BIRINCIL,
  KART,
  METIN_BAGLANTI,
} from "@/components/pano/stil";

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
    <section className={`${KART} lg:col-span-1`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={BOLUM_BASLIGI}>Bu Derse Ait Görevler</h3>
        <Link
          to={ROUTES.tasks}
          className={METIN_BAGLANTI}
        >
          Görevlerim →
        </Link>
      </div>

      <div className="mt-4 space-y-1.5">
        {items.length === 0 ? (
          <p className={ACIKLAMA}>
            Henüz görev yok. Aşağıdan ekleyebilirsin.
          </p>
        ) : (
          items.map((t) => {
            const done = !!t.completed_at;
            return (
              <div
                key={t.id}
                className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2 "
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
                      ? "border-marka bg-marka text-marka-fg"
                      : "border-slate-300 text-transparent hover:border-marka-mid"
                  }`}
                >
                  <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <span className={`flex-1 text-base leading-6 ${done ? "text-slate-500 line-through" : "text-slate-900"}`}>
                  {t.title}
                </span>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={add} className="mt-4 flex gap-2">
        <input
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Derse görev ekle…"
          className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka-focus"
        />
        <button
          type="submit"
          disabled={createTask.isPending}
          className={`${DUGME_SATIR_BIRINCIL} flex-none`}
        >
          Ekle
        </button>
      </form>
    </section>
  );
}
