import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import type { DateSelectArg, DatesSetArg, EventClickArg, EventInput } from "@fullcalendar/core";
import trLocale from "@fullcalendar/core/locales/tr";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";

import { DashboardShell } from "@/components/DashboardShell";
import { ErrorState } from "@/components/admin/ui/PageState";
import {
  ACIKLAMA,
  DUGME_BIRINCIL,
  DUGME_IKINCIL,
  DUGME_SATIR_IKINCIL,
  DUGME_SATIR_TEHLIKE,
} from "@/components/pano/stil";
import { DersTeklifModal, type TeklifAraligi } from "@/components/takvim/DersTeklifModal";
import { IzinModal, izinAraligiMetni, type IzinAraligi } from "@/components/takvim/IzinModal";
import { Modal } from "@/components/ui/Modal";
import { DaireDugme } from "@/components/ui/DaireDugme";
import { useBookings } from "@/hooks/useBookings";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { useDeleteTimeOff, useTimeOff } from "@/hooks/useTimeOff";
import { useMyTutorProfile } from "@/hooks/useTutorProfile";
import { toBusinessHours } from "@/lib/availability";
import { getErrorDetail, getErrorMessage } from "@/lib/errors";
import { TUTOR_NAV } from "@/lib/nav";
import { ADSIZ_UYE } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import { BookingStatus, type TimeOff } from "@/types";

/** Durum → takvim olay sınıfı (renkler `index.css` içinde, `.fc` altında). */
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
  { etiket: "İzin", sinif: "takvim-lejant-izin" },
];

const SAAT_BICIMI = { hour: "2-digit", minute: "2-digit", hour12: false } as const;

