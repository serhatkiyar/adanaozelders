import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { EkAralikModal, type EkAralik } from "@/components/takvim/EkAralikModal";
import { IzinModal, izinAraligiMetni, type IzinAraligi } from "@/components/takvim/IzinModal";
import { Modal } from "@/components/ui/Modal";
import { useBookings } from "@/hooks/useBookings";
import { useEkAraliklar } from "@/hooks/useEkAralik";
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
  { etiket: "Haftalık ders", sinif: "bg-rose-500" },
  { etiket: "İzin", sinif: "takvim-lejant-izin" },
  { etiket: "Ek aralık", sinif: "takvim-lejant-ek" },
];

const SAAT_BICIMI = { hour: "2-digit", minute: "2-digit", hour12: false } as const;

/** Şimdi − 4 saat: "Bugün" tıklaması ızgarayı "şu an" çizgisine bu saate kaydırır. */
function kaydirmaSaati(): string {
  const saat = Math.max(0, new Date().getHours() - 4);
  return `${String(saat).padStart(2, "0")}:00:00`;
}

/** İlk açılış saati (kullanıcı kararı, 22 Eyl 2026): gece ders verilmesi
 * pek olası değil, o yüzden şu ana göre değil sabit 09:00'dan açılır —
 * eğitmen doğrudan çalışma saatlerine gelir, gerekirse kendi kaydırır. */
const ILK_ACILIS_SAATI = "09:00:00";

/** "Ders planla" düğmesinin varsayılanı: yarın 10:00, bir saat. */
function varsayilanDersAraligi(): TeklifAraligi {
  const baslangic = new Date();
  baslangic.setDate(baslangic.getDate() + 2);
  baslangic.setHours(10, 0, 0, 0);
  const bitis = new Date(baslangic.getTime() + 60 * 60 * 1000);
  return { baslangic, bitis };
}

