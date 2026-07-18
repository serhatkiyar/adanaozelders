// Cıncık Teslimat sözü — GÖSTERİM yardımcıları. Gerçek karar SUNUCUDA
// (GET /store/delivery-info; services/delivery_promise.py): istemci saatine
// güvenilmez, buradaki fonksiyonlar yalnız sunucu verisini metne çevirir.
import type { DeliveryInfo } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(d);
}

/** ISO date ("2026-07-10") → "bugün"/"yarın"/"13 Tem Pazartesi" (yerel güne göre;
 * geçmiş tarih de tarihe döner — yanlışlıkla "bugün" demez). */
export function promiseDayLabel(isoDate: string, today: Date = new Date()): string {
  const target = new Date(`${isoDate}T00:00:00`);
  const diffDays = Math.round((startOfDay(target) - startOfDay(today)) / DAY_MS);
  if (diffDays === 0) return "bugün";
  if (diffDays === 1) return "yarın";
  return fmtDay(target);
}

/** Kalan saniye → "2 sa 14 dk" / "45 dk" / "1 dk'dan az" (geri sayım rozeti). */
export function formatCountdown(seconds: number): string {
  if (seconds < 60) return "1 dk'dan az";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m} dk`;
  if (m === 0) return `${h} sa`;
  return `${h} sa ${m} dk`;
}

/**
 * Rozet metni. Cutoff geçmemişse aciliyet verir ("2 sa 14 dk içinde sipariş ver,
 * bugün kapında"), geçmişse sözü söyler ("Şimdi sipariş ver, yarın kapında").
 */
export function promiseText(info: DeliveryInfo, today: Date = new Date()): string {
  const day = promiseDayLabel(info.promised_date_now, today);
  if (info.countdown_seconds != null) {
    return `${formatCountdown(info.countdown_seconds)} içinde sipariş ver, ${day} kapında`;
  }
  return `Şimdi sipariş ver, ${day} kapında`;
}

/** E1: cutoff'a bu kadar sn ve daha az kaldıysa rozet "bugün garantisi kapanmak
 *  üzere" uyarı tonuna geçer (PDS §12/E1 — son 15 dk). */
export const CUTOFF_CLOSING_SECONDS = 15 * 60;

export function isCutoffClosing(
  remainingSeconds: number | null | undefined,
): boolean {
  return remainingSeconds != null && remainingSeconds <= CUTOFF_CLOSING_SECONDS;
}

/** Sipariş sonrası söz satırı; tarih yoksa null (eski/dijital sipariş). */
export function promisedDateLabel(
  isoDate: string | null | undefined,
  today: Date = new Date(),
): string | null {
  if (!isoDate) return null;
  return promiseDayLabel(isoDate, today);
}
