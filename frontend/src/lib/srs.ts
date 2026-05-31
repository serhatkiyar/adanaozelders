import type { Flashcard, ReviewRating } from "@/types";

// Backend flashcard_service._apply_sm2 ile BİREBİR aynı (dakika-bazlı öğrenme
// adımları); review butonlarının altında "ne kadar sonra göreceğin" önizlemesi.
const MAX_EASE = 3.0;
const DAY = 1440; // dk
const MAX_INTERVAL = 365 * DAY;

type SrsState = Pick<Flashcard, "interval_minutes" | "ease_factor">;

/** Derecelendirme sonrası bir sonraki aralık (DAKİKA). */
export function previewIntervalMinutes(card: SrsState, rating: ReviewRating): number {
  const iv = card.interval_minutes;
  const ef = card.ease_factor;
  let next: number;

  if (rating === "again") {
    next = 1;
  } else if (rating === "hard") {
    next = iv < DAY ? 10 : Math.max(1, Math.round((iv / DAY) * 1.2)) * DAY;
  } else if (rating === "good") {
    if (iv < 60) next = 60;
    else if (iv < DAY) next = DAY;
    else next = Math.max(1, Math.round((iv / DAY) * ef)) * DAY;
  } else {
    // easy
    const nef = Math.min(MAX_EASE, ef + 0.15);
    next = iv < DAY ? DAY : Math.max(1, Math.round((iv / DAY) * nef * 1.3)) * DAY;
  }
  return Math.min(next, MAX_INTERVAL);
}

/** Dakikayı kısa Türkçe etikete çevirir ("1 dk", "10 dk", "1 saat", "4 gün", "2 ay"). */
export function intervalLabel(minutes: number): string {
  if (minutes < 1) return "<1 dk";
  if (minutes < 60) return `${Math.round(minutes)} dk`;
  if (minutes < DAY) return `${Math.round(minutes / 60)} saat`;
  const days = Math.round(minutes / DAY);
  if (days < 30) return `${days} gün`;
  if (days < 365) return `${Math.round(days / 30)} ay`;
  return `${Math.round(days / 365)} yıl`;
}

export function previewLabel(card: SrsState, rating: ReviewRating): string {
  return intervalLabel(previewIntervalMinutes(card, rating));
}

/** Kartın bir sonraki tekrar zamanını gösterim için biçimler. */
export function formatDue(dueIso: string): { label: string; due: boolean } {
  const diff = new Date(dueIso).getTime() - Date.now();
  if (diff <= 0) return { label: "Tekrar zamanı", due: true };
  const mins = diff / 60_000;
  if (mins < 60) return { label: `${Math.round(mins)} dk sonra`, due: false };
  if (mins < DAY) return { label: `${Math.round(mins / 60)} saat sonra`, due: false };
  const days = Math.round(mins / DAY);
  if (days === 1) return { label: "Yarın", due: false };
  if (days < 30) return { label: `${days} gün sonra`, due: false };
  return {
    label: new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" }).format(
      new Date(dueIso)
    ),
    due: false,
  };
}
