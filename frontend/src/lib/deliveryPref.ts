// Teslimat tercihi gösterim mantığı — backend kuralının istemci AYNASI
// (gerçek doğrulama sunucuda: order_service.set_delivery_pref/postpone/
// change_ship_address). Kurallar değişirse iki taraf birlikte güncellenir.
import type { DeliveryPref, OrderOut } from "@/types";

export const POSTPONE_LIMIT = 2; // backend order_service.POSTPONE_LIMIT aynası

export const PREF_OPTIONS: {
  value: DeliveryPref;
  label: string;
  description: string;
  emoji: string;
}[] = [
  {
    value: "ADRESIMDEYIM",
    label: "Adresimdeyim",
    description: "Kurye kapında SMS kodunla teslim eder (standart).",
    emoji: "🏠",
  },
  {
    value: "KAPIYA_BIRAK",
    label: "Kapıya bırak",
    description: "Evde yoksan paket kapına bırakılır; fotoğrafla kanıtlanır.",
    emoji: "🚪",
  },
  {
    value: "KOMSUYA_BIRAK",
    label: "Komşuma bırak",
    description: "Belirttiğin komşuya teslim edilir; fotoğrafla kanıtlanır.",
    emoji: "🤝",
  },
  {
    value: "BENI_ARA",
    label: "Gelmeden önce ara",
    description: "Kurye adresine yaklaşınca seni telefonla arar.",
    emoji: "📞",
  },
];

export const PREF_LABELS: Record<string, string> = Object.fromEntries(
  PREF_OPTIONS.map((o) => [o.value, o.label]),
);

export const PREF_EMOJI: Record<string, string> = Object.fromEntries(
  PREF_OPTIONS.map((o) => [o.value, o.emoji]),
);

/** Kurye ekranı talimat bandı metni ("🤝 Komşuya: Ayşe Hn. D:4"). */
export function prefBannerText(
  pref?: string | null,
  note?: string | null,
): string | null {
  if (!pref || pref === "ADRESIMDEYIM") return null;
  const base = `${PREF_EMOJI[pref] ?? ""} ${PREF_LABELS[pref] ?? pref}`.trim();
  if (pref === "KOMSUYA_BIRAK" && note) return `${base}: ${note}`;
  return base;
}

/** Bırakma teslimi mi (OTP yerine zorunlu foto kanıt)? */
export function isDropPref(pref?: string | null): boolean {
  return pref === "KAPIYA_BIRAK" || pref === "KOMSUYA_BIRAK";
}

/** Tercih değiştirilebilir mi? (dijital/kapanmış siparişte hayır) */
export function canChangePref(order: Pick<OrderOut, "has_physical" | "status" | "payment_status">): boolean {
  return (
    order.has_physical &&
    order.payment_status === "PAID" &&
    (order.status === "PAID" || order.status === "SHIPPED")
  );
}

/** Erteleme hakkı kaldı mı? */
export function canPostpone(
  order: Pick<OrderOut, "has_physical" | "status" | "payment_status" | "postpone_count">,
): boolean {
  return canChangePref(order) && (order.postpone_count ?? 0) < POSTPONE_LIMIT;
}

/** Adres değişikliği yalnız dağıtıma çıkmadan (sipariş henüz SHIPPED değilken). */
export function canChangeAddress(
  order: Pick<OrderOut, "has_physical" | "status" | "payment_status">,
): boolean {
  return order.has_physical && order.payment_status === "PAID" && order.status === "PAID";
}
