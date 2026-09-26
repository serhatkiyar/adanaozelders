import { useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { ReviewModal } from "@/components/ReviewModal";
import { SorunBildirModal } from "@/components/booking/DersOnayKarti";
import { SiradakiDersKarti } from "@/components/pano/SiradakiDersKarti";
import {
  ACIKLAMA,
  DUGME_BIRINCIL,
  DUGME_IKINCIL,
  ETIKET,
  KART,
  KUCUK_ACIKLAMA,
  METIN_BAGLANTI,
} from "@/components/pano/stil";
import { PAY_CLOSED_NOTICE_ID } from "@/components/reservation/LessonRow";
import { useBookingAction, useConfirmBooking } from "@/hooks/useBookings";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { usePayBooking } from "@/hooks/usePayments";
import { formatDate, formatDateTime, formatRange } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { isBranchOpen } from "@/lib/paymentAvailability";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { BookingOut, ClientNextAction, ClientNextActionKind } from "@/types";

/**
 * Kart metinleri tek sözlükte. Fikir Preply'ın öğrenci ana sayfasından
 * (tek ana kart, eğitmen adını taşıyan başlık, tek eylem); metinler özgün.
 */
const METIN: Record<
  ClientNextActionKind,
  { etiket: string; baslik: (egitmen: string) => string }
> = {
  JOIN_LESSON: { etiket: "Şimdi", baslik: (e) => `${e} ile dersin başlıyor` },
  RESPOND_OFFER: {
    etiket: "Yanıtın bekleniyor",
    baslik: (e) => `${e} sana bir ders teklif etti`,
  },
  PAY: { etiket: "Ödeme bekliyor", baslik: (e) => `${e} ile dersini kesinleştir` },
  CONFIRM_LESSON: {
    etiket: "Onayın bekleniyor",
    baslik: (e) => `${e} ile dersin gerçekleşti mi?`,
  },
  REVIEW: { etiket: "Ders nasıldı?", baslik: (e) => `${e} ile derslerin nasıl geçti?` },
  NEXT_LESSON: { etiket: "Sıradaki ders", baslik: (e) => `${e} ile sıradaki dersin` },
  BOOK_AGAIN: { etiket: "Kaldığın yerden", baslik: (e) => `${e} ile devam et` },
};

const egitmenAdi = (b: BookingOut) => b.tutor_name || "Öğretmen";

/** Ücretsiz ilk derste ödeme kaydı hiç oluşmaz (`price=0`). */
const ucretsiz = (b: BookingOut) => b.is_free_lesson || Number(b.price ?? 0) === 0;

/**
 * Öğrenci panosunun ana kartı. Hangi kartın çizileceğine SUNUCU karar verir
 * (`GET /clients/me/dashboard::next_action`); burada yalnız türe göre
 * dallanılır. `action` boşsa ders geçmişi var ama yapılacak iş yok demektir.
 * `bekleyenVar`: action boşken "Sıradaki dersler" listesinde kalan her ders
 * öğrencinin eğitmen onayı bekleyen talebidir (kabul edilmiş ders ve eğitmen
 * teklifi zaten bir action üretir); "dersin yok" demek listeyle çelişirdi.
 */
export function SiradakiEylemKarti({
  action,
  bekleyenVar = false,
  onJoinMeeting,
}: {
  action: ClientNextAction | null;
  bekleyenVar?: boolean;
  onJoinMeeting: (booking: BookingOut) => void;
}) {
  if (!action) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
        <p className={ETIKET}>
          {bekleyenVar ? "Talebin öğretmenin onayını bekliyor" : "Sıradaki dersin yok"}
        </p>
        <p className={`mt-1 ${ACIKLAMA}`}>
          {bekleyenVar
            ? "Öğretmen talebini onayladığında sıradaki dersin burada görünecek."
            : "Yeni bir konuya başlamak ya da çalışmayı sürdürmek için öğretmenlere göz at."}
        </p>
        <Link
          to={ROUTES.tutors}
          className={`mt-6 ${bekleyenVar ? DUGME_IKINCIL : DUGME_BIRINCIL}`}
        >
          Öğretmen bul
        </Link>
      </section>
    );
  }

  const { kind, booking } = action;
  switch (kind) {
    case "JOIN_LESSON":
    case "NEXT_LESSON":
      return (
        <SiradakiDersKarti
          lesson={booking}
          bosMetin=""
          onJoinMeeting={onJoinMeeting}
          karsiTaraf="egitmen"
          ustEtiket={METIN[kind].etiket}
        />
      );
    case "RESPOND_OFFER":
      return <TeklifKarti booking={booking} />;
    case "PAY":
      return <OdemeKarti booking={booking} />;
    case "CONFIRM_LESSON":
      return <OnayKarti booking={booking} />;
    case "REVIEW":
      return <DegerlendirmeKarti booking={booking} />;
    case "BOOK_AGAIN":
      return <DevamKarti booking={booking} />;
  }
}

