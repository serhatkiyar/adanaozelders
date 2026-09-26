/**
 * Agora sanal arka planı (`agora-extension-virtual-background`): bulanık ya
 * da düz renk. Eklenti (~2 MB, wasm gömülü) İLK SEÇİMDE dinamik import edilir
 * ve kendi parçasına ayrılır.
 *
 * Tek işlemci: önizleme izinden oda izine taşınır (`pipe`), yeniden
 * oluşturulmaz. İz kapanmadan önce `arkaPlaniBirak` çağrılır.
 *
 * `arkaPlanIyimser`: oda çizilmeden beklenen destek sorusu hızlı çözülür —
 * masaüstü Chromium'da iyimser `true`; gerçek kontrol (`checkCompatibility`)
 * seçim anında, uygulanamazsa `false` döner ve nötr katman uyarır.
 */
import type { ICameraVideoTrack } from "agora-rtc-sdk-ng";
import type { IVirtualBackgroundProcessor } from "agora-extension-virtual-background";

import { tarayiciOrtami, telefonMu } from "@/lib/canliDers";

import { ARKA_PLAN_RENKLERI, arkaPlanRengi, type ArkaPlan } from "../arkaPlan";
import { masaustuChromiumMu } from "./cevir";
import { AgoraRTC } from "./istemci";

/** Bulanıklık derecesi (1 hafif, 2 orta, 3 güçlü). */
const BULANIKLIK = 2;

let yukleme: Promise<IVirtualBackgroundProcessor | null> | null = null;
/** Yüklenmiş işlemci (eşzamanlı söküm için). */
let hazirIslemci: IVirtualBackgroundProcessor | null = null;
/** İşlemcinin şu an bağlı olduğu iz. */
let bagliIz: ICameraVideoTrack | null = null;

export function masaustuChromium(): boolean {
  const ortam = tarayiciOrtami();
  return masaustuChromiumMu(ortam.ua, telefonMu(ortam));
}

/** Hızlı destek yanıtı (eklenti yüklenmez). */
export function arkaPlanIyimser(): boolean {
  return masaustuChromium();
}

function islemciGetir(): Promise<IVirtualBackgroundProcessor | null> {
  yukleme ??= (async () => {
    try {
      const { default: VirtualBackgroundExtension } = await import(
        "agora-extension-virtual-background"
      );
      const eklenti = new VirtualBackgroundExtension();
      if (!eklenti.checkCompatibility()) return null;
      AgoraRTC.registerExtensions([eklenti]);
      const islemci = eklenti.createProcessor();
      await islemci.init();
      islemci.onoverload = () => console.warn("Agora sanal arka plan: cihaz yetişemiyor");
      hazirIslemci = islemci;
      return islemci;
    } catch (hata) {
      console.warn("Agora sanal arka plan yüklenemedi", hata);
      return null;
    }
  })();
  return yukleme;
}

/**
 * Arka planı ize uygular. `"yok"` işlemciyi kapatır. Eklenti yoksa ya da
 * uygulanamadıysa `false` (görüntü arka plansız sürer).
 */
export async function arkaPlaniUygula(iz: ICameraVideoTrack, ap: ArkaPlan): Promise<boolean> {
  if (ap === "yok") {
    if (bagliIz === iz && yukleme) {
      const islemci = await yukleme;
      try {
        await islemci?.disable();
      } catch (hata) {
        console.warn("Agora sanal arka plan kapatılamadı", hata);
      }
    }
    return true;
  }
  if (!arkaPlanIyimser()) return false;
  const islemci = await islemciGetir();
  if (!islemci) return false;
  try {
    if (bagliIz !== iz) {
      baglantiyiSok();
      iz.pipe(islemci).pipe(iz.processorDestination);
      bagliIz = iz;
    }
    const renk = arkaPlanRengi(ap);
    islemci.setOptions(
      renk
        ? { type: "color", color: ARKA_PLAN_RENKLERI[renk] }
        : { type: "blur", blurDegree: BULANIKLIK },
    );
    await islemci.enable();
    return true;
  } catch (hata) {
    console.warn("Agora sanal arka plan uygulanamadı", hata);
    try {
      await islemci.disable();
    } catch {
      // zaten kapalı
    }
    return false;
  }
}

/** İşlemciyi eski izden ve onun hedefinden ayırır. */
function baglantiyiSok(): void {
  try {
    bagliIz?.unpipe();
    hazirIslemci?.unpipe();
  } catch {
    // iz kapanmış olabilir
  }
  bagliIz = null;
}

/** İz kapanmadan önce işlemciyi izden ayırır. */
export function arkaPlaniBirak(iz: ICameraVideoTrack | null): void {
  if (iz && bagliIz === iz) baglantiyiSok();
}
