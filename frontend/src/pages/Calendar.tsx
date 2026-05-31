import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useBookings } from "@/hooks/useBookings";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { BookingStatus, ROLE_IDS, type BookingOut } from "@/types";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "@/lib/bookingStatus";
import { ROUTES } from "@/lib/routes";

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** Verilen tarihin içinde bulunduğu haftanın Pazartesi 00:00'ı (yerel). */
function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Pazartesi=0 … Pazar=6
  d.setDate(d.getDate() - day);
  return d;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const rangeFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" });

export default function Calendar() {
  const { data: user } = useCurrentUser();
  const isTutor = user?.role_id === ROLE_IDS.TUTOR;
  const navItems = isTutor ? TUTOR_NAV : STUDENT_NAV;

  const { data: bookings, isLoading } = useBookings({ limit: 100 });
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = useMemo(() => {
    const base = mondayOf(new Date());
    base.setDate(base.getDate() + weekOffset * 7);
    return base;
  }, [weekOffset]);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [weekStart]
  );

  // İptal/red dışındaki dersleri günlere dağıt (gün -> sıralı ders listesi).
  const byDay = useMemo(() => {
    const map = new Map<string, BookingOut[]>();
    for (const b of bookings ?? []) {
      if (b.status === BookingStatus.CANCELLED || b.status === BookingStatus.REJECTED) {
        continue;
      }
      const start = new Date(b.start_at);
      const day = days.find((d) => sameDay(d, start));
      if (!day) continue;
      const key = day.toDateString();
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));
    }
    return map;
  }, [bookings, days]);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const today = new Date();

  return (
    <DashboardShell navItems={navItems} title="Takvim">
      <div className="mx-auto max-w-6xl">
        {/* Hafta navigasyonu */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
              Haftalık Takvim
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {rangeFmt.format(weekStart)} – {rangeFmt.format(weekEnd)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekOffset((o) => o - 1)}
              className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              ‹ Önceki
            </button>
            <button
              onClick={() => setWeekOffset(0)}
              className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              Bu hafta
            </button>
            <button
              onClick={() => setWeekOffset((o) => o + 1)}
              className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              Sonraki ›
            </button>
          </div>
        </div>

        {/* Haftalık ızgara */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
          {days.map((day, i) => {
            const list = byDay.get(day.toDateString()) ?? [];
            const isToday = sameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={`min-h-[140px] rounded-2xl border p-2.5 ${
                  isToday
                    ? "border-indigo-300 bg-indigo-50/50 dark:border-indigo-500/40 dark:bg-indigo-500/5"
                    : "border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-800"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {WEEKDAYS[i]}
                  </span>
                  <span
                    className={`text-sm font-bold ${
                      isToday
                        ? "text-indigo-600 dark:text-indigo-400"
                        : "text-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {list.map((b) => {
                    const counterparty = isTutor ? b.client_name : b.tutor_name;
                    const style =
                      BOOKING_STATUS_STYLE[b.status] ??
                      "bg-slate-100 text-slate-600";
                    return (
                      <Link
                        key={b.id}
                        to={ROUTES.lesson(b.id)}
                        className="block rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs transition hover:border-indigo-200 hover:bg-indigo-50/60 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:bg-slate-700/50"
                        title={`${BOOKING_STATUS_LABEL[b.status]} — ${counterparty ?? ""}`}
                      >
                        <div className="font-semibold text-slate-700 dark:text-slate-200">
                          {timeFmt.format(new Date(b.start_at))}
                        </div>
                        <div className="truncate text-slate-500 dark:text-slate-400">
                          {counterparty ?? "—"}
                        </div>
                        <span
                          className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${style}`}
                        >
                          {b.mode === "IN_PERSON" ? "📍" : "🎥"}{" "}
                          {BOOKING_STATUS_LABEL[b.status]}
                        </span>
                      </Link>
                    );
                  })}
                  {!isLoading && list.length === 0 && (
                    <p className="pt-2 text-center text-[11px] text-slate-300 dark:text-slate-600">
                      —
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardShell>
  );
}
