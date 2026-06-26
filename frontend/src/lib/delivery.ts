// Tahmini teslimat — UI GÖSTERİM amaçlı (backend verisi DEĞİL; "Tahmini" etiketiyle gösterilir).
// Fiziksel ürün: bugünden +1…+3 gün tarih aralığı; dijital ürün: anında teslimat.
import type { ProductKind } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" }).format(d);
}

/**
 * Tahmini teslimat metni. Fiziksel için "28 – 30 Haz" tarzı aralık (gün-içi kargo
 * taahhüdüyle uyumlu: +1…+3 gün), dijital için "Anında teslimat".
 */
export function estimateDelivery(kind: ProductKind, base: Date = new Date()): string {
  if (kind === "DIGITAL") return "Anında teslimat";
  const from = new Date(base.getTime() + 1 * DAY_MS);
  const to = new Date(base.getTime() + 3 * DAY_MS);
  return `${fmt(from)} – ${fmt(to)}`;
}
