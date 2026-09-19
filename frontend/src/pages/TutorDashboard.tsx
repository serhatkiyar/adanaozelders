import { useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { ProfileCompleteness } from "@/components/ProfileCompleteness";
import { ErrorState } from "@/components/admin/ui/PageState";
import { AcilSerit } from "@/components/pano/AcilSerit";
import { DersKarti } from "@/components/pano/DersKarti";
import { GorunurlukBandi } from "@/components/pano/GorunurlukBandi";
import { OzetKartlari } from "@/components/pano/OzetKartlari";
import { SiradakiDersKarti } from "@/components/pano/SiradakiDersKarti";
import { ACIKLAMA, BOLUM_BASLIGI, METIN_BAGLANTI, SAYFA_BASLIGI } from "@/components/pano/stil";
import { useBookings } from "@/hooks/useBookings";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { useMessagesUnreadCount } from "@/hooks/useMessages";
import { useEarnings } from "@/hooks/usePayments";
import { useTutorDashboard } from "@/hooks/useTutorDashboard";
import { useMyTutorProfile } from "@/hooks/useTutorProfile";
import { getErrorMessage } from "@/lib/errors";
import { TUTOR_NAV } from "@/lib/nav";
import { panoAltSatir, selamlama } from "@/lib/pano";
import { canPromiseEscrow } from "@/lib/paymentAvailability";
import { ADSIZ_UYE } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { useMeetingStore } from "@/store/meetingStore";
import type { BookingOut } from "@/types";

function Bolum({
  id,
  baslik,
  sag,
  children,
}: {
  id?: string;
  baslik: string;
  sag?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className={BOLUM_BASLIGI}>{baslik}</h2>
        {sag}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/**
 * Tüm dersler (geçmiş dahil) kapalı başlar; pano "şimdi ne yapmalıyım" sorusuna
 * odaklanır ama eski panodaki tam liste ve satır aksiyonları kaybolmaz.
 */
function TumDersler({ onJoinMeeting }: { onJoinMeeting: (b: BookingOut) => void }) {
  const [acik, setAcik] = useState(false);
  const { data, isLoading, isError, error } = useBookings({ limit: 100 }, { enabled: acik });

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={acik}
        onClick={() => setAcik((v) => !v)}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-6 py-4 text-left"
      >
        <span className={BOLUM_BASLIGI}>Tüm derslerim</span>
        <span aria-hidden className="text-2xl leading-none text-slate-500">
          {acik ? "−" : "+"}
        </span>
      </button>
      {acik && (
        <div className="space-y-3 border-t border-slate-200 p-4 sm:p-6">
          {isLoading ? (
            <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
          ) : isError ? (
            <p role="alert" className="text-base text-red-700">
              {getErrorMessage(error, "Dersler yüklenemedi.")}
            </p>
          ) : (data ?? []).length === 0 ? (
            <p className={`py-4 text-center ${ACIKLAMA}`}>Henüz dersin yok.</p>
          ) : (
            (data ?? []).map((b) => (
              <DersKarti key={b.id} booking={b} onJoinMeeting={onJoinMeeting} />
            ))
          )}
        </div>
      )}
    </section>
  );
}

export default function TutorDashboard() {
  const { data: user } = useCurrentUser();
  const { data: pano, isLoading, isError, error, refetch } = useTutorDashboard();
  const { data: earnings } = useEarnings();
  const { data: ilan } = useMyTutorProfile();
  const { data: unread } = useMessagesUnreadCount();
  const { data: paymentAvailability } = usePaymentAvailability();
  const escrowWording = canPromiseEscrow(paymentAvailability, "tutor_marketplace");
  const { joinMeeting } = useMeetingStore();

  const derseKatil = (bk: BookingOut) =>
    joinMeeting(bk.id, bk.meeting_room!, bk.tutor_name || "Eğitmen", bk.client_name || ADSIZ_UYE);

  const now = new Date();
  const ad = (user as { first_name?: string } | undefined)?.first_name;
  const altSatir = pano
    ? panoAltSatir({
        nextLessonStart: pano.next_lesson?.start_at ?? null,
        completedTotal: pano.completed_total,
        now,
      })
    : null;
  const gizleyenVar = pano?.visibility_issues.some((i) => i.severity === "hidden") ?? false;

  return (
    <DashboardShell title="Pano" navItems={TUTOR_NAV} genislik="genis">
      <div className="space-y-8 pb-16 pt-2">
        <header>
          <h1 className={SAYFA_BASLIGI}>
            {selamlama(now)}
            {ad ? `, ${ad}` : ""}
          </h1>
          {altSatir && <p className={`mt-2 ${ACIKLAMA}`}>{altSatir}</p>}
        </header>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          </div>
        ) : isError || !pano ? (
          <ErrorState
            description={getErrorMessage(error, "Pano yüklenemedi.")}
            onRetry={() => void refetch()}
          />
        ) : (
          <>
            {/* Geniş ekranda iki sütun (17 Eyl 2026): kartlar 1600px'e yayılıp
                okunmaz hale gelmesin; sağ sütun özet ve durum bilgisi taşır. */}
            <GorunurlukBandi issues={pano.visibility_issues} />
            {/* Müsaitlik ve belge ilan yayına girdikten SONRA burada
                tamamlanıyor; ilan zaten gizliyse önce o nedenler çözülür. */}
            {ilan && !gizleyenVar && <ProfileCompleteness tutor={ilan} />}

            <div className="space-y-2">
              <AcilSerit
                count={pano.pending_count}
                metin="ders isteği yanıtını bekliyor"
                to={`${ROUTES.bookings}#bekleyen-istekler`}
              />
              <AcilSerit
                count={unread?.inbox ?? 0}
                metin="okunmamış mesajın var"
                to={ROUTES.messages}
              />
            </div>

            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
              <div className="min-w-0 space-y-8">
            <SiradakiDersKarti
              lesson={pano.next_lesson}
              bosMetin={
                pano.completed_total === 0
                  ? "İlk ders isteği geldiğinde burada göreceksin."
                  : "Yeni bir ders kabul ettiğinde burada görünür."
              }
              onJoinMeeting={derseKatil}
            />

            <Bolum
              baslik="Önümüzdeki 3 gün"
              sag={
                pano.upcoming_count > pano.upcoming.length ? (
                  <Link
                    to={ROUTES.tutorCalendar}
                    className={METIN_BAGLANTI}
                  >
                    Tümünü gör ({pano.upcoming_count})
                  </Link>
                ) : undefined
              }
            >
              {pano.upcoming.length > 0 ? (
                pano.upcoming.map((b) => (
                  <DersKarti key={b.id} booking={b} onJoinMeeting={derseKatil} />
                ))
              ) : (
                <p className={`py-4 text-center ${ACIKLAMA}`}>
                  Önümüzdeki 3 günde planlanmış dersin yok.
                </p>
              )}
            </Bolum>

            <Bolum id="bekleyen-istekler" baslik="Yanıt bekleyen istekler">
              {pano.pending.length > 0 ? (
                pano.pending.map((b) => (
                  <DersKarti key={b.id} booking={b} onJoinMeeting={derseKatil} />
                ))
              ) : (
                <p className={`py-4 text-center ${ACIKLAMA}`}>Yanıt bekleyen isteğin yok.</p>
              )}
            </Bolum>

            <TumDersler onJoinMeeting={derseKatil} />
              </div>

              <div className="min-w-0 space-y-8">
                <OzetKartlari
                  earnings={earnings}
                  completedThisMonth={pano.completed_this_month}
                  escrowWording={escrowWording}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
