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

/** Teslim edilememe neden kodları — kurye seçer (serbest metin yerine yapısal).
 *  Sıra kurye ekranındaki gösterim sırasıdır (en sık üstte). */
export const FAIL_REASONS: { code: string; label: string }[] = [
  { code: "EVDE_YOK", label: "Kimse evde yok" },
  { code: "ERISIM_SORUNU", label: "Zil/kapı/siteye giriş sorunu" },
  { code: "ADRES_SORUNU", label: "Adres bulunamadı / pin yanlış" },
  { code: "MUSTERI_TALEBI", label: "Müşteri sonra gel dedi" },
  { code: "ERKEN_DENEME", label: "Pencereden erken geldim" },
  { code: "GUVENLIK", label: "Güvenli değil (köpek/tehdit)" },
  { code: "PAKET_SORUNU", label: "Paket sorunu" },
  { code: "ARAC_SORUNU", label: "Araç sorunu" },
  { code: "DIGER", label: "Diğer" },
];

export const FAIL_REASON_LABEL: Record<string, string> = Object.fromEntries(
  FAIL_REASONS.map((r) => [r.code, r.label]),
);

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

/** Dispatch board istisna özeti (PDS O2 sağlık şeridi) — turun BEKLEYEN
 *  durakları üzerinden operatörün turu başlatmadan görmesi gereken sorunlar.
 *  Saf fonksiyon (Vitest'li); `today` enjekte edilebilir. */
export interface RunExceptions {
  /** Konumu (pin) olmayan durak — optimize edilemez, elle sıra gerekir. */
  pinless: number;
  /** Söz günü bugünden önce — geciken teslim (dikkat). */
  promiseRisk: number;
  /** Daha önce teslim edilememiş (öncelikli yeniden deneme). */
  retry: number;
  /** Rotaya kattığı ek yol eşiği aşan durak (dış kurye adayı). */
  outlier: number;
  /** AKTİF turda planlanan ETA'sı eşikten fazla geçmiş bekleyen durak —
   *  rota planın gerisinde, müşteri pencereleri kaçabilir (proaktif alarm). */
  etaDelayed: number;
}

/** ETA sapma alarmı eşiği (dk) — açıklanabilir sabit; "AI tahmini" değil.
 *  Müşteri penceresinin geç kanadıyla (±45 dk) uyumlu erken uyarı payı. */
export const ETA_DELAY_ALERT_MINUTES = 15;

export function runExceptions(
  run: DeliveryRun,
  today: Date = new Date(),
): RunExceptions {
  const todayIso = today.toLocaleDateString("sv-SE"); // yerel YYYY-MM-DD
  const pending = run.stops.filter((s) => s.status === "PENDING");
  const etaLimitMs = today.getTime() - ETA_DELAY_ALERT_MINUTES * 60_000;
  return {
    pinless: pending.filter((s) => s.lat == null || s.lng == null).length,
    promiseRisk: pending.filter(
      (s) => s.promised_delivery_date != null && s.promised_delivery_date < todayIso,
    ).length,
    retry: pending.filter((s) => (s.failed_attempts ?? 0) > 0).length,
    outlier: pending.filter((s) => s.is_outlier).length,
    // Yalnız AKTİF turda anlamlı: PLANNED'da ETA'lar optimize-anı taslağıdır,
    // start_run gerçek çıkışa kaydırır — orada alarm gürültü olur.
    etaDelayed:
      run.status === "ACTIVE"
        ? pending.filter(
            (s) => s.eta != null && new Date(s.eta).getTime() < etaLimitMs,
          ).length
        : 0,
  };
}

/** İki durak aynı teslimat noktası mı? Pin varsa ~30 m tolerans (aynı adres
 *  kaydı aynı pin'i taşır; float yuvarlaması için pay), pin yoksa alıcı adı.
 *  (Faz 7 "çoklu paket": durak→sipariş 1:1 ve kanıt zinciri AYNEN kalır —
 *  bu yalnız saha/panel farkındalığıdır, veri modeli birleştirmez.) */
function sameDeliveryPoint(a: DeliveryStop, b: DeliveryStop): boolean {
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    // 0.0003° ≈ 33 m (enlem) — aynı bina/pin için yeterli, komşu binayı almaz.
    return Math.abs(a.lat - b.lat) < 0.0003 && Math.abs(a.lng - b.lng) < 0.0003;
  }
  return a.recipient != null && a.recipient === b.recipient;
}

/** Sıradaki durakla AYNI noktaya gidecek diğer bekleyen duraklar (çoklu paket).
 *  Kurye ekranı "bu adrese N paket daha var — birlikte götür" bandını,
 *  admin durak listesi grup rozetini bundan besler. */
export function coLocatedPendingStops(
  run: DeliveryRun,
  stop: DeliveryStop,
): DeliveryStop[] {
  return run.stops.filter(
    (s) =>
      s.id !== stop.id && s.status === "PENDING" && sameDeliveryPoint(s, stop),
  );
}

/** İstisna özetinde işaretlenecek bir şey var mı? */
export function hasRunExceptions(x: RunExceptions): boolean {
  return (
    x.pinless > 0 ||
    x.promiseRisk > 0 ||
    x.retry > 0 ||
    x.outlier > 0 ||
    x.etaDelayed > 0
  );
}