/** "Ek zaman aralığı aç" düğmesinin varsayılanı: yarın 18:00–20:00. */
function varsayilanEkAralik(): EkAralik {
  const baslangic = new Date();
  baslangic.setDate(baslangic.getDate() + 1);
  baslangic.setHours(18, 0, 0, 0);
  const bitis = new Date(baslangic.getTime() + 2 * 60 * 60 * 1000);
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

const HAFTA_HARFLERI = ["P", "S", "Ç", "P", "C", "C", "P"];

function gunEsit(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Google Takvim'deki küçük ay seçici (kullanıcı kararı, 22 Eyl 2026):
 *  "Oluştur" düğmesinin altında, bir güne tıklayınca ana ızgara o haftaya
 *  gider. Ayrı bir bileşen kütüphanesi (`@fullcalendar/daygrid`) eklemek
 *  yerine düz tarih hesabıyla yazıldı — 7x6 hücrelik bir ızgara için
 *  yeni bir bağımlılık gerekmiyor. */
function MiniAyTakvimi({ onSecim }: { onSecim: (tarih: Date) => void }) {
  const [ay, setAy] = useState(() => {
    const simdi = new Date();
    return new Date(simdi.getFullYear(), simdi.getMonth(), 1);
  });
  const bugun = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const gunler = useMemo(() => {
    const ilkGun = new Date(ay.getFullYear(), ay.getMonth(), 1);
    const baslangicKaydirma = (ilkGun.getDay() + 6) % 7;
    // Sabit 6 satır (kullanıcı kararı, 22 Eyl 2026): ay 5 satıra sığsa
    // bile yükseklik zıplamasın diye her zaman 42 hücre.
    return Array.from({ length: 42 }, (_, i) => new Date(ay.getFullYear(), ay.getMonth(), 1 - baslangicKaydirma + i));
  }, [ay]);

  return (
    <div className="p-1">
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="text-sm font-semibold text-slate-900">
          {ay.toLocaleDateString("tr-TR", { month: "long", year: "numeric" })}
        </p>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Önceki ay"
            onClick={() => setAy((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1))}
            className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-3.5 w-3.5" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Sonraki ay"
            onClick={() => setAy((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1))}
            className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-3.5 w-3.5" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {HAFTA_HARFLERI.map((harf, i) => (
          <span key={i} className="text-[11px] font-light text-slate-900">
            {harf}
          </span>
        ))}
        {gunler.map((gun, i) => {
          const buAy = gun.getMonth() === ay.getMonth();
          const buGunBugunMu = gunEsit(gun, bugun);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSecim(gun)}
              className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm transition ${
                buGunBugunMu
                  ? "bg-marka font-semibold text-white"
                  : buAy
                    ? "bg-marka/[0.01] font-[380] text-slate-900 hover:bg-marka/20"
                    : "bg-marka/[0.01] font-light text-slate-900 hover:bg-marka/20"
              }`}
            >
              {gun.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function TutorCalendar() {
  const navigate = useNavigate();
  const mobil = useMobil();
  const takvimRef = useRef<FullCalendar>(null);
  const izgaraSarmalayiciRef = useRef<HTMLDivElement>(null);

  const [ilkGorunum] = useState(() => (mobil ? "listWeek" : "timeGridWeek"));
  const [scrollTime] = useState(ILK_ACILIS_SAATI);

  const [pencere, setPencere] = useState<{ start: Date; end: Date; baslik: string } | null>(null);
  const [izinAraligi, setIzinAraligi] = useState<IzinAraligi | null>(null);
  const [silinecekIzin, setSilinecekIzin] = useState<TimeOff | null>(null);
  const [teklifAraligi, setTeklifAraligi] = useState<TeklifAraligi | null>(null);
  // Ek aralık penceresi: seçilen aralıkla "Ekle" ya da ajandadan "Eklenen aralıklar".
  const [ekAralik, setEkAralik] = useState<
    { aralik?: EkAralik; sekme: "ekle" | "liste" } | null
  >(null);
  // Boş alan seçilince önce NE yapılacağı sorulur (Preply: Ders planla / İzin ekle /
  // Ekstra müsaitlik aç).
  const [secim, setSecim] = useState<{ baslangic: Date; bitis: Date } | null>(null);
  // "Oluştur" açılır menüsü (Google Takvim referansı, 22 Eyl 2026): önceden
  // yan yana duran 4 düğme (Ders planla/İzin ekle/Ek aralık/Müsaitlik) tek
  // düğmenin altına toplandı.
  const [olusturAcik, setOlusturAcik] = useState(false);
  const olusturRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!olusturAcik) return;
    const onDoc = (e: MouseEvent) => {
      if (olusturRef.current && !olusturRef.current.contains(e.target as Node)) {
        setOlusturAcik(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [olusturAcik]);

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
  const ekler = useEkAraliklar(aralik);
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
      // Kabul edilmiş haftalık seri dersi ayrı renkte (Preply: haftalık ders pembe).
      else if (b.series_id && b.status === BookingStatus.ACCEPTED) sinif = "takvim-haftalik";
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
    for (const ek of ekler.data ?? []) {
      // Izgarada arka plan boyası: seçim üstünden yapılabilir, dersleri örtmez.
      // Ajanda görünümü arka plan olaylarını çizmez; telefonda satır olarak görünür.
      liste.push({
        id: `ek-${ek.id}`,
        title: "Ek aralık",
        start: ek.start_at,
        end: ek.end_at,
        display: mobil ? "auto" : "background",
        classNames: ["takvim-ek-aralik"],
        extendedProps: { tur: "ek" },
      });
    }
    return liste;
  }, [dersler.data, izinler.data, ekler.data, mobil]);

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
    },
    []
  );

  const olayTiklandi = useCallback(
    (arg: EventClickArg) => {
      arg.jsEvent.preventDefault();
      const { tur, dersId, izin } = arg.event.extendedProps as {
        tur: "ders" | "izin" | "ek";
        dersId?: number;
        izin?: TimeOff;
      };
      if (tur === "ders" && dersId) navigate(ROUTES.lesson(dersId));
      else if (tur === "izin" && izin) setSilinecekIzin(izin);
      else if (tur === "ek") setEkAralik({ aralik: varsayilanEkAralik(), sekme: "liste" });
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

  // "Bugün" tıklaması (kullanıcı kararı, 22 Eyl 2026): Google Takvim'deki
  // gibi ızgara "şu an" çizgisine YUMUŞAK kaysın. `scrollToTime` kendisi
  // scrollTop'u anında değiştiriyor; burada onu bir an için tetikleyip
  // hedefi okuyoruz, başlangıca geri sarıp requestAnimationFrame ile
  // kendimiz animasyonluyoruz — FullCalendar'ın piksel/saat hesabını
  // (slot yüksekliği, slotMinTime vb.) tekrar yazmamak için.
  const yumusakKaydirBugune = () => {
    const takvim = api();
    if (!takvim) return;
    const kaydirici = izgaraSarmalayiciRef.current?.querySelector<HTMLElement>(
      ".fc-scroller-liquid-absolute",
    );
    if (!kaydirici) {
      takvim.today();
      takvim.scrollToTime(kaydirmaSaati());
      return;
    }
    const baslangic = kaydirici.scrollTop;
    takvim.today();
    takvim.scrollToTime(kaydirmaSaati());
    const hedef = kaydirici.scrollTop;
    kaydirici.scrollTop = baslangic;
    if (hedef === baslangic) return;
    const sure = 450;
    const baslangicZamani = performance.now();
    const adim = (simdi: number) => {
      const t = Math.min(1, (simdi - baslangicZamani) / sure);
      const kolay = 1 - (1 - t) ** 3;
      kaydirici.scrollTop = baslangic + (hedef - baslangic) * kolay;
      if (t < 1) requestAnimationFrame(adim);
    };
    requestAnimationFrame(adim);
  };

  const hata = dersler.isError
    ? dersler.error
    : izinler.isError
      ? izinler.error
      : ekler.isError
        ? ekler.error
        : null;

  // `altBilgiGizli`: ızgara 24 saati çizdiği için sayfa zaten uzun; altına
  // pazarlama bağlantıları koymak takvimi bitmiyormuş gibi gösteriyordu
  // (kullanıcı, 17 Eyl 2026). Preply'ın panel ekranlarında da footer yok.
  return (
    <DashboardShell title="Takvim" navItems={TUTOR_NAV} genislik="genis" altBilgiGizli>
      <div className="pb-6 pt-0">
        <h1 className="sr-only">Takvim</h1>

        {/* Preply düzeni (17 Eyl 2026): solda eylemler ve renk açıklaması,
            sağda hafta gezinme satırı ve ızgara. */}
        <div className="gap-6 lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
          <aside className="mb-6 space-y-6 lg:mb-0">
            {/* Google Takvim'deki "+ Oluştur" düğmesi (kullanıcı kararı, 22 Eyl
                2026): eskiden burada 4 ayrı düğme yan yana duruyordu, artık
                tek düğme + açılır menü. */}
            <div ref={olusturRef} className="relative">
              <button
                type="button"
                onClick={() => setOlusturAcik((o) => !o)}
                aria-expanded={olusturAcik}
                className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 shadow-sm transition hover:shadow-md active:scale-95"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-5 w-5" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Oluştur
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {olusturAcik && (
                <div className="absolute left-0 top-full z-20 mt-2 w-full min-w-[220px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                    onClick={() => {
                      setTeklifAraligi(varsayilanDersAraligi());
                      setOlusturAcik(false);
                    }}
                  >
                    Ders planla
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                    onClick={() => {
                      setIzinAraligi(bugunTumGun());
                      setOlusturAcik(false);
                    }}
                  >
                    İzin ekle
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                    onClick={() => {
                      setEkAralik({ aralik: varsayilanEkAralik(), sekme: "ekle" });
                      setOlusturAcik(false);
                    }}
                  >
                    Ek zaman aralığı aç
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <Link
                    to={ROUTES.tutorListing}
                    className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                    onClick={() => setOlusturAcik(false)}
                  >
                    Müsaitliği düzenle
                  </Link>
                </div>
              )}
            </div>
            <MiniAyTakvimi onSecim={(gun) => api()?.gotoDate(gun)} />
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
            {/* Sıra Google Takvim'deki gibi: Bugün → geri/ileri → başlık
                (kullanıcı kararı, 22 Eyl 2026 — önceden Bugün en sağdaydı). */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Siyah (kullanıcı kararı, 22 Eyl 2026). Ortak `DUGME_SATIR_IKINCIL`
                  KULLANILMADI: onun çerçevesi varsayılanda soluk `slate-200`,
                  yalnız hover'da siyaha dönüyor — durağan haldeyken gri bir
                  kutu gibi görünüyordu, "siyah" isteği karşılanmamış oluyordu.
                  Burada çerçeve HER ZAMAN siyah. */}
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full border border-slate-900 bg-white px-6 text-base font-semibold text-slate-900 transition hover:bg-slate-900/[0.08] active:scale-[0.98]"
                onClick={yumusakKaydirBugune}
              >
                Bugün
              </button>
              {/* Google Takvim referansı (22 Eyl 2026, kullanıcı kararı): ok
                  tuşları dinlenme halinde zeminsiz — hover'da yuvarlak gri
                  zemin gelir. Ortak `DaireDugme` (gri daire zemin) burada
                  KULLANILMADI, çünkü iç dairenin zemin rengi çağrı yerinden
                  geçilemiyor. */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Önceki hafta"
                  onClick={() => api()?.prev()}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Sonraki hafta"
                  onClick={() => api()?.next()}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              <p className="min-w-0 flex-1 text-xl font-semibold leading-7 text-slate-900" aria-live="polite">
                {pencere?.baslik ?? ""}
              </p>
            </div>

            {hata && (
              <ErrorState
                description={getErrorMessage(hata, "Takvim yüklenemedi.")}
                onRetry={() => {
                  void dersler.refetch();
                  void izinler.refetch();
                  void ekler.refetch();
                }}
              />
            )}

            <div
              ref={izgaraSarmalayiciRef}
              aria-busy={dersler.isFetching || izinler.isFetching || ekler.isFetching}
              // Preply ölçüsü: ızgara görünüm yüksekliğini doldurur ve KENDİ içinde
              // kayar; sayfa büyümez, gün başlıkları yerinde kalır. Sabit
              // (230px), üst bar + "Oluştur/Bugün" satırının gerçek yüksekliği
              // ölçülerek bulundu (kullanıcı kararı, 22 Eyl 2026: altta 120px
              // boş alan kalıyordu, ızgara sıkışıyordu — 330'dan 230'a
              // indirilince altta yalnız ~20px nefes payı bırakıyor, taşma yok).
              className="md:h-[calc(100dvh-230px)] md:min-h-[520px]"
            >
          <FullCalendar
            ref={takvimRef}
            plugins={[timeGridPlugin, listPlugin, interactionPlugin]}
            locale={trLocale}
            initialView={ilkGorunum}
            headerToolbar={false}
            // Google Takvim referansı (22 Eyl 2026): hafta görünümünde bile
            // başlık "21–27 Eyl" değil "Eylül 2026" — ay + yıl.
            titleFormat={{ month: "long", year: "numeric" }}
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

      {ekAralik && (
        <EkAralikModal
          aralik={ekAralik.aralik}
          ilkSekme={ekAralik.sekme}
          onClose={() => setEkAralik(null)}
        />
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
          <button
            type="button"
            className={`${DUGME_IKINCIL} w-full`}
            onClick={() => {
              if (!secim) return;
              setEkAralik({ aralik: { baslangic: secim.baslangic, bitis: secim.bitis }, sekme: "ekle" });
              setSecim(null);
            }}
          >
            Ek zaman aralığı aç
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
