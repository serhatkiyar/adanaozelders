import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { FullScreenSpinner } from "@/components/Spinner";
import { NewLessonRequestModal } from "@/components/NewLessonRequestModal";
import { BookingModal } from "@/components/BookingModal";
import { navForRole, UYE_NAV } from "@/lib/nav";
import { useBookings } from "@/hooks/useBookings";
import { useTutorDetail } from "@/hooks/useTutorSearch";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toast } from "@/store/toastStore";
import { BookingStatus, ROLE_IDS, type BookingOut } from "@/types";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "@/lib/bookingStatus";
import { ROUTES } from "@/lib/routes";

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** Yerel (timezone kaymasız) "YYYY-MM-DD" — takvim hücresinden tarih önseçimi için. */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Seçilen eğitmenin detayını (uygunluk/mod) çekip BookingModal'ı açar.
function BookingLauncher({
  tutorId,
  initialDate,
  onClose,
}: {
  tutorId: number;
  initialDate?: string;
  onClose: () => void;
}) {
  const { data: tutor, isLoading, isError } = useTutorDetail(tutorId);

  useEffect(() => {
    if (isError) {
      toast.error("Eğitmen bilgileri yüklenemedi.");
      onClose();
    }
  }, [isError, onClose]);

  if (isLoading || !tutor) return <FullScreenSpinner />;
  return <BookingModal tutor={tutor} initialDate={initialDate} onClose={onClose} />;
}

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
  const isStudent = user?.role_id === ROLE_IDS.CLIENT;
  const navItems = navForRole(user?.role_id) ?? UYE_NAV;

  const { data: bookings, isLoading } = useBookings({ limit: 100 });
  const [weekOffset, setWeekOffset] = useState(0);

  // "Ders talebi oluştur" akışı: gün seçimi → eğitmen seçici → BookingModal.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<string | null>(null);
  const [pickedTutorId, setPickedTutorId] = useState<number | null>(null);
  const openPicker = (dateStr: string | null) => {
    setPickerDate(dateStr);
    setPickerOpen(true);
  };

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
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return (
    <DashboardShell navItems={navItems} title="Takvim">
      <div className="mx-auto max-w-6xl">
        {/* Hafta navigasyonu */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800 ">
              Haftalık Takvim
            </h1>
            <p className="text-sm text-slate-500 ">
              {rangeFmt.format(weekStart)} – {rangeFmt.format(weekEnd)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isStudent && (
              <button
                onClick={() => openPicker(null)}
                className="mr-1 flex items-center gap-1.5 rounded-xl bg-marka px-3 py-2 text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span className="hidden sm:inline">Ders Talebi</span>
              </button>
            )}
            <button
              onClick={() => setWeekOffset((o) => o - 1)}
              className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200 "
            >
              ‹ Önceki
            </button>
            <button
              onClick={() => setWeekOffset(0)}
              className="rounded-xl bg-marka px-3 py-2 text-sm font-medium text-marka-fg transition hover:bg-marka-hover"
            >
              Bu hafta
            </button>
            <button
              onClick={() => setWeekOffset((o) => o + 1)}
              className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200 "
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
            const isPast = day < startOfToday;
            return (
              <div
                key={day.toISOString()}
                className={`min-h-[140px] rounded-2xl border p-2.5 ${
                  isToday
                    ? "border-marka-mid bg-marka-soft/50 "
                    : "border-slate-100 bg-white "
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 ">
                    {WEEKDAYS[i]}
                  </span>
                  <span
                    className={`text-sm font-bold ${
                      isToday
                        ? "text-marka-metin "
                        : "text-slate-700 "
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
                        className="block rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs transition hover:border-marka-line hover:bg-marka-soft/60 "
                        title={`${BOOKING_STATUS_LABEL[b.status]}, ${counterparty ?? ""}`}
                      >
                        <div className="font-semibold text-slate-700 ">
                          {timeFmt.format(new Date(b.start_at))}
                        </div>
                        <div className="truncate text-slate-500 ">
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
                    <p className="pt-2 text-center text-[11px] text-slate-300 ">
                      —
                    </p>
                  )}
                </div>

                {isStudent && !isPast && (
                  <button
                    onClick={() => openPicker(localDateStr(day))}
                    className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 py-1.5 text-[11px] font-semibold text-slate-400 transition hover:border-marka-mid hover:bg-marka-soft/40 hover:text-marka-soft-fg "
                  >
                    + Ekle
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isStudent && pickerOpen && (
        <NewLessonRequestModal
          dateLabel={pickerDate ? rangeFmt.format(new Date(pickerDate)) : null}
          onPick={(id) => {
            setPickedTutorId(id);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {pickedTutorId != null && (
        <BookingLauncher
          tutorId={pickedTutorId}
          initialDate={pickerDate ?? undefined}
          onClose={() => {
            setPickedTutorId(null);
            setPickerDate(null);
          }}
        />
      )}
    </DashboardShell>
  );
}
