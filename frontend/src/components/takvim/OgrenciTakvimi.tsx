import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import type { DateSelectArg, DatesSetArg, EventClickArg, EventInput } from "@fullcalendar/core";
import trLocale from "@fullcalendar/core/locales/tr";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";

import { BookingModal } from "@/components/BookingModal";
import { NewLessonRequestModal } from "@/components/NewLessonRequestModal";
import { FullScreenSpinner } from "@/components/Spinner";
import { ErrorState } from "@/components/admin/ui/PageState";
import { KUCUK_ACIKLAMA } from "@/components/pano/stil";
import { useBookings } from "@/hooks/useBookings";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { useTutorDetail } from "@/hooks/useTutorSearch";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import { BookingStatus } from "@/types";

/**
 * Öğrencinin takvimi — "Derslerim → Takvim" sekmesi.
 *
 * Öğretmenin takvimiyle AYNI ızgara (`pages/TutorCalendar.tsx`): saat
 * ızgarası, aynı renk sözlüğü, aynı hafta gezinmesi. Öğrencinin eski haftalık
 * LİSTE takvimi kaldırıldı (kullanıcı kararı, 22 Eyl 2026) — iki farklı
 * takvim dili tutmanın bir sebebi yoktu.
 *
 * Öğretmene ait eylemler (izin, ek aralık, ders teklifi) burada YOK; boş bir
 * saat seçmek öğrencinin yapabildiği tek şeyi açar: ders talebi.
 */
const OLAY_SINIFI: Partial<Record<BookingStatus, string>> = {
  [BookingStatus.PENDING]: "takvim-bekliyor",
  [BookingStatus.ACCEPTED]: "takvim-onayli",
  [BookingStatus.COMPLETED]: "takvim-tamamlandi",
};

const LEJANT: { etiket: string; sinif: string }[] = [
  { etiket: "Onay bekliyor", sinif: "bg-amber-400" },
  { etiket: "Onaylı", sinif: "bg-marka-mid" },
  { etiket: "Ücretsiz ilk ders", sinif: "bg-teal-600" },
  { etiket: "Tamamlandı", sinif: "bg-slate-400" },
  { etiket: "Haftalık ders", sinif: "bg-rose-500" },
];

const SAAT_BICIMI = { hour: "2-digit", minute: "2-digit", hour12: false } as const;
const ILK_ACILIS_SAATI = "09:00:00";

/** Seçilen öğretmenin detayını çekip `BookingModal`ı açar. */
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
      toast.error("Öğretmen bilgileri yüklenemedi.");
      onClose();
    }
  }, [isError, onClose]);

  if (isLoading || !tutor) return <FullScreenSpinner />;
  return <BookingModal tutor={tutor} initialDate={initialDate} onClose={onClose} />;
}

