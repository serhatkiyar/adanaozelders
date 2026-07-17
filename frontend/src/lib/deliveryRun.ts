// Kendi-filo dağıtım turu saf yardımcıları (Vitest'li).
// (lib/delivery.ts ürün sayfasındaki "tahmini teslimat" metnidir — ayrı konu.)
import type { DeliveryRun, DeliveryStop } from "@/types";

/**
 * Durak için Google Maps navigasyon URL'i. Uygulama içinde adım-adım navigasyon
 * YAZILMAZ — dağıtıcının telefonundaki Google Maps deep-link ile açılır
 * (mobilde uygulamaya, masaüstünde web'e düşer). Pin (lat/lng) otoritedir;
 * yoksa adres metnine düşülür; ikisi de yoksa null (buton gizlenir).
 */
export function googleNavUrl(
  lat: number | null | undefined,
  lng: number | null | undefined,
  address?: string | null
): string | null {
  const base = "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=";
  if (lat != null && lng != null) return `${base}${lat},${lng}`;
  if (address && address.trim()) return `${base}${encodeURIComponent(address.trim())}`;
  return null;
}

/** Sahada sıradaki durak: sequence sırasına göre ilk PENDING. */
export function nextPendingStop(run: DeliveryRun): DeliveryStop | null {
  const pending = run.stops
    .filter((s) => s.status === "PENDING")
    .sort((a, b) => a.sequence - b.sequence);
  return pending[0] ?? null;
}

/** Tur ilerlemesi: [sonuçlanan, toplam]. */
export function runProgress(run: DeliveryRun): [number, number] {
  const done = run.stops.filter((s) => s.status !== "PENDING").length;
  return [done, run.stops.length];
}

export const RUN_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planlanıyor",
  ACTIVE: "Sahada",
  DONE: "Tamamlandı",
  CANCELLED: "İptal",
};

export const STOP_STATUS_LABEL: Record<string, string> = {
  PENDING: "Bekliyor",
  DELIVERED: "Teslim edildi",
  FAILED: "Teslim edilemedi",
  RESCHEDULED: "Müşteri erteledi",
  CANCELLED: "Sipariş iptal",
};

export const VEHICLE_LABEL: Record<string, string> = {
  LADA: "Lada (birincil)",
  COROLLA: "Corolla (yedek)",
};
