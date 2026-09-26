/**
 * Sanal arka plan seçenekleri — Meet `effects` paneli karşılığı (La Suite
 * Meet, MIT — DINUM/Etalab). Sağlayıcıdan bağımsız seçim; sağlayıcının
 * biçimine çevrilmesi sürücüde (Zoom: `zoom/arkaPlanAdresi.ts`).
 *
 * Görsel dosyası ya da dış adres YOK: düz renkler çalışma anında çizilir.
 */

export const ARKA_PLAN_RENKLERI = {
  gri: "#4b5563",
  lacivert: "#1e3a5f",
  yesil: "#2f5d50",
  bej: "#d6ccc2",
} as const;

export type ArkaPlanRengi = keyof typeof ARKA_PLAN_RENKLERI;
export type ArkaPlan = "yok" | "bulanik" | `renk:${ArkaPlanRengi}`;

export const ARKA_PLANLAR: readonly ArkaPlan[] = [
  "yok",
  "bulanik",
  ...(Object.keys(ARKA_PLAN_RENKLERI) as ArkaPlanRengi[]).map((r) => `renk:${r}` as const),
];

/** Saklanan değer geçerli bir seçenek mi? SAF. */
export function arkaPlanMi(d: unknown): d is ArkaPlan {
  return typeof d === "string" && (ARKA_PLANLAR as readonly string[]).includes(d);
}

export function arkaPlanRengi(ap: ArkaPlan): ArkaPlanRengi | null {
  return ap.startsWith("renk:") ? (ap.slice(5) as ArkaPlanRengi) : null;
}
