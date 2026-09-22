// Öğrenci panosu (Modül 4, 18 Eyl 2026) — `/pano`, öğrenci rolünde.
//
// Yapı `TutorDashboard` ile paralel: tek ana kart "şimdi ne yapmalıyım"
// sorusunu yanıtlar, altında sıradaki dersler durur. Hangi kartın çizileceği
// ve bütün sayılar SUNUCUDA hesaplanır (`GET /clients/me/dashboard`); istemci
// ders listesi çekip sayım yapmaz.
//
// Pano yalnız DERSLERİ gösterir. Deneme sınavı ve çalışma alanı kayıtları
// "Rezervasyonlar" sekmesinde (`ROUTES.reservations`) kalır.
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { PaymentConsentNote } from "@/components/LegalConsent";
import { PaymentBranchNotice } from "@/components/PaymentBranchNotice";
import { ErrorState } from "@/components/admin/ui/PageState";
import { AcilSerit } from "@/components/pano/AcilSerit";
import { KesifKarti } from "@/components/pano/KesifKarti";
import { SiradakiEylemKarti } from "@/components/pano/SiradakiEylemKarti";
import {
  BOLUM_BASLIGI,
  KART,
  KUCUK_ACIKLAMA,
  METIN_BAGLANTI,
  SAYFA_BASLIGI,
} from "@/components/pano/stil";
import { BookingRow, PAY_CLOSED_NOTICE_ID } from "@/components/reservation/LessonRow";
import { useClientDashboard } from "@/hooks/useClientDashboard";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { useMessagesUnreadCount } from "@/hooks/useMessages";
import { getErrorMessage } from "@/lib/errors";
import { UYE_NAV } from "@/lib/nav";
import { selamlama } from "@/lib/pano";
import { isBranchOpen } from "@/lib/paymentAvailability";
import { ADSIZ_UYE } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { useMeetingStore } from "@/store/meetingStore";
import { BookingStatus, PaymentStatus, type BookingOut } from "@/types";

/** Ödeme bekleyen ders: kabul edilmiş, ödemesi alınmamış ya da başarısız. */
const odemeBekliyor = (b: BookingOut) =>
  b.status === BookingStatus.ACCEPTED &&
  (b.payment?.status === PaymentStatus.PENDING || b.payment?.status === PaymentStatus.FAILED);

export default function OgrenciPano() {
  const { data: user } = useCurrentUser();
  const { data: pano, isLoading, isError, error, refetch } = useClientDashboard();
  const { data: unread } = useMessagesUnreadCount();
  const { data: availability } = usePaymentAvailability();
  const { joinMeeting } = useMeetingStore();

  const derseKatil = (bk: BookingOut) =>
    joinMeeting(bk.id, bk.meeting_room!, bk.tutor_name || "Öğretmen", bk.client_name || ADSIZ_UYE);

  const ad = (user as { first_name?: string } | undefined)?.first_name;
  const kind = pano?.next_action?.kind ?? null;
  // Ana kartta zaten gösterilen ders şeritte ikinci kez sayılmaz.
  const dus = (k: string) => (kind === k ? 1 : 0);
  const okunmamis = unread?.inbox ?? 0;
  // `upcoming_count` ana karttaki dersi hariç tutar; bu dört türde o ders de
  // yaklaşan bir derstir (bekleyen teklif ya da kabul edilmiş, bitmemiş).
  const anaKartYaklasan =
    kind === "JOIN_LESSON" || kind === "NEXT_LESSON" || kind === "PAY" || kind === "RESPOND_OFFER";

  const odemeVar =
    kind === "PAY" || (pano?.upcoming.some(odemeBekliyor) ?? false);
  const odemeKapali =
    !isBranchOpen(availability, "tutor_marketplace") && (pano?.payment_due_count ?? 0) > 0;

  return (
    <DashboardShell title="Genel Bakış" navItems={UYE_NAV} genislik="orta">
      <div className="space-y-8 pb-16 pt-2">
        <header>
          <h1 className={SAYFA_BASLIGI}>
            {selamlama(new Date())}
            {ad ? `, ${ad}` : ""}
          </h1>
        </header>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-56 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
          </div>
        ) : isError || !pano ? (
          <ErrorState
            description={getErrorMessage(error, "Pano yüklenemedi.")}
            onRetry={() => void refetch()}
          />
        ) : !pano.has_bookings ? (
          <div className="space-y-3">
            <AcilSerit count={okunmamis} metin="okunmamış mesajın var" to={ROUTES.messages} />
            <KesifKarti ucretsizIlkDersSayisi={pano.free_first_lesson_tutor_count} />
          </div>
        ) : (
          <>
            {/* Sebep bir kez, sayfa başında; kart içinde yalnız pasif düğme. */}
            {odemeKapali && (
              <PaymentBranchNotice branch="tutor_marketplace" id={PAY_CLOSED_NOTICE_ID} />
            )}

            {/* Geniş ekranda iki sütun: solda ana kart ve sıradaki dersler,
                sağda yapılacaklar ve özet. Telefonda yapılacaklar üstte. */}
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
              <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-start-1">
                <AcilSerit
                  count={pano.offer_count - dus("RESPOND_OFFER")}
                  metin="ders teklifi yanıtını bekliyor"
                  to={ROUTES.reservations}
                />
                <AcilSerit
                  count={pano.payment_due_count - dus("PAY")}
                  metin="ders ödeme bekliyor"
                  to={ROUTES.reservations}
                />
                <AcilSerit
                  count={pano.confirm_count - dus("CONFIRM_LESSON")}
                  metin="ders onayını bekliyor"
                  to={ROUTES.reservations}
                />
                <AcilSerit count={okunmamis} metin="okunmamış mesajın var" to={ROUTES.messages} />
                <section aria-label="Ders özeti" className={`hidden lg:block ${KART}`}>
                  <dl className="grid grid-cols-2 gap-4">
                    <div>
                      <dt className={KUCUK_ACIKLAMA}>Planlanan</dt>
                      <dd className="mt-1 text-2xl font-bold leading-8 text-slate-900">
                        {pano.upcoming_count + (anaKartYaklasan ? 1 : 0)}
                      </dd>
                    </div>
                    <div>
                      <dt className={KUCUK_ACIKLAMA}>Tamamlanan</dt>
                      <dd className="mt-1 text-2xl font-bold leading-8 text-slate-900">
                        {pano.completed_total}
                      </dd>
                    </div>
                  </dl>
                  <Link to={ROUTES.reservations} className={`mt-4 inline-block ${METIN_BAGLANTI}`}>
                    Rezervasyonlarına git
                  </Link>
                </section>
              </div>

              <div className="min-w-0 space-y-8 lg:col-start-1 lg:row-start-1">
                <SiradakiEylemKarti
                  action={pano.next_action}
                  bekleyenVar={pano.upcoming.length > 0}
                  onJoinMeeting={derseKatil}
                />

                {pano.upcoming.length > 0 && (
                  <section>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h2 className={BOLUM_BASLIGI}>Sıradaki dersler</h2>
                      {pano.upcoming_count > pano.upcoming.length && (
                        <Link to={ROUTES.reservations} className={METIN_BAGLANTI}>
                          Tümünü gör ({pano.upcoming_count})
                        </Link>
                      )}
                    </div>
                    <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
                      {pano.upcoming.map((b) => (
                        <li key={b.id}>
                          <BookingRow booking={b} onJoinMeeting={derseKatil} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {odemeVar && <PaymentConsentNote />}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
