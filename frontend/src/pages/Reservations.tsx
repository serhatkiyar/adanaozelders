// Rezervasyonlarım — ders, çalışma alanı ve deneme sınavı TEK listede.
//
// ## Neden tek liste
//
// Kullanıcının bu ekranda sorduğu şey "bu hafta ne var". Ürün türüne göre iki
// sekmeye bölmek o soruyu iki kez sordurur ve aynı gün içindeki iki randevuyu
// yan yana göremezsin. NN/g'nin ölçümü de homojen, karşılaştırmalı içerikte
// tutarlı liste satırını gösteriyor — tür farkı küçük bir etiketle taşınır,
// ayrı bir görsel dil gerektirmez.
//
// Geçmiş kayıtlar varsayılan olarak KAPALI: ekranın işi "sırada ne var",
// arşiv değil.
import { useMemo, useState } from "react";
import { SAYFA_BASLIGI } from "@/lib/tipografi";
import {
  ACIKLAMA,
  DUGME_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  ETIKET,
  KUCUK_ACIKLAMA,
  METIN_BAGLANTI,
} from "@/components/pano/stil";
import { Link, useSearchParams } from "react-router-dom";

import { Avatar } from "@/components/Avatar";
import { DashboardShell } from "@/components/DashboardShell";
import { PaymentConsentNote } from "@/components/LegalConsent";
import { PaymentBranchNotice } from "@/components/PaymentBranchNotice";
import { LibraryReservationRow } from "@/components/reservation/LibraryReservationRow";
import { OgrenciTakvimi } from "@/components/takvim/OgrenciTakvimi";
import { useBookings } from "@/hooks/useBookings";
import { useMyTutors } from "@/hooks/useClientProfile";
import { useCheckoutResultToast } from "@/hooks/useCheckoutResult";
import { useMyRegistrations } from "@/hooks/useLibraryExams";
import { useMyStudyReservations } from "@/hooks/useStudy";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { isBranchOpen } from "@/lib/paymentAvailability";
import { UYE_NAV } from "@/lib/nav";
import { toReservationItem } from "@/lib/reservationModel";
import { formatDate } from "@/lib/datetime";
import { formatTRY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { useDerseKatil } from "@/hooks/useDerseKatil";
import { BookingStatus, PaymentStatus } from "@/types";
import { BookingRow, PAY_CLOSED_NOTICE_ID } from "@/components/reservation/LessonRow";
import type { ReservationItem } from "@/lib/reservationModel";
import type { BookingOut, RegistrationOut, StudyReservationOut } from "@/types";
import { ADSIZ_UYE } from "@/lib/roles";

type Sekme = "dersler" | "takvim" | "ogretmenler";

export default function Reservations() {
  useCheckoutResultToast(); // iyzico dönüşü: ?odeme=basarili|basarisiz
  // Sekme adreste tutulur: `/takvim` buraya yönlendiği için paylaşılan link
  // ve geri tuşu doğru sekmeyi açar (kullanıcı kararı, 22 Eyl 2026).
  const [parametreler, setParametreler] = useSearchParams();
  const sekmeParam = parametreler.get("sekme");
  const sekme: Sekme = sekmeParam === "takvim" || sekmeParam === "ogretmenler" ? sekmeParam : "dersler";
  const setSekme = (s: Sekme) =>
    setParametreler(s === "dersler" ? {} : { sekme: s }, { replace: true });

  return (
    /* Telefonda üst bar GERİ GELDİ (Modül 4, 18 Eyl 2026). 16 Eyl'de
       gizlenmişti, çünkü alt çubukta "Rezervasyon" sekmesi vardı; o sekme
       Pano'ya döndü ve liste artık şeridin ikinci sekmesinden açılıyor.
       Şerit üst barla birlikte çizildiği için bayrak kalkmak zorundaydı. */
    <DashboardShell title="Derslerim" navItems={UYE_NAV} genislik="dar">
      <div className="pb-16 pt-2">
        <h1 className={SAYFA_BASLIGI}>Derslerim</h1>

        {/* İki sekme (Preply referansı, kullanıcı kararı 22 Eyl 2026):
            "Dersler" sırada ne var sorusunu, "Öğretmenlerim" kiminle ders
            aldım sorusunu yanıtlar. Preply'daki üçüncü sekme (Takvim) bizde
            ayrı bir sayfa (`/takvim`), kopyalanmadı. */}
        <div
          className="mt-6 flex gap-6 border-b border-slate-200"
          role="tablist"
          aria-label="Ders bölümleri"
        >
          {(
            [
              ["dersler", "Dersler"],
              ["takvim", "Takvim"],
              ["ogretmenler", "Öğretmenlerim"],
            ] as const
          ).map(([k, etiket]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={sekme === k}
              onClick={() => setSekme(k)}
              className={`-mb-px border-b-2 px-1 py-3 text-base font-semibold transition ${
                sekme === k
                  ? "border-marka text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              {etiket}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {sekme === "dersler" ? (
            <ReservationsList />
          ) : sekme === "takvim" ? (
            <OgrenciTakvimi />
          ) : (
            <OgretmenlerimListesi />
          )}
        </div>
      </div>
    </DashboardShell>
  );
}

type Satir =
  | { tur: "ders"; item: ReservationItem; ham: BookingOut }
  | { tur: "deneme"; item: ReservationItem; ham: RegistrationOut }
  | { tur: "calisma"; item: ReservationItem; ham: StudyReservationOut };

//: "Artık yaşamayan" kayıtlar — varsayılan görünümün dışında.
const GECMIS = new Set(["IPTAL", "IADE_EDILDI", "SURESI_DOLDU", "TAMAMLANDI", "REDDEDILDI"]);

/**
 * Test edilebilirlik için ayrı: kabuk (başlık/nav) olmadan yalnız liste.
 *
 * `turler` varsayılanı YALNIZ derstir (kullanıcı kararı, 22 Eyl 2026): deneme
 * sınavı ve çalışma alanı rezervasyonları ekranda şimdilik gösterilmiyor,
 * ikisinin ürün kararı beklemede. Kod ve satır bileşenleri duruyor; kütüphane
 * yüzeyini ölçen nöbetçi (`libraryReservationsPaymentGate.test.tsx`) üç türü
 * birlikte geçirerek eski davranışı korur.
 */
export function ReservationsList({
  turler = ["ders"],
}: {
  turler?: ("ders" | "deneme" | "calisma")[];
} = {}) {
  const denemeAcik = turler.includes("deneme");
  const calismaAcik = turler.includes("calisma");
  const { data: dersler, isLoading: dersYukleniyor } = useBookings({ limit: 100 });
  const { data: kayitlar, isLoading: kayitYukleniyor } = useMyRegistrations(denemeAcik);
  const { data: calismalar, isLoading: calismaYukleniyor } =
    useMyStudyReservations(calismaAcik);
  const derseKatil = useDerseKatil();
  const { data: availability } = usePaymentAvailability();
  const [gecmisAcik, setGecmisAcik] = useState(false);

  const yukleniyor = dersYukleniyor || kayitYukleniyor || calismaYukleniyor;

  const tumu = useMemo<Satir[]>(() => {
    const liste: Satir[] = [
      ...(turler.includes("ders") ? dersler ?? [] : []).map((b) => ({
        tur: "ders" as const,
        item: toReservationItem(b),
        ham: b,
      })),
      ...(denemeAcik ? kayitlar ?? [] : []).map((r) => ({
        tur: "deneme" as const,
        item: toReservationItem(r),
        ham: r,
      })),
      ...(calismaAcik ? calismalar ?? [] : []).map((r) => ({
        tur: "calisma" as const,
        item: toReservationItem(r),
        ham: r,
      })),
    ];
    // En yakın randevu en üstte.
    return liste.sort((a, b) => {
      const at = a.item.baslangic ? new Date(a.item.baslangic).getTime() : 0;
      const bt = b.item.baslangic ? new Date(b.item.baslangic).getTime() : 0;
      return at - bt;
    });
  }, [dersler, kayitlar, calismalar, turler, denemeAcik, calismaAcik]);

  const yaklasan = tumu.filter((s) => !GECMIS.has(s.item.durum));
  const gecmis = tumu.filter((s) => GECMIS.has(s.item.durum));

  // Uyarı şeritleri yalnız GERÇEKTEN ödeme bekleyen kayıt varsa çıkar; aksi
  // hâlde ilgisiz bir uyarı olurdu.
  const dersOdemesiBekliyor = yaklasan.some(
    (s) =>
      s.tur === "ders" &&
      s.ham.status === BookingStatus.ACCEPTED &&
      s.ham.payment?.status === PaymentStatus.PENDING,
  );
  const kutuphaneOdemesiBekliyor = yaklasan.some(
    (s) => s.tur !== "ders" && s.item.durum === "BEKLIYOR",
  );
  const dersKoluAcik = isBranchOpen(availability, "tutor_marketplace");

  if (yukleniyor) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (tumu.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
        <p className={ETIKET}>Henüz dersin yok</p>
        <p className={`mt-1 ${ACIKLAMA}`}>
          Bir öğretmen seç, ilk dersini planla.
        </p>
        <Link
          to={ROUTES.tutors}
          className={`mt-6 ${DUGME_BIRINCIL}`}
        >
          Öğretmenleri keşfet
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Sebep bir kez, liste başında: satırlarda yalnız nötr bir durum metni
          var (renk = istisna disiplini). */}
      {!dersKoluAcik && dersOdemesiBekliyor && (
        <PaymentBranchNotice branch="tutor_marketplace" id={PAY_CLOSED_NOTICE_ID} />
      )}

      {yaklasan.length > 0 && (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {yaklasan.map((s) => (
            <li key={`${s.tur}-${s.item.id}`}>
              <SatirIcerigi satir={s} derseKatil={derseKatil} />
            </li>
          ))}
        </ul>
      )}

      {(dersOdemesiBekliyor || kutuphaneOdemesiBekliyor) && (
        <PaymentConsentNote className="pt-1" />
      )}

      {gecmis.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setGecmisAcik((v) => !v)}
            className={METIN_BAGLANTI}
          >
            {gecmisAcik ? "Geçmişi gizle" : `Geçmiş (${gecmis.length})`}
          </button>
          {gecmisAcik && (
            <ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {gecmis.map((s) => (
                <li key={`${s.tur}-${s.item.id}`}>
                  <SatirIcerigi satir={s} derseKatil={derseKatil} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Tür kendi satırını çizer; ortak iskelet `ReservationRow`'dan gelir. */
function SatirIcerigi({
  satir,
  derseKatil,
}: {
  satir: Satir;
  derseKatil: (bk: BookingOut) => void;
}) {
  if (satir.tur === "ders") {
    return (
      <BookingRow
        booking={satir.ham}
        onJoinMeeting={derseKatil}
      />
    );
  }
  return <LibraryReservationRow item={satir.item} kaynak={satir.tur} />;
}

/**
 * "Öğretmenlerim" — öğrencinin ders aldığı (deneme dersi dahil) öğretmenler.
 *
 * Preply'daki karşılığında abonelik ve kalan ders kredisi de var; ikisi bizde
 * yok, o yüzden satır yalnız gerçek verimizi gösterir: tamamlanan ders sayısı,
 * son/sonraki ders ve saatlik ücret.
 */
function OgretmenlerimListesi() {
  const { data: ogretmenler, isLoading, isError, refetch } = useMyTutors();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center">
        <p className={ACIKLAMA}>Liste yüklenemedi.</p>
        <button type="button" onClick={() => void refetch()} className={`mt-4 ${METIN_BAGLANTI}`}>
          Yeniden dene
        </button>
      </div>
    );
  }

  if (!ogretmenler?.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
        <p className={ETIKET}>Henüz ders almadın</p>
        <p className={`mt-1 ${ACIKLAMA}`}>
          Ders aldığın öğretmenler burada listelenir.
        </p>
        <Link to={ROUTES.tutors} className={`mt-6 ${DUGME_BIRINCIL}`}>
          Öğretmenleri keşfet
        </Link>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {ogretmenler.map((o) => {
        const ad = o.full_name || ADSIZ_UYE;
        return (
          <li key={o.tutor_id} className="relative flex items-center gap-3 px-4 py-4 transition hover:bg-slate-50">
            <Avatar name={ad} avatar_url={o.avatar_url} size="md" />
            <div className="min-w-0 flex-1">
              <Link
                to={ROUTES.tutor(o.tutor_id)}
                className={`block truncate ${ETIKET} after:absolute after:inset-0`}
              >
                {ad}
              </Link>
              <p className={`mt-0.5 ${KUCUK_ACIKLAMA}`}>
                {o.trial_only
                  ? "Deneme dersi"
                  : `${o.completed_lesson_count} ders`}
                {o.next_lesson_at
                  ? ` · Sıradaki: ${formatDate(o.next_lesson_at)}`
                  : o.last_lesson_at
                    ? ` · Son: ${formatDate(o.last_lesson_at)}`
                    : ""}
              </p>
            </div>
            {o.hourly_rate && (
              <span className={`relative z-10 shrink-0 ${KUCUK_ACIKLAMA}`}>
                {formatTRY(o.hourly_rate)} / ders
              </span>
            )}
            <Link
              to={ROUTES.messageWith(o.tutor_id, ad, "TUTOR")}
              className={`relative z-10 shrink-0 ${DUGME_SATIR_IKINCIL}`}
            >
              Mesaj
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
