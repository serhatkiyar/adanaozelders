import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { ProfileCompleteness } from "@/components/ProfileCompleteness";
import { ErrorState } from "@/components/admin/ui/PageState";
import { AcilSerit } from "@/components/pano/AcilSerit";
import { DersKarti } from "@/components/pano/DersKarti";
import { GorunurlukBandi } from "@/components/pano/GorunurlukBandi";
import { SiradakiDersKarti } from "@/components/pano/SiradakiDersKarti";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_BIRINCIL,
  METIN_BAGLANTI,
  SAYFA_BASLIGI,
} from "@/components/pano/stil";
import { Modal } from "@/components/ui/Modal";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMessagesUnreadCount } from "@/hooks/useMessages";
import { useTutorDashboard } from "@/hooks/useTutorDashboard";
import { useMyTutorProfile } from "@/hooks/useTutorProfile";
import { getErrorMessage } from "@/lib/errors";
import { TUTOR_NAV } from "@/lib/nav";
import { panoAltSatir, selamlama } from "@/lib/pano";
import { ADSIZ_UYE } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { useMeetingStore } from "@/store/meetingStore";
import type { BookingOut, TutorDashboardOut as Pano } from "@/types";

/*
 * Genel Bakış — Preply öğretmen ana sayfası düzeni (araştırma: masaüstü
 * `preply-arastirma/BULGULAR.md` 4o, 23 Eyl 2026). Sıra:
 *   selamlama → ilan uyarıları → acil şeritler (yalnız iş varken) →
 *   TEK odak kartı (sıradaki ders ya da bir sonraki adım) → sıradaki
 *   dersler (yalnız ders varken).
 * Kaldırılanlar (kullanıcı kararı, 23 Eyl 2026): "Yanıt bekleyen istekler"
 * bölümü (istekler artık şeritten açılan pencerede), özet kartları
 * (`OzetKartlari` dosyası duruyor; geri açmak için buraya eklemek yeter) ve
 * "Tüm derslerim" (dersler takvimden ve ders sayfasından yönetilir).
 */

const ISTEKLER_CAPASI = "#bekleyen-istekler";

/** Ders yokken odak kartı: bir "yok" mesajı değil, bir sonraki adım. */
function BosOdakKarti({
  baslik,
  metin,
  gri = false,
  eylem,
}: {
  baslik: string;
  metin?: string;
  gri?: boolean;
  eylem: React.ReactNode;
}) {
  return (
    <section className="flex items-center justify-between gap-6 overflow-hidden rounded-lg bg-slate-100 px-6 py-6 sm:px-8">
      <div className="min-w-0 space-y-4">
        <div>
          <h2
            className={`text-xl font-semibold leading-7 ${gri ? "text-slate-500" : "text-slate-900"}`}
          >
            {baslik}
          </h2>
          {metin && <p className={`mt-1 ${ACIKLAMA}`}>{metin}</p>}
        </div>
        {eylem}
      </div>
      <img
        src="/icons/ayakta-kisi.png"
        alt=""
        aria-hidden
        className="hidden h-28 w-28 shrink-0 sm:block"
      />
    </section>
  );
}

function OdakKarti({
  pano,
  onJoinMeeting,
  istekleriAc,
}: {
  pano: Pano;
  onJoinMeeting: (b: BookingOut) => void;
  istekleriAc: () => void;
}) {
  if (pano.next_lesson) {
    return (
      <SiradakiDersKarti
        lesson={pano.next_lesson}
        onJoinMeeting={onJoinMeeting}
      />
    );
  }
  if (pano.pending_count > 0) {
    return (
      <BosOdakKarti
        baslik="Önce ders isteklerine bak"
        metin="Öğrenciler senden yanıt bekliyor; kabul ettiğin ders burada görünür."
        eylem={
          <button type="button" onClick={istekleriAc} className={DUGME_BIRINCIL}>
            İstekleri gör
          </button>
        }
      />
    );
  }
  if (pano.completed_total === 0) {
    return (
      <BosOdakKarti
        baslik="Aramıza hoş geldin"
        metin="Profilini ve müsaitliğini güncel tut; ilk ders isteği buraya düşer."
        eylem={
          <Link to={ROUTES.tutorListing} className={DUGME_BIRINCIL}>
            Profilime git
          </Link>
        }
      />
    );
  }
  return (
    <BosOdakKarti
      baslik="Sıradaki dersin yok"
      gri
      eylem={
        <Link to={ROUTES.tutorCalendar} className={DUGME_BIRINCIL}>
          Takvimi aç
        </Link>
      }
    />
  );
}

