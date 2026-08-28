import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useCheckInHabit,
  useCreateHabit,
  useDeleteHabit,
  useHabits,
  useUpdateHabit,
} from "@/hooks/useHabits";
import { buildHeatmap, heatLevel, todayISO } from "@/lib/habit";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROLE_IDS, type Habit, type HabitCreate, type HabitPeriod } from "@/types";
import { ROUTES } from "@/lib/routes";

const COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#0ea5e9", // sky
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#14b8a6", // teal
  "#d946ef", // fuchsia
];
const EMOJIS = ["📚", "✍️", "🧠", "🏃", "💧", "🛏️", "🧘", "🎯", "📝", "🔤", "💪", "⏰"];
const HEATMAP_WEEKS = 17;

const LEVEL_BG = [
  "bg-slate-100 ",
  "bg-emerald-200 ",
  "bg-emerald-300 ",
  "bg-emerald-400 ",
  "bg-emerald-500 ",
] as const;

function HabitModal({
  habit,
  onClose,
}: {
  habit?: Habit;
  onClose: () => void;
}) {
  const editing = !!habit;
  const [name, setName] = useState(habit?.name ?? "");
  const [color, setColor] = useState(habit?.color ?? COLORS[0]);
  const [icon, setIcon] = useState(habit?.icon ?? EMOJIS[0]);
  const [period, setPeriod] = useState<HabitPeriod>(habit?.period ?? "daily");
  const [target, setTarget] = useState(habit?.target_per_period ?? 1);

  const create = useCreateHabit();
  const update = useUpdateHabit();
  const pending = create.isPending || update.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Alışkanlık adı boş olamaz.");
      return;
    }
    const payload: HabitCreate = {
      name: name.trim(),
      color,
      icon,
      period,
      target_per_period: Math.max(1, Math.min(50, target)),
    };
    const opts = {
      onSuccess: () => {
        toast.success(editing ? "Alışkanlık güncellendi." : "Alışkanlık oluşturuldu.");
        onClose();
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err, "Kaydedilemedi.")),
    };
    if (editing) update.mutate({ id: habit!.id, payload }, opts);
    else create.mutate(payload, opts);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-900 ">
          {editing ? "Alışkanlığı Düzenle" : "Yeni Alışkanlık"}
        </h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <Field label="Ad *" required labelClassName="mb-1.5 block text-xs font-medium text-slate-500 ">
            {(id) => (
                <input
                    id={id}
                  autoFocus
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn. Her gün 30 soru çöz"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
                />
            )}
          </Field>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-slate-500 ">
              Simge
            </span>
            <div role="group" aria-label="Simge" className="flex flex-wrap gap-1.5">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setIcon(e)}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg transition ${
                    icon === e
                      ? "bg-indigo-100 ring-2 ring-indigo-400 "
                      : "bg-slate-100 hover:bg-slate-200 "
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-slate-500 ">
              Renk
            </span>
            <div role="group" aria-label="Renk" className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                  className={`h-7 w-7 rounded-full transition ${
                    color === c ? "ring-2 ring-offset-2 ring-slate-400 " : ""
                  }`}
                />
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-slate-500 ">
              Sıklık
            </span>
            <div role="group" aria-label="Sıklık" className="grid grid-cols-2 gap-2">
              {(["daily", "weekly"] as HabitPeriod[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    period === p
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 "
                  }`}
                >
                  {p === "daily" ? "Her gün" : "Haftalık"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500 ">
              {period === "weekly" ? "Haftada kaç gün hedefi" : "Günde kaç kez hedefi"}
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTarget((t) => Math.max(1, t - 1))}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-lg font-bold text-slate-600 hover:bg-slate-200 "
              >
                −
              </button>
              <span className="w-8 text-center text-lg font-bold text-slate-900 ">
                {target}
              </span>
              <button
                type="button"
                onClick={() => setTarget((t) => Math.min(period === "weekly" ? 7 : 50, t + 1))}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-lg font-bold text-slate-600 hover:bg-slate-200 "
              >
                +
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 "
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {pending ? "Kaydediliyor…" : editing ? "Kaydet" : "Oluştur"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Heatmap({ habit }: { habit: Habit }) {
  const grid = buildHeatmap(habit.recent, HEATMAP_WEEKS, todayISO());
  return (
    <div className="flex gap-[3px]" aria-hidden>
      {grid.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-[3px]">
          {week.map((cell) => (
            <div
              key={cell.date}
              title={`${cell.date}: ${cell.count}`}
              className={`h-2.5 w-2.5 rounded-[2px] ${
                cell.future ? "bg-transparent" : LEVEL_BG[heatLevel(cell.count, habit.target_per_period)]
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function HabitCard({ habit }: { habit: Habit }) {
  const checkIn = useCheckInHabit();
  const del = useDeleteHabit();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const toggle = () => {
    let delta: number;
    if (habit.period === "weekly") {
      delta = habit.today_count > 0 ? -habit.today_count : 1;
    } else {
      delta = habit.today_count < habit.target_per_period ? 1 : -habit.today_count;
    }
    checkIn.mutate({ id: habit.id, delta });
  };

  const progressLabel =
    habit.period === "weekly"
      ? `${habit.period_count}/${habit.target_per_period} bu hafta`
      : habit.target_per_period > 1
        ? `${habit.period_count}/${habit.target_per_period} bugün`
        : null;

  const color = habit.color ?? "#6366f1";

  return (
    <div className="flex flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:shadow-md ">
      <div className="flex items-start gap-3">
        <button
          onClick={toggle}
          disabled={checkIn.isPending}
          aria-label={habit.done ? "Geri al" : "İşaretle"}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl font-bold transition active:scale-90 disabled:opacity-60 ${
            habit.done
              ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
              : "ring-2 ring-inset"
          }`}
          style={
            habit.done
              ? undefined
              : { color, boxShadow: `inset 0 0 0 2px ${color}33`, backgroundColor: `${color}12` }
          }
        >
          {habit.done ? (
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          ) : habit.target_per_period > 1 && habit.period === "daily" && habit.today_count > 0 ? (
            <span>{habit.today_count}</span>
          ) : (
            <span>{habit.icon ?? "✓"}</span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-base font-bold text-slate-900 ">
              {habit.icon && <span className="mr-1">{habit.icon}</span>}
              {habit.name}
            </h3>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                onClick={() => setEditing(true)}
                aria-label="Düzenle"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                </svg>
              </button>
              {confirming ? (
                <>
                  <button
                    onClick={() =>
                      del.mutate(habit.id, {
                        onSuccess: () => toast.success("Alışkanlık silindi."),
                        onError: (e) => toast.error(getErrorMessage(e, "Silinemedi.")),
                      })
                    }
                    disabled={del.isPending}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 "
                  >
                    Sil
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 "
                  >
                    Vazgeç
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  aria-label="Sil"
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-red-500 "
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            {habit.current_streak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-600 ">
                🔥 {habit.current_streak} {habit.period === "weekly" ? "hafta" : "gün"}
              </span>
            )}
            {progressLabel && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 ">
                {progressLabel}
              </span>
            )}
            <span className="text-slate-400 ">
              En uzun {habit.longest_streak} · Toplam {habit.total_completions}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto pb-1">
        <Heatmap habit={habit} />
      </div>

      {editing && <HabitModal habit={habit} onClose={() => setEditing(false)} />}
    </div>
  );
}

export default function Habits() {
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : STUDENT_NAV;
  const { data: habits, isLoading } = useHabits();
  const [creating, setCreating] = useState(false);

  const doneToday = habits?.filter((h) => h.done).length ?? 0;
  const total = habits?.length ?? 0;

  return (
    <DashboardShell title="Alışkanlıklar" navItems={navItems}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <Link
              to={ROUTES.learn}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 "
            >
              ← Öğren
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 ">
              Alışkanlıklar
            </h1>
            {total > 0 && (
              <p className="mt-1 text-sm text-slate-500 ">
                Bugün <span className="font-semibold text-emerald-600 ">{doneToday}</span>/{total} tamamlandı
              </p>
            )}
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Yeni Alışkanlık
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-100 " />
            ))}
          </div>
        ) : !habits || habits.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center ">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl ">🔥</div>
            <p className="mt-4 text-sm font-medium text-slate-700 ">
              Henüz alışkanlığın yok
            </p>
            <p className="mt-1 max-w-xs text-xs text-slate-400 ">
              Çalışma disiplinini kur: her gün soru çöz, kelime tekrarla, su iç… Küçük
              adımlarla seriyi büyüt.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              İlk Alışkanlığını Ekle
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {habits.map((h) => (
              <HabitCard key={h.id} habit={h} />
            ))}
          </div>
        )}
      </div>

      {creating && <HabitModal onClose={() => setCreating(false)} />}
    </DashboardShell>
  );
}