/** Yerel "yyyy-MM-dd" — `?hafta=` parametresi için (tz kaymasız). */
function yerelGun(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const g = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${g}`;
}

/** `?hafta=yyyy-MM-dd` → yerel tarih; geçersizse bugün. */
function haftaParametresi(deger: string | null): Date {
  const m = deger?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Şimdi − 4 saat: Preply gibi ızgara günün geçmiş saatlerini değil, yakın saatleri açar. */
function kaydirmaSaati(): string {
  const saat = Math.max(0, new Date().getHours() - 4);
  return `${String(saat).padStart(2, "0")}:00:00`;
}

/** "Ders planla" düğmesinin varsayılanı: yarın 10:00, bir saat. */
function varsayilanDersAraligi(): TeklifAraligi {
  const baslangic = new Date();
  baslangic.setDate(baslangic.getDate() + 2);
  baslangic.setHours(10, 0, 0, 0);
  const bitis = new Date(baslangic.getTime() + 60 * 60 * 1000);
  return { baslangic, bitis };
}

/** "İzin ekle" düğmesinin varsayılanı: bugün, tüm gün. */
function bugunTumGun(): IzinAraligi {
  const baslangic = new Date();
  baslangic.setHours(0, 0, 0, 0);
  const bitis = new Date(baslangic);
  bitis.setDate(bitis.getDate() + 1);
  return { baslangic, bitis, tumGun: true };
}

export default function TutorCalendar() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mobil = useMobil();
  const takvimRef = useRef<FullCalendar>(null);

  // İlk açılış tarihi yalnız bir kez okunur; sonrası `datesSet` ile URL'e yazılır.
  const [ilkTarih] = useState(() => haftaParametresi(searchParams.get("hafta")));
  const [ilkGorunum] = useState(() => (mobil ? "listWeek" : "timeGridWeek"));
  const [scrollTime] = useState(kaydirmaSaati);

  const [pencere, setPencere] = useState<{ start: Date; end: Date; baslik: string } | null>(null);
  const [izinAraligi, setIzinAraligi] = useState<IzinAraligi | null>(null);
  const [silinecekIzin, setSilinecekIzin] = useState<TimeOff | null>(null);
  const [teklifAraligi, setTeklifAraligi] = useState<TeklifAraligi | null>(null);
  // Boş alan seçilince önce NE yapılacağı sorulur (Preply: Ders planla / İzin ekle).
  const [secim, setSecim] = useState<{ baslangic: Date; bitis: Date } | null>(null);

  // Telefonda ajanda, geniş ekranda haftalık ızgara.
  useEffect(() => {
    const api = takvimRef.current?.getApi();
    const hedef = mobil ? "listWeek" : "timeGridWeek";
    if (api && api.view.type !== hedef) api.changeView(hedef);
  }, [mobil]);

  const aralik = useMemo(
    () => (pencere ? { start: pencere.start.toISOString(), end: pencere.end.toISOString() } : null),
    [pencere]
  );

  const dersler = useBookings(
    { start_from: aralik?.start, start_to: aralik?.end, limit: 300 },
    { enabled: aralik !== null }
  );
  const izinler = useTimeOff(aralik);
  const { data: ilan } = useMyTutorProfile();
  const silme = useDeleteTimeOff();

  const businessHours = useMemo(() => toBusinessHours(ilan?.availability), [ilan?.availability]);

  const olaylar = useMemo<EventInput[]>(() => {
    const liste: EventInput[] = [];
    for (const b of dersler.data ?? []) {
      // İptal/reddedilen dersler takvimde yer tutmaz.
      let sinif = OLAY_SINIFI[b.status];
      if (!sinif) continue;
      // Ücretsiz ilk ders kendi rengini taşır; tamamlandıysa geçmiş rengi kalır.
      if (b.is_free_lesson && b.status !== BookingStatus.COMPLETED) sinif = "takvim-deneme";
      liste.push({
        id: `ders-${b.id}`,
        title: b.client_name || ADSIZ_UYE,
        start: b.start_at,
        end: b.end_at,
        classNames: [sinif],
        extendedProps: { tur: "ders", dersId: b.id },
      });
    }
    for (const izin of izinler.data ?? []) {
      liste.push({
        id: `izin-${izin.id}`,
        title: izin.title || "İzin",
        start: izin.start_at,
        end: izin.end_at,
        classNames: ["takvim-izin"],
        extendedProps: { tur: "izin", izin },
      });
    }
    return liste;
  }, [dersler.data, izinler.data]);

  const datesSet = useCallback(
    (arg: DatesSetArg) => {
      setPencere((onceki) =>
        onceki &&
        onceki.start.getTime() === arg.start.getTime() &&
        onceki.end.getTime() === arg.end.getTime() &&
        onceki.baslik === arg.view.title
          ? onceki
          : { start: arg.start, end: arg.end, baslik: arg.view.title }
      );
      const hafta = yerelGun(arg.start);
      setSearchParams(
        (p) => {
          if (p.get("hafta") === hafta) return p;
          const yeni = new URLSearchParams(p);
          yeni.set("hafta", hafta);
          return yeni;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const olayTiklandi = useCallback(
    (arg: EventClickArg) => {
      arg.jsEvent.preventDefault();
      const { tur, dersId, izin } = arg.event.extendedProps as {
        tur: "ders" | "izin";
        dersId?: number;
        izin?: TimeOff;
      };
      if (tur === "ders" && dersId) navigate(ROUTES.lesson(dersId));
      else if (tur === "izin" && izin) setSilinecekIzin(izin);
    },
    [navigate]
  );

  const secildi = useCallback((arg: DateSelectArg) => {
    arg.view.calendar.unselect();
    setSecim({ baslangic: arg.start, bitis: arg.end });
  }, []);

  const izniKaldir = () => {
    if (!silinecekIzin) return;
    silme.mutate(silinecekIzin.id, {
      onSuccess: () => {
        toast.success("İzin kaldırıldı.");
        setSilinecekIzin(null);
      },
      onError: (e) => toast.error(getErrorDetail(e, "İzin kaldırılamadı.")),
    });
  };

  const api = () => takvimRef.current?.getApi();
  // Görünen aralık bugünü kapsıyorsa "Bugün" bir işe yaramaz — Preply'da da pasif.
  const buHafta =
    pencere !== null && Date.now() >= pencere.start.getTime() && Date.now() < pencere.end.getTime();
  const hata = dersler.isError ? dersler.error : izinler.isError ? izinler.error : null;

  // `altBilgiGizli`: ızgara 24 saati çizdiği için sayfa zaten uzun; altına
  // pazarlama bağlantıları koymak takvimi bitmiyormuş gibi gösteriyordu
  // (kullanıcı, 17 Eyl 2026). Preply'ın panel ekranlarında da footer yok.
  return (
    <DashboardShell title="Takvim" navItems={TUTOR_NAV} genislik="genis" altBilgiGizli>
      <div className="pb-6 pt-2">
        <h1 className="sr-only">Takvim</h1>

        {/* Preply düzeni (17 Eyl 2026): solda eylemler ve renk açıklaması,
            sağda hafta gezinme satırı ve ızgara. */}
        <div className="gap-6 lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
          <aside className="mb-6 space-y-6 lg:mb-0">
            <div className="space-y-3">
              <button
                type="button"
                className={`${DUGME_BIRINCIL} w-full`}
                onClick={() => setTeklifAraligi(varsayilanDersAraligi())}
              >
                Ders planla
              </button>
              <button
                type="button"
                className={`${DUGME_IKINCIL} w-full`}
                onClick={() => setIzinAraligi(bugunTumGun())}
              >
                İzin ekle
              </button>
              <Link to={ROUTES.tutorListing} className={`${DUGME_IKINCIL} w-full`}>
                Müsaitliği düzenle
              </Link>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Etiketler</p>
              <ul className="space-y-2" aria-label="Renk açıklaması">
                {LEJANT.map((l) => (
                  <li key={l.etiket} className="flex items-center gap-3 text-base leading-6 text-slate-700">
                    <span aria-hidden className={`h-5 w-1 rounded-full ${l.sinif}`} />
                    {l.etiket}
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <DaireDugme yon="sol" aria-label="Önceki hafta" onClick={() => api()?.prev()} />
                <DaireDugme yon="sag" aria-label="Sonraki hafta" onClick={() => api()?.next()} />
              </div>
              <p className="min-w-0 flex-1 text-xl font-semibold leading-7 text-slate-900" aria-live="polite">
                {pencere?.baslik ?? ""}
              </p>
              <button
                type="button"
                className={DUGME_SATIR_IKINCIL}
                onClick={() => api()?.today()}
                disabled={buHafta}
              >
                Bugün
              </button>
            </div>

            {hata && (
              <ErrorState
                description={getErrorMessage(hata, "Takvim yüklenemedi.")}
                onRetry={() => {
                  void dersler.refetch();
                  void izinler.refetch();
                }}
              />
            )}

            <div
              aria-busy={dersler.isFetching || izinler.isFetching}
              // Preply ölçüsü: ızgara görünüm yüksekliğini doldurur ve KENDİ içinde
              // kayar; sayfa büyümez, gün başlıkları yerinde kalır.
              className="md:h-[calc(100dvh-330px)] md:min-h-[520px]"
            >
          <FullCalendar
            ref={takvimRef}
            plugins={[timeGridPlugin, listPlugin, interactionPlugin]}
            locale={trLocale}
            initialView={ilkGorunum}
            initialDate={ilkTarih}
            headerToolbar={false}
            firstDay={1}
            nowIndicator
            allDaySlot={false}
            slotDuration="00:30:00"
            scrollTime={scrollTime}
            slotLabelFormat={SAAT_BICIMI}
            eventTimeFormat={SAAT_BICIMI}
            dayHeaderFormat={{ day: "numeric", month: "short", weekday: "short" }}
            height={mobil ? "auto" : "100%"}
            editable={false}
            selectable
            selectMirror
            selectAllow={(info) => info.start.getTime() >= Date.now()}
            select={secildi}
            // Dokunmatikte seçim uzun basma ister; varsayılan 1 sn fazla uzun.
            selectLongPressDelay={300}
            businessHours={businessHours}
            events={olaylar}
            eventInteractive
            eventClick={olayTiklandi}
            datesSet={datesSet}
            noEventsContent="Bu hafta ders ya da izin yok."
          />
            </div>
          </div>
        </div>
      </div>

      {izinAraligi && (
        <IzinModal aralik={izinAraligi} onClose={() => setIzinAraligi(null)} />
      )}

      {teklifAraligi && (
        <DersTeklifModal aralik={teklifAraligi} onClose={() => setTeklifAraligi(null)} />
      )}

      <Modal
        open={secim !== null}
        onClose={() => setSecim(null)}
        title="Bu saatte ne yapalım?"
        description={
          secim
            ? izinAraligiMetni(secim.baslangic.toISOString(), secim.bitis.toISOString())
            : undefined
        }
      >
        <div className="space-y-3">
          <button
            type="button"
            className={`${DUGME_BIRINCIL} w-full`}
            onClick={() => {
              if (!secim) return;
              setTeklifAraligi({ baslangic: secim.baslangic, bitis: secim.bitis });
              setSecim(null);
            }}
          >
            Ders planla
          </button>
          <button
            type="button"
            className={`${DUGME_IKINCIL} w-full`}
            onClick={() => {
              if (!secim) return;
              setIzinAraligi({ baslangic: secim.baslangic, bitis: secim.bitis, tumGun: false });
              setSecim(null);
            }}
          >
            İzin ekle
          </button>
        </div>
      </Modal>

      <Modal
        open={silinecekIzin !== null}
        onClose={() => setSilinecekIzin(null)}
        title="İzni kaldır"
        description={
          silinecekIzin
            ? `${silinecekIzin.title || "İzin"} · ${izinAraligiMetni(silinecekIzin.start_at, silinecekIzin.end_at)}`
            : undefined
        }
      >
        <p className={ACIKLAMA}>
          Bu aralık yeniden ders alınabilir olur. İzin eklenirken iptal edilen dersler geri gelmez.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className={DUGME_SATIR_IKINCIL} onClick={() => setSilinecekIzin(null)}>
            Vazgeç
          </button>
          <button
            type="button"
            className={DUGME_SATIR_TEHLIKE}
            onClick={izniKaldir}
            disabled={silme.isPending}
          >
            {silme.isPending ? "Kaldırılıyor…" : "İzni kaldır"}
          </button>
        </div>
      </Modal>
    </DashboardShell>
  );
}