/** Kartların ortak iskeleti: üst etiket, eğitmen, başlık, ders bilgisi. */
function EylemIskeleti({
  kind,
  booking,
  dersBilgisi = true,
  aciklama,
  children,
}: {
  kind: ClientNextActionKind;
  booking: BookingOut;
  dersBilgisi?: boolean;
  aciklama: React.ReactNode;
  children: React.ReactNode;
}) {
  const ad = egitmenAdi(booking);
  const yuzYuze = booking.mode === "IN_PERSON";
  return (
    <section aria-label={METIN[kind].etiket} className={KART}>
      <p className={KUCUK_ACIKLAMA}>{METIN[kind].etiket}</p>

      <div className="mt-4 flex items-center gap-4">
        <Avatar name={ad} avatar_url={booking.tutor_avatar_url ?? null} size="lg" />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-6 text-slate-900">
            {METIN[kind].baslik(ad)}
          </h2>
          {dersBilgisi && (
            <p className={`mt-1 ${ACIKLAMA}`}>
              {formatRange(booking.start_at, booking.end_at)}
            </p>
          )}
        </div>
      </div>

      {dersBilgisi && (
        <p className={`mt-4 ${ACIKLAMA}`}>
          {yuzYuze ? "Yüz yüze" : "Online"} ·{" "}
          {ucretsiz(booking)
            ? "Ücretsiz ilk ders"
            : formatTRY(booking.payment?.amount ?? booking.price)}
        </p>
      )}

      <p className={`mt-2 ${ACIKLAMA}`}>{aciklama}</p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">{children}</div>

      {dersBilgisi && (
        <Link to={ROUTES.lesson(booking.id)} className={`mt-4 inline-block ${METIN_BAGLANTI}`}>
          Ders detayı
        </Link>
      )}
    </section>
  );
}

function TeklifKarti({ booking }: { booking: BookingOut }) {
  const accept = useBookingAction("accept");
  const reject = useBookingAction("reject");
  const mesgul = accept.isPending || reject.isPending;

  const { data: availability } = usePaymentAvailability();
  // Kanal ilk kabulde yazılır; henüz yazılmadıysa sunucu kolun açıklığına
  // bakacağı için aynı bilgiyle önceden söylenir.
  const odemeli = booking.payment_channel
    ? booking.payment_channel === "ESCROW"
    : isBranchOpen(availability, "tutor_marketplace");
  const yanitla = (m: typeof accept, basari: string | ((sonuc: BookingOut) => string)) =>
    m.mutate(booking.id, {
      onSuccess: (sonuc) =>
        toast.success(typeof basari === "function" ? basari(sonuc) : basari),
      onError: (err) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
    });

  return (
    <EylemIskeleti
      kind="RESPOND_OFFER"
      booking={booking}
      aciklama={
        ucretsiz(booking) || !odemeli
          ? "Kabul edersen ders kesinleşir ve takvimine eklenir."
          : "Kabul edersen ödeme adımına geçersin; ders ödemeyle kesinleşir."
      }
    >
      <button
        type="button"
        disabled={mesgul}
        onClick={() =>
          yanitla(
            accept,
            (sonuc) =>
              ucretsiz(booking) || sonuc.payment_channel === "DIRECT"
                ? "Ders teklifini kabul ettin; ders kesinleşti."
                : "Ders teklifini kabul ettin; ödeme adımına geçebilirsin."
          )
        }
        className={`sm:flex-1 ${DUGME_BIRINCIL}`}
      >
        {accept.isPending ? "Kabul ediliyor…" : "Kabul et"}
      </button>
      <button
        type="button"
        disabled={mesgul}
        onClick={() => yanitla(reject, "Ders teklifini reddettin.")}
        className={`sm:flex-1 ${DUGME_IKINCIL}`}
      >
        {reject.isPending ? "Gönderiliyor…" : "Reddet"}
      </button>
    </EylemIskeleti>
  );
}

