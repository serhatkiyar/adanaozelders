import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { Avatar } from "@/components/Avatar";
import { FullScreenSpinner } from "@/components/Spinner";
import { CancelModal } from "@/components/CancelModal";
import { RescheduleModal } from "@/components/RescheduleModal";
import { ReviewModal } from "@/components/ReviewModal";
import { DersOnayKarti } from "@/components/booking/DersOnayKarti";
import { OgretmenErtelemeModal } from "@/components/booking/OgretmenErtelemeModal";
import { Modal } from "@/components/ui/Modal";
import {
  ACIKLAMA,
  DUGME_BIRINCIL,
  DUGME_IKINCIL,
  ETIKET,
  KART,
  KUCUK_ACIKLAMA,
  METIN_BAGLANTI,
  SAYFA_BASLIGI,
} from "@/components/pano/stil";
import { useSeri, useSeriBitir, useTeklifiGeriCek } from "@/hooks/useDersTeklifi";
import {
  useAcceptTutorReschedule,
  useBooking,
  useBookingAction,
  useDeclineTutorReschedule,
  useRemindConfirm,
} from "@/hooks/useBookings";
import { useReviewByBooking } from "@/hooks/useReviews";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDateTime, formatRange } from "@/lib/datetime";
import { formatTRY, parseMoney } from "@/lib/money";
import { isLessonJoinable, mapsUrl } from "@/lib/lesson";
import { useDerseKatil } from "@/hooks/useDerseKatil";
import { getErrorDetail, getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "@/lib/bookingStatus";
import { BookingStatus, ROLE_IDS } from "@/types";
import { ADSIZ_UYE } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";

/*
 * Ders ayrıntıları — Preply'ın takvimdeki "ders bilgileri" penceresi gibi
 * sade (kullanıcı kararı, 23 Eyl 2026; araştırma `preply-arastirma`,
 * `tutorCalendarPage` → `LESSON_DETAILS_MODAL`): tek ders kartı + alt alta
 * tam genişlik düğmeler. Kaldırılanlar: soru-cevap, ders kaynakları, ders
 * mesajları, gizli notlar, görevler, buluşma yeri düzenleme, değerlendirme
 * kutusu, haftalık seri rozeti. Düğme olarak KALANLAR yalnız bu sayfada
 * yapılabilen işlerdir: değerlendirme yazma, öğrencinin ders onayı / sorun
 * bildirimi, kabul-ret, teklifi geri çekme, erteleme, seriyi bitirme.
 */

const TAM = "w-full";
const TEHLIKE =
  "inline-flex h-12 w-full items-center justify-center rounded-lg border-2 border-red-200 bg-white px-6 text-lg font-semibold text-red-700 transition hover:border-red-700 disabled:opacity-50";

function sureEtiketi(startIso: string, endIso: string): string {
  const dk = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
  if (dk < 60) return `${dk} dk`;
  const sa = Math.floor(dk / 60);
  const kalan = dk % 60;
  return kalan === 0 ? `${sa} saat` : `${sa} sa ${kalan} dk`;
}

export default function LessonDetail() {
  const { id } = useParams();
  const bookingId = Number(id);
  const navigate = useNavigate();

  const { data: user } = useCurrentUser();
  const role =
    user?.role_id === ROLE_IDS.TUTOR
      ? "TUTOR"
      : user?.role_id === ROLE_IDS.CLIENT
        ? "CLIENT"
        : null;
  const navItems = role === "TUTOR" ? TUTOR_NAV : UYE_NAV;

  const { data: booking, isLoading, isError } = useBooking(bookingId);
  const { data: review } = useReviewByBooking(bookingId);
  const derseKatil = useDerseKatil();

  const accept = useBookingAction("accept");
  const reject = useBookingAction("reject");
  const complete = useBookingAction("complete");
  const busy = accept.isPending || reject.isPending || complete.isPending;

  const [showCancel, setShowCancel] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [showTutorReschedule, setShowTutorReschedule] = useState(false);
  const [redOnayi, setRedOnayi] = useState(false);
  const yeniSaatiKabul = useAcceptTutorReschedule();
  const yeniSaatiReddet = useDeclineTutorReschedule();
  const hatirlat = useRemindConfirm();

  // Haftalık seri: rozet yok; "Seriyi bitir" seriyi durdurmanın tek yolu.
  const seri = useSeri(booking?.series_id);
  const seriBitir = useSeriBitir();
  const geriCek = useTeklifiGeriCek();
  const [seriBitirAcik, setSeriBitirAcik] = useState(false);

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !booking) {
    return (
      <DashboardShell title="Ders" navItems={navItems ?? undefined} genislik="dar">
        <button onClick={() => navigate(-1)} className={METIN_BAGLANTI}>
          ← Geri dön
        </button>
        <div className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-slate-300 py-16 text-center">
          <p className={ACIKLAMA}>Ders bulunamadı.</p>
        </div>
      </DashboardShell>
    );
  }

  const isClient = role === "CLIENT";
  const kisiAdi = isClient ? booking.tutor_name ?? "Öğretmen" : booking.client_name ?? ADSIZ_UYE;
  const kisiFoto = isClient ? booking.tutor_avatar_url : booking.client_avatar_url;
  const mesajYolu = isClient
    ? ROUTES.messageWith(booking.tutor_id, kisiAdi, "TUTOR")
    : ROUTES.messageWith(booking.client_id, kisiAdi, "CLIENT");
  const price = parseMoney(booking.price);
  const isRemote = booking.mode === "ONLINE";

  const isPending = booking.status === BookingStatus.PENDING;
  const isAccepted = booking.status === BookingStatus.ACCEPTED;
  const acik = isPending || isAccepted;
  const alreadyReviewed = !!review || reviewed;
  const katilabilir =
    isAccepted && isRemote && !!booking.meeting_room && isLessonJoinable(booking.start_at, booking.end_at);
  const canWithdraw =
    role === "TUTOR" && isPending && !!booking.offered_by_tutor && !booking.payment;
  const seriAktif = !!booking.series_id && seri.data?.status === "ACTIVE";
  // Bekleyen derste yanıtı veren taraf "Reddet" görür; ona ayrıca "İptal"
  // göstermek aynı işi iki düğmeye bölerdi.
  const yanitVeren =
    isPending &&
    ((role === "TUTOR" && !booking.offered_by_tutor) || (isClient && !!booking.offered_by_tutor));
  const tamamlandi = booking.status === BookingStatus.COMPLETED;
  const simdi = Date.now();
  const basladi = new Date(booking.start_at).getTime() <= simdi;
  const bitti = new Date(booking.end_at).getTime() < simdi;
  // Öğretmen dersi başka saate aldı, öğrencinin yanıtı bekleniyor.
  const saatDegisikligi = isAccepted && !!booking.tutor_rescheduled_from && !basladi;
  const odeme = booking.payment ?? null;

  const yeniSaatUygun = () =>
    yeniSaatiKabul.mutate(bookingId, {
      onSuccess: () => toast.success("Yeni saati onayladın."),
      onError: (err) => toast.error(getErrorDetail(err, "Onaylanamadı.")),
    });
  const yeniSaatUygunDegil = () =>
    yeniSaatiReddet.mutate(bookingId, {
      onSuccess: () => {
        setRedOnayi(false);
        toast.success("Ders iptal edildi; ücretin iade edilecek.");
      },
      onError: (err) => toast.error(getErrorDetail(err, "İptal edilemedi.")),
    });
  const onayHatirlat = () =>
    hatirlat.mutate(bookingId, {
      onSuccess: () => toast.success("Öğrencine onay hatırlatması gönderildi."),
      onError: (err) => toast.error(getErrorDetail(err, "Hatırlatma gönderilemedi.")),
    });

  const run = (action: typeof accept, okMsg: string) =>
    action.mutate(bookingId, {
      onSuccess: () => toast.success(okMsg),
      onError: (err) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
    });

  const teklifiGeriCek = () =>
    geriCek.mutate(bookingId, {
      onSuccess: () => toast.success("Teklifini geri çektin."),
      onError: (err) => toast.error(getErrorDetail(err, "Teklif geri çekilemedi.")),
    });

  const seriyiBitir = () => {
    if (!booking.series_id) return;
    seriBitir.mutate(booking.series_id, {
      onSuccess: () => {
        toast.success("Haftalık seri sona erdi.");
        setSeriBitirAcik(false);
      },
      onError: (err) => toast.error(getErrorDetail(err, "Seri bitirilemedi.")),
    });
  };

  const kisi = (
    <>
      <Avatar name={kisiAdi} avatar_url={kisiFoto} size="lg" />
      <div className="min-w-0">
        <p className={`truncate ${ETIKET}`}>{kisiAdi}</p>
        {isClient && <p className={KUCUK_ACIKLAMA}>Profili gör</p>}
      </div>
    </>
  );

  return (
    <DashboardShell title="Ders ayrıntıları" navItems={navItems ?? undefined} genislik="dar">
      <div className="pb-12">
        <button onClick={() => navigate(-1)} className={`${METIN_BAGLANTI} mb-6 inline-block`}>
          ← Geri dön
        </button>
        <h1 className={`${SAYFA_BASLIGI} mb-6`}>Ders ayrıntıları</h1>

        <section className={KART}>
          {/* ── Ders kartı ── */}
          <div className="flex items-start justify-between gap-4">
            {isClient ? (
              <Link
                to={`/student/tutors/${booking.tutor_id}`}
                className="flex min-w-0 items-center gap-3 transition hover:opacity-80"
              >
                {kisi}
              </Link>
            ) : (
              <div className="flex min-w-0 items-center gap-3">{kisi}</div>
            )}
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${BOOKING_STATUS_STYLE[booking.status]}`}
            >
              {BOOKING_STATUS_LABEL[booking.status]}
            </span>
          </div>

          <dl className="mt-6 space-y-3 border-t border-slate-200 pt-5">
            <div className="flex justify-between gap-4">
              <dt className={ACIKLAMA}>Tarih</dt>
              <dd className={`text-right ${ETIKET}`}>{formatRange(booking.start_at, booking.end_at)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className={ACIKLAMA}>Süre</dt>
              <dd className={ETIKET}>{sureEtiketi(booking.start_at, booking.end_at)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className={ACIKLAMA}>Ders şekli</dt>
              <dd className={ETIKET}>{isRemote ? "Online" : "Yüz yüze"}</dd>
            </div>
            {!isRemote && (
              <div className="flex justify-between gap-4">
                <dt className={ACIKLAMA}>Buluşma yeri</dt>
                <dd className="min-w-0 text-right">
                  {booking.location ? (
                    <a
                      href={mapsUrl(booking.location, booking.location_lat, booking.location_lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${METIN_BAGLANTI} break-words`}
                    >
                      {booking.location}
                    </a>
                  ) : (
                    <span className={ACIKLAMA}>Henüz belirlenmedi</span>
                  )}
                </dd>
              </div>
            )}
            {price !== null && (
              <div className="flex justify-between gap-4">
                <dt className={ACIKLAMA}>Ücret</dt>
                <dd className={ETIKET}>{formatTRY(booking.price)}</dd>
              </div>
            )}
          </dl>

          {booking.notes && (
            <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-base italic leading-6 text-slate-600">
              "{booking.notes}"
            </p>
          )}
          {(booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.REJECTED) &&
            booking.cancel_reason && (
              <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-base leading-6 text-slate-700">
                {booking.status === BookingStatus.CANCELLED ? "İptal nedeni: " : ""}
                {booking.cancel_reason}
              </p>
            )}

          {/* Geçmiş dersin durumu: öğrencide onay / sorun bildirimi, öğretmende
              ücretin ne zaman kazanca geçeceği. */}
          {isClient && (
            <div className="mt-5">
              <DersOnayKarti booking={booking} />
            </div>
          )}
          {/* Öğretmen: saati değiştirdiğin ders öğrencinin yanıtını bekliyor. */}
          {role === "TUTOR" && saatDegisikligi && (
            <p className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-base leading-6 text-amber-800">
              Dersi {formatDateTime(booking.tutor_rescheduled_from!)} yerine bu saate aldın;
              öğrencinin yanıtı bekleniyor.
            </p>
          )}

          {/* Öğrenci: öğretmen saati değiştirdi, uygun mu? */}
          {isClient && saatDegisikligi && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
              <p className={ETIKET}>Öğretmenin dersi başka bir saate aldı</p>
              <p className={`mt-1 ${ACIKLAMA}`}>
                Eski saat: {formatDateTime(booking.tutor_rescheduled_from!)}. Yeni saat sana
                uygun değilse dersi iptal edebilirsin; ücretin tamamı iade edilir.
              </p>
              {redOnayi ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={yeniSaatUygunDegil}
                    disabled={yeniSaatiReddet.isPending}
                    className={TEHLIKE}
                  >
                    {yeniSaatiReddet.isPending ? "İptal ediliyor…" : "Evet, dersi iptal et"}
                  </button>
                  <button onClick={() => setRedOnayi(false)} className={`${DUGME_IKINCIL} ${TAM}`}>
                    Vazgeç
                  </button>
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={yeniSaatUygun}
                    disabled={yeniSaatiKabul.isPending}
                    className={`${DUGME_BIRINCIL} ${TAM}`}
                  >
                    Yeni saat uygun
                  </button>
                  <button onClick={() => setRedOnayi(true)} className={`${DUGME_IKINCIL} ${TAM}`}>
                    Uygun değil
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Öğretmen: bitmiş dersin ücret durumu (Preply "durum kutusu"). */}
          {role === "TUTOR" && bitti && (isAccepted || tamamlandi) && (
            <div className="mt-5">
              {booking.is_free_lesson ? (
                tamamlandi && (
                  <p className="rounded-lg bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-800">
                    Ders tamamlandı (ücretsiz ilk ders)
                  </p>
                )
              ) : odeme?.status === "RELEASED" ? (
                <div className="flex items-center justify-between gap-4 rounded-lg bg-emerald-50 px-4 py-3">
                  <span className="text-base font-semibold text-emerald-800">
                    Onaylandı · bakiyene geçti
                  </span>
                  <span className="text-base font-semibold text-emerald-800">
                    {formatTRY(odeme.tutor_earning)}
                  </span>
                </div>
              ) : odeme?.status === "HELD" ? (
                <div className="rounded-lg bg-amber-50 px-4 py-3">
                  <p className="text-base font-semibold text-amber-800">
                    {booking.is_disputed ? "Öğrenci sorun bildirdi" : "Öğrencinin onayı bekleniyor"}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-amber-800">
                    {booking.is_disputed
                      ? "Ekibimiz inceliyor; karar çıkana kadar ücret bakiyene geçmez."
                      : "Öğrenci onaylayınca ya da ders bitiminden 72 saat sonra ücret bakiyene geçer."}
                  </p>
                </div>
              ) : odeme?.status === "REFUNDED" || odeme?.status === "REFUNDING" ? (
                <p className="rounded-lg bg-slate-50 px-4 py-3 text-base text-slate-700">
                  Ücret öğrenciye iade edildi.
                </p>
              ) : null}
            </div>
          )}

          {/* ── Düğmeler: alt alta, tam genişlik ── */}
          <div className="mt-6 flex flex-col gap-2">
            {katilabilir ? (
              <button
                onClick={() => derseKatil(booking)}
                className={`${DUGME_BIRINCIL} ${TAM}`}
              >
                Derse katıl
              </button>
            ) : (
              acik && (
                <Link to={mesajYolu} className={`${DUGME_IKINCIL} ${TAM}`}>
                  Mesaj gönder
                </Link>
              )
            )}

            {/* Bekleyen dersin yanıtını KİM verir: öğrencinin isteğinde
                öğretmen, öğretmenin teklifinde öğrenci (Modül 8). */}
            {yanitVeren && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(
                        accept,
                        isClient
                          ? "Ders teklifini kabul ettin; ödeme adımına geçebilirsin."
                          : "Ders isteğini kabul ettin."
                      )
                    }
                    className={`${DUGME_BIRINCIL} ${TAM}`}
                  >
                    {isClient ? "Teklifi kabul et" : "Kabul et"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(reject, isClient ? "Ders teklifini reddettin." : "Ders isteğini reddettin.")}
                    className={TEHLIKE}
                  >
                    Reddet
                  </button>
                </>
              )}

            {canWithdraw && (
              <button
                disabled={geriCek.isPending}
                onClick={teklifiGeriCek}
                className={`${DUGME_IKINCIL} ${TAM}`}
              >
                {geriCek.isPending ? "Geri çekiliyor…" : "Teklifi geri çek"}
              </button>
            )}

            {/* Düğme sunucunun `can_review` kararına bağlı: tamamlanmış + ödenmiş
                + bu öğretmene ilk değerlendirme. Varsa düzenleme açılır. */}
            {isClient && booking.can_review && !alreadyReviewed && (
              <button onClick={() => setShowReview(true)} className={`${DUGME_BIRINCIL} ${TAM}`}>
                Değerlendir
              </button>
            )}
            {isClient && review && tamamlandi && (
              <button onClick={() => setShowReview(true)} className={`${DUGME_IKINCIL} ${TAM}`}>
                Değerlendirmeni düzenle
              </button>
            )}

            {booking.can_remind_confirm && role === "TUTOR" && (
              <button
                onClick={onayHatirlat}
                disabled={hatirlat.isPending}
                className={`${DUGME_IKINCIL} ${TAM}`}
              >
                {hatirlat.isPending ? "Gönderiliyor…" : "Onaylamayı hatırlat"}
              </button>
            )}

            {role === "TUTOR" && isAccepted && !basladi && (
              <button onClick={() => setShowTutorReschedule(true)} className={`${DUGME_IKINCIL} ${TAM}`}>
                Başka zamana al
              </button>
            )}

            {role === "TUTOR" && isAccepted && (
              <button
                disabled={busy}
                onClick={() => run(complete, "Ders tamamlandı olarak işaretlendi.")}
                className={`${DUGME_IKINCIL} ${TAM}`}
              >
                Tamamlandı olarak işaretle
              </button>
            )}

            {/* Öğretmenin saat değişikliği yanıt beklerken öğrenci yalnız
                "uygun / uygun değil" der; erteleme ve iptal gizlenir. */}
            {isClient && acik && !booking.late_for_changes && !saatDegisikligi && (
              <button onClick={() => setShowReschedule(true)} className={`${DUGME_IKINCIL} ${TAM}`}>
                Başka zamana al
              </button>
            )}

            {seriAktif && role !== null && (
              <button onClick={() => setSeriBitirAcik(true)} className={TEHLIKE}>
                Haftalık seriyi bitir
              </button>
            )}

            {/* Ödemesiz bekleyen kendi teklifinde öğretmene "İptal" yerine yalnız
                "Teklifi geri çek" gösterilir: iptal, iptal oranı metriğine yazılır. */}
            {/* 12 saat kala öğretmen iptal edemez (sunucu kuralı); dersi
                başka zamana alabilir. */}
            {acik && !canWithdraw && !yanitVeren && !(isClient && saatDegisikligi) && !(role === "TUTOR" && booking.late_for_changes) && (
              <button onClick={() => setShowCancel(true)} className={TEHLIKE}>
                Dersi iptal et
              </button>
            )}
            {role === "TUTOR" && isAccepted && !basladi && booking.late_for_changes && (
              <p className={`${KUCUK_ACIKLAMA} text-center`}>
                Derse 12 saatten az kaldı; dersi iptal edemezsin ama başka zamana alabilirsin.
              </p>
            )}
          </div>
        </section>
      </div>

      {showCancel && (
        <CancelModal
          bookingId={bookingId}
          counterpartName={kisiAdi}
          onClose={() => setShowCancel(false)}
          booking={booking}
          rol={isClient ? "CLIENT" : "TUTOR"}
          onReschedule={isClient ? () => setShowReschedule(true) : undefined}
        />
      )}
      <Modal open={seriBitirAcik} onClose={() => setSeriBitirAcik(false)} title="Haftalık seriyi bitir">
        <p className={ACIKLAMA}>
          Seriden yeni teklif gelmeyecek; bekleyen teklifler geri çekilir, kabul edilmiş dersler
          takviminde kalır.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className={DUGME_IKINCIL} onClick={() => setSeriBitirAcik(false)}>
            Vazgeç
          </button>
          <button type="button" className={TEHLIKE.replace("w-full ", "")} onClick={seriyiBitir} disabled={seriBitir.isPending}>
            {seriBitir.isPending ? "Bitiriliyor…" : "Seriyi bitir"}
          </button>
        </div>
      </Modal>
      {showTutorReschedule && (
        <OgretmenErtelemeModal booking={booking} onClose={() => setShowTutorReschedule(false)} />
      )}
      {showReschedule && (
        <RescheduleModal bookingId={bookingId} onClose={() => setShowReschedule(false)} />
      )}
      {showReview && (
        <ReviewModal
          bookingId={bookingId}
          existing={review ?? undefined}
          onClose={() => setShowReview(false)}
          onReviewed={() => setReviewed(true)}
        />
      )}
    </DashboardShell>
  );
}
