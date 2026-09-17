import { isLessonJoinable, JOIN_OPENS_BEFORE_MIN } from "@/lib/lesson";
import { ROUTES } from "@/lib/routes";
import type { VisibilityIssueCode } from "@/types";

/** Günün saatine göre selamlama (cihaz saati). */
export function selamlama(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Günaydın";
  if (h >= 12 && h < 18) return "Tünaydın";
  return "İyi akşamlar";
}

/**
 * Selamlamanın altındaki tek cümle. Yeni eğitmen (hiç tamamlanmış dersi ve
 * sıradaki dersi yok) ile bugün dersi olmayan eğitmen ayrı karşılanır.
 */
export function panoAltSatir(opts: {
  nextLessonStart: string | null;
  completedTotal: number;
  now: Date;
}): string | null {
  const { nextLessonStart, completedTotal, now } = opts;
  if (!nextLessonStart && completedTotal === 0) {
    return "Burada olman ne güzel. İlk öğrencin için ilanını hazır tut.";
  }
  const bugunDersVar =
    nextLessonStart !== null &&
    new Date(nextLessonStart).toDateString() === now.toDateString();
  return bugunDersVar ? null : "Bugün dersin yok. Önümüzdeki günlere göz atabilirsin.";
}

export type KatilDurumu = "kapali" | "birincil" | "ikincil";

/**
 * "Derse katıl" düğmesinin görünümü. Katılım penceresi `lib/lesson.ts` ile
 * aynıdır (15 dk önce açılır, bitişten 30 dk sonra kapanır); pencere açıkken
 * düğme birincil, ders henüz uzaksa ikincil (bilgi amaçlı) görünür.
 */
export function katilDurumu(
  startIso: string,
  endIso: string,
  now: number = Date.now()
): KatilDurumu {
  if (isLessonJoinable(startIso, endIso, now)) return "birincil";
  const open = new Date(startIso).getTime() - JOIN_OPENS_BEFORE_MIN * 60 * 1000;
  return now < open ? "ikincil" : "kapali";
}

/** "32 dk sonra", "2 sa sonra", "3 gün sonra", "Şimdi". */
export function kalanSure(startIso: string, now: number = Date.now()): string {
  const dk = Math.round((new Date(startIso).getTime() - now) / 60000);
  if (dk <= 0) return "Şimdi";
  if (dk < 60) return `${dk} dk sonra`;
  const sa = Math.round(dk / 60);
  if (sa < 24) return `${sa} sa sonra`;
  return `${Math.round(sa / 24)} gün sonra`;
}

export interface GorunurlukEylemi {
  baslik: string;
  aciklama: string;
  dugme: string | null;
  to: string | null;
}

const EYLEMLER: Record<VisibilityIssueCode, GorunurlukEylemi> = {
  DRAFT: {
    baslik: "İlanın henüz yayında değil",
    aciklama: "Kaldığın yerden devam et; tamamlayınca öğrenciler seni aramada bulur.",
    dugme: "Devam et",
    to: ROUTES.tutorOnboarding,
  },
  PENDING_APPROVAL: {
    baslik: "İlanın inceleniyor",
    aciklama: "Onaylandığında öğrenciler seni aramada görmeye başlar.",
    dugme: null,
    to: null,
  },
  REJECTED: {
    baslik: "İlanın onaylanmadı",
    aciklama: "Düzeltilmesi gereken alanları gözden geçirip yeniden gönder.",
    dugme: "İlanı düzenle",
    to: ROUTES.tutorListing,
  },
  SUSPENDED: {
    baslik: "İlanın askıda",
    aciklama: "Öğrenciler seni aramada göremiyor. Hazır olduğunda yeniden aç.",
    dugme: "İlanıma git",
    to: ROUTES.tutorListing,
  },
  NO_SUBJECTS: {
    baslik: "Ders seçmedin",
    aciklama: "Verdiğin dersleri eklemeden aramada çıkmazsın.",
    dugme: "Ders ekle",
    to: ROUTES.tutorListing,
  },
  NO_AVAILABILITY: {
    baslik: "Müsait saatlerin boş",
    aciklama: "Öğrenciler ders talebi için uygun saatini göremiyor.",
    dugme: "Saat ekle",
    to: ROUTES.tutorListing,
  },
  PAYOUT_NOT_ACTIVE: {
    baslik: "Ödeme bilgilerin eksik",
    aciklama: "Ücretli ders kabul edebilmek için IBAN ve kimlik bilgini ekle.",
    dugme: "Bilgileri ekle",
    to: `${ROUTES.settings}?bolum=odeme`,
  },
};

export function gorunurlukEylemi(code: string): GorunurlukEylemi | null {
  return (EYLEMLER as Record<string, GorunurlukEylemi>)[code] ?? null;
}