function OdemeKarti({ booking }: { booking: BookingOut }) {
  const pay = usePayBooking();
  const { data: availability } = usePaymentAvailability();
  const acik = isBranchOpen(availability, "tutor_marketplace");

  // `BookingRow::handlePay` ile aynı: iyzico yönlendirmesi hook'ta yapılır.
  const ode = () =>
    pay.mutate(booking.id, {
      onSuccess: (p) => {
        if (!p.redirect_url) toast.success("Ödeme alındı, ders kesinleşti.");
      },
      onError: (err) => toast.error(getErrorMessage(err, "Ödeme yapılamadı.")),
    });

  return (
    <EylemIskeleti
      kind="PAY"
      booking={booking}
      aciklama={`${egitmenAdi(booking)} dersini kabul etti. Ödemen alındığında ders kesinleşir.`}
    >
      {acik ? (
        <button
          type="button"
          disabled={pay.isPending}
          onClick={ode}
          className={`sm:flex-1 ${DUGME_BIRINCIL}`}
        >
          {pay.isPending ? "İşleniyor…" : `Öde · ${formatTRY(booking.payment?.amount)}`}
        </button>
      ) : (
        // Sebep sayfa başında bir kez söyleniyor (`PaymentBranchNotice`).
        <button
          type="button"
          disabled
          aria-describedby={PAY_CLOSED_NOTICE_ID}
          className={`sm:flex-1 ${DUGME_IKINCIL}`}
        >
          Ödeme yolu şu an kapalı
        </button>
      )}
    </EylemIskeleti>
  );
}

function OnayKarti({ booking }: { booking: BookingOut }) {
  const [sorunAcik, setSorunAcik] = useState(false);
  const confirm = useConfirmBooking();

  const onayla = () =>
    confirm.mutate(booking.id, {
      onSuccess: () => toast.success("Dersi onayladın."),
      onError: (err) => toast.error(getErrorMessage(err, "Ders onaylanamadı.")),
    });

  // Metin `DersOnayKarti` ile aynı kuralı anlatır; son an sunucudan gelir.
  const sonAn = booking.issue_report_deadline
    ? `${formatDateTime(booking.issue_report_deadline)} tarihine kadar`
    : "72 saat içinde";

  return (
    <EylemIskeleti
      kind="CONFIRM_LESSON"
      booking={booking}
      aciklama={`Onayladığında ücret öğretmenine aktarılır. Bir sorun olduysa ${sonAn} bildirebilirsin; bildirim yapılmazsa ders onaylanmış sayılır.`}
    >
      <button
        type="button"
        disabled={confirm.isPending}
        onClick={onayla}
        className={`sm:flex-1 ${DUGME_BIRINCIL}`}
      >
        {confirm.isPending ? "Onaylanıyor…" : "Ders gerçekleşti"}
      </button>
      <button
        type="button"
        onClick={() => setSorunAcik(true)}
        className={`sm:flex-1 ${DUGME_IKINCIL}`}
      >
        Sorun bildir
      </button>
      {sorunAcik && <SorunBildirModal booking={booking} onClose={() => setSorunAcik(false)} />}
    </EylemIskeleti>
  );
}

function DegerlendirmeKarti({ booking }: { booking: BookingOut }) {
  const [acik, setAcik] = useState(false);
  return (
    <EylemIskeleti
      kind="REVIEW"
      booking={booking}
      dersBilgisi={false}
      aciklama="Yorumun, başka öğrencilerin kendilerine uygun öğretmeni bulmasına yardım eder."
    >
      <button type="button" onClick={() => setAcik(true)} className={`sm:w-auto ${DUGME_BIRINCIL}`}>
        Değerlendir
      </button>
      {acik && (
        <ReviewModal
          bookingId={booking.id}
          onClose={() => setAcik(false)}
          onReviewed={() => setAcik(false)}
        />
      )}
    </EylemIskeleti>
  );
}

function DevamKarti({ booking }: { booking: BookingOut }) {
  return (
    <EylemIskeleti
      kind="BOOK_AGAIN"
      booking={booking}
      dersBilgisi={false}
      aciklama={`Son dersin ${formatDate(booking.start_at)} tarihindeydi. Çalışmayı sürdürmek için yeni bir ders planla.`}
    >
      <Link to={ROUTES.tutor(booking.tutor_id)} className={`sm:w-auto ${DUGME_BIRINCIL}`}>
        Yeni ders planla
      </Link>
    </EylemIskeleti>
  );
}
