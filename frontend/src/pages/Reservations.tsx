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
import { Link } from "react-router-dom";

import { DashboardShell } from "@/components/DashboardShell";
import { PaymentConsentNote } from "@/components/LegalConsent";
import { PaymentBranchNotice } from "@/components/PaymentBranchNotice";
import { LibraryReservationRow } from "@/components/reservation/LibraryReservationRow";
import { useBookings } from "@/hooks/useBookings";
import { useCheckoutResultToast } from "@/hooks/useCheckoutResult";
import { useMyRegistrations } from "@/hooks/useLibraryExams";
import { useMyStudyReservations } from "@/hooks/useStudy";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { isBranchOpen } from "@/lib/paymentAvailability";
import { UYE_NAV } from "@/lib/nav";
import { toReservationItem } from "@/lib/reservationModel";
import { ROUTES } from "@/lib/routes";
import { useMeetingStore } from "@/store/meetingStore";
import { BookingStatus, PaymentStatus } from "@/types";
import { BookingRow, PAY_CLOSED_NOTICE_ID } from "@/components/reservation/LessonRow";
import type { ReservationItem } from "@/lib/reservationModel";
import type { BookingOut, RegistrationOut, StudyReservationOut } from "@/types";
import { ADSIZ_UYE } from "@/lib/roles";

export default function Reservations() {
  useCheckoutResultToast(); // iyzico dönüşü: ?odeme=basarili|basarisiz

  return (
    <DashboardShell title="Rezervasyonlar" navItems={UYE_NAV}>
      <div className="mx-auto max-w-3xl px-1 pb-16 pt-2 sm:px-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Rezervasyonlar
        </h1>
        <p className="mt-1 text-sm text-slate-500 ">
          Derslerin, deneme sınavların ve çalışma alanı rezervasyonların.
        </p>
        <div className="mt-6">
          <ReservationsList />
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

/** Test edilebilirlik için ayrı: kabuk (başlık/nav) olmadan yalnız liste. */
export function ReservationsList() {
  const { data: dersler, isLoading: dersYukleniyor } = useBookings({ limit: 100 });
  const { data: kayitlar, isLoading: kayitYukleniyor } = useMyRegistrations();
  const { data: calismalar, isLoading: calismaYukleniyor } = useMyStudyReservations();
  const { joinMeeting } = useMeetingStore();
  const { data: availability } = usePaymentAvailability();
  const [gecmisAcik, setGecmisAcik] = useState(false);

  const yukleniyor = dersYukleniyor || kayitYukleniyor || calismaYukleniyor;

  const tumu = useMemo<Satir[]>(() => {
    const liste: Satir[] = [
      ...(dersler ?? []).map((b) => ({ tur: "ders" as const, item: toReservationItem(b), ham: b })),
      ...(kayitlar ?? []).map((r) => ({ tur: "deneme" as const, item: toReservationItem(r), ham: r })),
      ...(calismalar ?? []).map((r) => ({ tur: "calisma" as const, item: toReservationItem(r), ham: r })),
    ];
    // En yakın randevu en üstte.
    return liste.sort((a, b) => {
      const at = a.item.baslangic ? new Date(a.item.baslangic).getTime() : 0;
      const bt = b.item.baslangic ? new Date(b.item.baslangic).getTime() : 0;
      return at - bt;
    });
  }, [dersler, kayitlar, calismalar]);

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
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    );
  }

  if (tumu.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-16 text-center">
        <p className="text-sm font-medium text-slate-700">Henüz rezervasyonun yok</p>
        <p className="mt-1 text-sm text-slate-500">
          Bir eğitmenle ders planlayabilir ya da kütüphaneden çalışma alanı ayırtabilirsin.
        </p>
        <Link
          to={ROUTES.tutors}
          className="mt-4 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Eğitmenleri keşfet
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
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {yaklasan.map((s) => (
            <li key={`${s.tur}-${s.item.id}`}>
              <SatirIcerigi satir={s} joinMeeting={joinMeeting} />
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
            className="text-sm font-medium text-slate-500 transition hover:text-slate-800"
          >
            {gecmisAcik ? "Geçmişi gizle" : `Geçmiş (${gecmis.length})`}
          </button>
          {gecmisAcik && (
            <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {gecmis.map((s) => (
                <li key={`${s.tur}-${s.item.id}`}>
                  <SatirIcerigi satir={s} joinMeeting={joinMeeting} />
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
  joinMeeting,
}: {
  satir: Satir;
  joinMeeting: (id: number, room: string, a: string, b: string) => void;
}) {
  if (satir.tur === "ders") {
    return (
      <BookingRow
        booking={satir.ham}
        onJoinMeeting={(bk) =>
          joinMeeting(
            bk.id,
            bk.meeting_room!,
            bk.tutor_name || "Eğitmen",
            bk.client_name || ADSIZ_UYE,
          )
        }
      />
    );
  }
  return <LibraryReservationRow item={satir.item} kaynak={satir.tur} />;
}
