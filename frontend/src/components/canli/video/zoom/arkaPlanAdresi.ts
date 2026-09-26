/**
 * Nötr arka plan seçimi → Zoom `virtualBackground.imageUrl` sözleşmesi:
 * `'blur'` bulanıklaştırır, `undefined` kapatır, görsel adresi o görseli koyar.
 * Düz renkler küçük bir `<canvas>`tan `data:` adresine çizilir (CSP
 * `img-src data:` yeterli).
 */
import { ARKA_PLAN_RENKLERI, arkaPlanRengi, type ArkaPlan, type ArkaPlanRengi } from "../arkaPlan";

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
