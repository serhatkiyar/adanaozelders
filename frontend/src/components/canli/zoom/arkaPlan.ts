/**
 * Sanal arka plan seçenekleri — Meet `effects` paneli karşılığı (La Suite
 * Meet, MIT — DINUM/Etalab), Zoom'un `virtualBackground.imageUrl` sözleşmesiyle:
 * `'blur'` bulanıklaştırır, `undefined` kapatır, görsel adresi o görseli koyar.
 *
 * Görsel dosyası ya da dış adres YOK: düz renkler çalışma anında küçük bir
 * `<canvas>`tan `data:` adresine çizilir (CSP `img-src data:` yeterli).
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

const cizilenler = new Map<ArkaPlanRengi, string>();

/** Düz renk görseli (16:9, `data:` PNG); çizilemezse `null`. */
function renkGorseli(renk: ArkaPlanRengi): string | null {
  const hazir = cizilenler.get(renk);
  if (hazir) return hazir;
  try {
    const tuval = document.createElement("canvas");
    tuval.width = 320;
    tuval.height = 180;
    const cizim = tuval.getContext("2d");
    if (!cizim) return null;
    cizim.fillStyle = ARKA_PLAN_RENKLERI[renk];
    cizim.fillRect(0, 0, tuval.width, tuval.height);
    const adres = tuval.toDataURL("image/png");
    cizilenler.set(renk, adres);
    return adres;
  } catch {
    return null;
  }
}

/** Zoom'a verilecek `imageUrl`: `'blur'`, `data:` adresi ya da `undefined` (yok). */
export function arkaPlanAdresi(ap: ArkaPlan): string | undefined {
  if (ap === "bulanik") return "blur";
  const renk = arkaPlanRengi(ap);
  return renk ? (renkGorseli(renk) ?? undefined) : undefined;
}