function yerelGun(d: Date): string {
  const ay = String(d.getMonth() + 1).padStart(2, "0");
  const gun = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${ay}-${gun}`;
}

export function OgrenciTakvimi() {
  const navigate = useNavigate();
  const mobil = useMobil();
  const takvimRef = useRef<FullCalendar>(null);
  const [ilkGorunum] = useState(() => (mobil ? "listWeek" : "timeGridWeek"));
  const [pencere, setPencere] = useState<{ start: Date; end: Date; baslik: string } | null>(null);
  // Ders talebi akışı: saat seçimi → öğretmen seçici → BookingModal.
  const [secilenGun, setSecilenGun] = useState<string | null>(null);
  const [secilenOgretmen, setSecilenOgretmen] = useState<number | null>(null);

  const aralik = pencere
    ? { start: pencere.start.toISOString(), end: pencere.end.toISOString() }
    : null;
  const dersler = useBookings(
    { start_from: aralik?.start, start_to: aralik?.end, limit: 300 },
    { enabled: aralik !== null }
  );

  const olaylar = useMemo<EventInput[]>(() => {
    const liste: EventInput[] = [];
    for (const b of dersler.data ?? []) {
      // İptal/reddedilen dersler takvimde yer tutmaz.
      let sinif = OLAY_SINIFI[b.status];
      if (!sinif) continue;
      if (b.is_free_lesson && b.status !== BookingStatus.COMPLETED) sinif = "takvim-deneme";
      else if (b.series_id && b.status === BookingStatus.ACCEPTED) sinif = "takvim-haftalik";
      liste.push({
        id: `ders-${b.id}`,
        title: b.tutor_name ?? "Ders",
        start: b.start_at,
        end: b.end_at,
        classNames: [sinif],
        extendedProps: { dersId: b.id },
      });
    }
    return liste;
  }, [dersler.data]);

  const api = () => takvimRef.current?.getApi();

  function datesSet(arg: DatesSetArg) {
    setPencere({ start: arg.start, end: arg.end, baslik: arg.view.title });
  }

  function secildi(arg: DateSelectArg) {
    setSecilenGun(yerelGun(arg.start));
    api()?.unselect();
  }

  function olayTiklandi(arg: EventClickArg) {
    const id = arg.event.extendedProps.dersId as number | undefined;
    if (id) navigate(ROUTES.lesson(id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => api()?.today()}
          className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full border border-slate-900 bg-white px-6 text-base font-semibold text-slate-900 transition hover:bg-slate-900/[0.08] active:scale-95"
        >
          Bugün
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Önceki hafta"
            onClick={() => api()?.prev()}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-900/[0.05] hover:text-slate-900 active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-[18px] w-[18px]" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Sonraki hafta"
            onClick={() => api()?.next()}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-900/[0.05] hover:text-slate-900 active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-[18px] w-[18px]" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <p className="min-w-0 flex-1 text-xl font-semibold leading-7 text-slate-900" aria-live="polite">
          {pencere?.baslik ?? ""}
        </p>
      </div>

      {dersler.isError && (
        <ErrorState
          description={getErrorMessage(dersler.error, "Takvim yüklenemedi.")}
          onRetry={() => void dersler.refetch()}
        />
      )}

      <div
        aria-busy={dersler.isFetching}
        className="overflow-hidden rounded-xl border border-slate-200 bg-white md:h-[calc(100dvh-320px)] md:min-h-[480px]"
      >
        <FullCalendar
          ref={takvimRef}
          plugins={[timeGridPlugin, listPlugin, interactionPlugin]}
          locale={trLocale}
          initialView={ilkGorunum}
          headerToolbar={false}
          titleFormat={{ month: "long", year: "numeric" }}
          firstDay={1}
          nowIndicator
          allDaySlot={false}
          slotDuration="00:30:00"
          scrollTime={ILK_ACILIS_SAATI}
          slotLabelFormat={SAAT_BICIMI}
          eventTimeFormat={SAAT_BICIMI}
          dayHeaderFormat={{ day: "numeric", month: "short", weekday: "short" }}
          height={mobil ? "auto" : "100%"}
          editable={false}
          selectable
          selectMirror
          selectAllow={(info) => info.start.getTime() >= Date.now()}
          select={secildi}
          selectLongPressDelay={300}
          events={olaylar}
          eventInteractive
          eventClick={olayTiklandi}
          datesSet={datesSet}
          noEventsContent="Bu hafta dersin yok."
        />
      </div>

      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Renk açıklaması">
        {LEJANT.map((l) => (
          <li key={l.etiket} className={`flex items-center gap-2 ${KUCUK_ACIKLAMA}`}>
            <span aria-hidden className={`h-4 w-1 rounded-full ${l.sinif}`} />
            {l.etiket}
          </li>
        ))}
      </ul>

      {secilenGun && secilenOgretmen == null && (
        <NewLessonRequestModal
          dateLabel={new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" }).format(
            new Date(secilenGun)
          )}
          onPick={(id) => setSecilenOgretmen(id)}
          onClose={() => setSecilenGun(null)}
        />
      )}

      {secilenOgretmen != null && (
        <BookingLauncher
          tutorId={secilenOgretmen}
          initialDate={secilenGun ?? undefined}
          onClose={() => {
            setSecilenOgretmen(null);
            setSecilenGun(null);
          }}
        />
      )}
    </div>
  );
}