export default function TutorDashboard() {
  const { data: user } = useCurrentUser();
  const { data: pano, isLoading, isError, error, refetch } = useTutorDashboard();
  const { data: ilan } = useMyTutorProfile();
  const { data: unread } = useMessagesUnreadCount();
  const { joinMeeting } = useMeetingStore();
  const location = useLocation();

  // Eski bağlantılar (`/genel-bakis#bekleyen-istekler`) istekler penceresini açar.
  const [isteklerAcik, setIsteklerAcik] = useState(location.hash === ISTEKLER_CAPASI);
  useEffect(() => {
    if (location.hash === ISTEKLER_CAPASI) setIsteklerAcik(true);
  }, [location.hash]);

  const derseKatil = (bk: BookingOut) =>
    joinMeeting(bk.id, bk.meeting_room!, bk.tutor_name || "Öğretmen", bk.client_name || ADSIZ_UYE);

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
  const fazlaIstek = pano ? pano.pending_count - pano.pending.length : 0;

  return (
    // Tek sütun, dar (Preply ana sayfası da ortada tek dar sütun).
    <DashboardShell title="Genel Bakış" navItems={TUTOR_NAV} genislik="dar">
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
          </div>
        ) : isError || !pano ? (
          <ErrorState
            description={getErrorMessage(error, "Pano yüklenemedi.")}
            onRetry={() => void refetch()}
          />
        ) : (
          <>
            <GorunurlukBandi issues={pano.visibility_issues} />
            {/* Müsaitlik ve belge ilan yayına girdikten SONRA burada
                tamamlanıyor; ilan zaten gizliyse önce o nedenler çözülür. */}
            {ilan && !gizleyenVar && <ProfileCompleteness tutor={ilan} />}

            {(pano.pending_count > 0 || (unread?.inbox ?? 0) > 0) && (
              <div className="space-y-2">
                <AcilSerit
                  count={pano.pending_count}
                  metin="ders isteğin yanıt bekliyor"
                  ikon="/icons/el-kaldiran.svg"
                  onClick={() => setIsteklerAcik(true)}
                />
                <AcilSerit
                  count={unread?.inbox ?? 0}
                  metin="okunmamış mesajın var"
                  to={ROUTES.messages}
                />
              </div>
            )}

            <OdakKarti
              pano={pano}
              onJoinMeeting={derseKatil}
              istekleriAc={() => setIsteklerAcik(true)}
            />

            {/* Önümüzdeki 3 günün dersleri; ders yoksa bölüm hiç çizilmez. */}
            {pano.upcoming.length > 0 && (
              <section>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className={BOLUM_BASLIGI}>Yaklaşan dersler</h2>
                  <Link to={ROUTES.tutorCalendar} className={METIN_BAGLANTI}>
                    {pano.upcoming_count > pano.upcoming.length
                      ? `Tümünü gör (${pano.upcoming_count})`
                      : "Tümünü gör"}
                  </Link>
                </div>
                <div className="space-y-3">
                  {pano.upcoming.map((b) => (
                    <DersKarti key={b.id} booking={b} onJoinMeeting={derseKatil} />
                  ))}
                </div>
              </section>
            )}

            <Modal
              open={isteklerAcik}
              onClose={() => setIsteklerAcik(false)}
              title="Yanıt bekleyen ders istekleri"
              maxWidth="max-w-2xl"
            >
              <div className="mt-5 space-y-3">
                {pano.pending.length > 0 ? (
                  pano.pending.map((b) => (
                    <DersKarti key={b.id} booking={b} onJoinMeeting={derseKatil} />
                  ))
                ) : (
                  <p className={`py-6 text-center ${ACIKLAMA}`}>
                    Yanıt bekleyen isteğin kalmadı.
                  </p>
                )}
                {fazlaIstek > 0 && (
                  <p className={`text-center ${ACIKLAMA}`}>+{fazlaIstek} istek daha</p>
                )}
              </div>
            </Modal>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
