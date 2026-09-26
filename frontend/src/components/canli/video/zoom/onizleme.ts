/**
 * Katılmadan önceki önizleme — `ZoomVideo.createLocalVideoTrack` /
 * `createLocalAudioTrack`, cihaz listesi ve hoparlör testi.
 *
 * Önizleme izleri derse girmeden ÖNCE durdurulup beklenmelidir: aksi hâlde
 * `startVideo` kamerayı meşgul bulur (iOS/Android'de VIDEO_CAMERA_IS_TAKEN)
 * ve açık kalan mikrofon yakalaması iOS'ta `startAudio`yu bozar.
 *
 * Görüntü ve ses AYRI sıralarda: izin sorusu açıkken bir sıra soru
 * yanıtlanana dek çözülmez; mikrofon sorusu kamerayı (ya da tersi)
 * kilitlemesin.
 *
 * Kamera önizlemesinin iç öğesini (`<video>` ya da arka planlıysa
 * `<canvas>`) ve aynasını burası kurar; önizleme ekranı yalnız kabı verir.
 */
import ZoomVideo, { type LocalAudioTrack, type LocalVideoTrack } from "@zoom/videosdk";

import type { ArkaPlan } from "../arkaPlan";
import type { HamCihaz, KameraSecenekleri, VideoSurucusu } from "../tipler";
import { arkaPlanAdresi } from "./arkaPlanAdresi";
import { seviyeOrani } from "./cevir";

/** İşlemler sıraya girer: hızlı aç/kapa ve StrictMode kur-sök-kur yarışmaz. */
function siraKur() {
  let islem: Promise<void> = Promise.resolve();
  return (is: () => Promise<void>): Promise<void> => {
    const sonraki = islem.then(is, is);
    islem = sonraki.catch(() => undefined);
    return sonraki;
  };
}

const videoSirasi = siraKur();
const sesSirasi = siraKur();

/** SDK önizleme çağrıları hatayı çözülmüş `Error` olarak da döndürebilir. */
async function dene(is: Promise<void | Error>): Promise<void> {
  const sonuc = await is;
  if (sonuc instanceof Error) throw sonuc;
}

export function ozellikDestekli(ad: string): boolean {
  try {
    return Boolean(ZoomVideo.checkFeatureRequirements()?.supportFeatures?.includes(ad));
  } catch {
    return false;
  }
}

/* ── Görüntü ─────────────────────────────────────────────────────────── */

let iz: LocalVideoTrack | null = null;
/** Önizlemenin kabı ve son seçenekleri (`<video>` ↔ canvas geçişinde iz yeniden kurulur). */
let kap: HTMLElement | null = null;
let secenek: KameraSecenekleri | null = null;
/** İz canvas'a mı çiziliyor (arka planlı)? SDK `<video>`a arka plan koymaz. */
let tuvalde = false;

/** Seçim canvas ister mi? Sanal arka plan yoksa (telefon) hep `<video>`. */
function tuvalGerekir(ap: ArkaPlan): boolean {
  return ap !== "yok" && ozellikDestekli("Virtual Background");
}

/**
 * Kabın içine taze öğe koyar (eskisi varsa söker). Arka planlı önizleme her
 * başlatmada YENİ bir canvas'a çizilir: SDK canvas'ı
 * `transferControlToOffscreen` ile devralır, bir canvas yalnız bir kez
 * devredilebilir (StrictMode'un kur-sök-kur döngüsü ve kamera aç/kapa).
 * Ayna CSS ile: yalnız bende görünür.
 */
function yeniOge(
  hedef: HTMLElement,
  tuval: boolean,
  ayna: boolean,
): HTMLVideoElement | HTMLCanvasElement {
  hedef.replaceChildren();
  const sinif = `h-full w-full object-cover${ayna ? " -scale-x-100" : ""}`;
  if (tuval) {
    const t = document.createElement("canvas");
    t.width = 1280;
    t.height = 720;
    t.className = sinif;
    hedef.appendChild(t);
    return t;
  }
  const v = document.createElement("video");
  v.autoplay = true;
  v.playsInline = true;
  v.muted = true;
  v.disablePictureInPicture = true;
  v.className = sinif;
  hedef.appendChild(v);
  return v;
}

/**
 * İzi kurar (sıra İÇİNDE çağrılır). Arka planla açılamazsa arka plansız
 * (taze canvas'ta) açılır ve `false` döner: kamera kapalı kalmasın.
 */
async function izKur(hedef: HTMLElement, o: KameraSecenekleri): Promise<boolean> {
  const baslat = async (tuval: boolean, imageUrl?: string) => {
    const oge = yeniOge(hedef, tuval, o.ayna);
    const yeni = ZoomVideo.createLocalVideoTrack(o.kameraId);
    iz = yeni;
    tuvalde = tuval;
    try {
      await dene(yeni.start(oge, imageUrl ? { imageUrl } : undefined));
    } catch (hata) {
      iz = null;
      await yeni.stop().catch(() => undefined);
      throw hata;
    }
  };
  if (!tuvalGerekir(o.arkaPlan)) {
    await baslat(false);
    return true;
  }
  try {
    await baslat(true, arkaPlanAdresi(o.arkaPlan));
    return true;
  } catch (hata) {
    console.warn("Zoom önizleme (arka plan)", hata);
    // Devredilmiş olabilecek canvas yeniden kullanılmaz: yerine taze kopya.
    await baslat(true);
    return false;
  }
}

async function izDurdur(): Promise<void> {
  const eski = iz;
  iz = null;
  if (eski) await eski.stop().catch(() => undefined);
}

function kameraBaslat(
  hedef: HTMLElement,
  o: KameraSecenekleri,
): Promise<{ arkaPlanUygulandi: boolean }> {
  let uygulandi = true;
  return videoSirasi(async () => {
    kap = hedef;
    secenek = o;
    if (iz) return;
    uygulandi = await izKur(hedef, o);
  }).then(() => ({ arkaPlanUygulandi: uygulandi }));
}

/**
 * Açık önizlemenin arka planı. İki arka plan arasında (ikisi de canvas'ta)
 * iz yeniden kurulmaz; `<video>` ↔ canvas geçişinde iz durdurulup yeni
 * öğede kurulur. Kamera kapalıysa seçim bir sonraki açılışta kullanılır.
 */
function arkaPlanDegistir(ap: ArkaPlan): Promise<{ uygulandi: boolean }> {
  let uygulandi = true;
  return videoSirasi(async () => {
    if (!secenek) return;
    const onceki = secenek.arkaPlan;
    secenek = { ...secenek, arkaPlan: ap };
    if (!iz || !kap || ap === onceki) return;
    if (tuvalGerekir(ap) === tuvalde) {
      if (tuvalde) await dene(iz.updateVirtualBackground(arkaPlanAdresi(ap)));
      return;
    }
    await izDurdur();
    uygulandi = await izKur(kap, secenek);
  }).then(() => ({ uygulandi }));
}

/** Önizleme açıkken kamerayı değiştirir (kapalıysa bir sonraki açılışta). */
function kameraSec(kameraId: string): Promise<void> {
  return videoSirasi(async () => {
    if (secenek) secenek = { ...secenek, kameraId };
    if (iz) await dene(iz.switchCamera(kameraId));
  });
}

/** Yalnız kamera önizlemesini durdurur (mikrofon seviyesi sürer); öğeyi söker. */
function kameraDurdur(): Promise<void> {
  return videoSirasi(async () => {
    await izDurdur();
    kap?.replaceChildren();
    kap = null;
  });
}

/* ── Ses ─────────────────────────────────────────────────────────────── */

let sesIz: LocalAudioTrack | null = null;
let sesIzMikrofonu: string | undefined;

/**
 * Seviye çubuğu için mikrofonu yakalar. Önizleme izinde `switchMicrophone`
 * yok: mikrofon değişince iz durdurulup yeni kimlikle yeniden kurulur.
 * `LocalAudioTrack` yinelenen `start`/`unmute`ta fırlatır; durum burada
 * tutulur ve seviye ölçer yalnız `unmute` sonrası vardır.
 */
function sesBaslat(mikrofonId?: string): Promise<void> {
  return sesSirasi(async () => {
    if (sesIz && sesIzMikrofonu === mikrofonId) return;
    if (sesIz) {
      const eski = sesIz;
      sesIz = null;
      await eski.stop().catch(() => undefined);
    }
    const yeni = ZoomVideo.createLocalAudioTrack(mikrofonId);
    try {
      await dene(yeni.start());
      await dene(yeni.unmute());
    } catch (hata) {
      await yeni.stop().catch(() => undefined);
      throw hata;
    }
    sesIz = yeni;
    sesIzMikrofonu = mikrofonId;
  });
}

function sesDurdur(): Promise<void> {
  return sesSirasi(async () => {
    const eski = sesIz;
    sesIz = null;
    sesIzMikrofonu = undefined;
    if (eski) await eski.stop().catch(() => undefined);
  });
}

/** Gösterime hazır seviye (0–1; ham RMS algısal ölçekle); iz yoksa 0. */
function seviye(): number {
  try {
    return seviyeOrani(sesIz?.getCurrentVolume() ?? 0);
  } catch {
    return 0;
  }
}

/* ── Hoparlör testi ──────────────────────────────────────────────────── */

// Test için BAŞLATILMAMIŞ bir ses izi yeter (mikrofon açılmaz).
let testIzi: LocalAudioTrack | null = null;

/**
 * Zoom'un örnek zil sesini seçili hoparlörden çalar. Tarayıcı
 * desteklemiyorsa ya da bir test zaten sürüyorsa `null`. Dönen
 * fonksiyon testi durdurur.
 */
function hoparloruDene(hoparlorId?: string): (() => void) | null {
  try {
    testIzi ??= ZoomVideo.createLocalAudioTrack();
    const test = testIzi.testSpeaker(hoparlorId ? { speakerId: hoparlorId } : undefined);
    if (!test) return null;
    return () => {
      try {
        test.stop();
        test.destroy();
      } catch {
        // zaten durdu
      }
    };
  } catch {
    return null;
  }
}

/* ── Cihaz listesi ───────────────────────────────────────────────────── */

/**
 * İZİN İSTEMEDEN cihaz listesi (`getDevices(true)`): argümansız çağrı
 * kamerayı/mikrofonu kısaca açar ve önizleme izi kamerayı tutarken
 * telefonda VIDEO_CAMERA_IS_TAKEN'a yol açar. Adlar izin verildikten
 * sonra dolar; liste izler başladıktan sonra yeniden okunur.
 */
async function cihazlariGetir(): Promise<HamCihaz[]> {
  try {
    return await ZoomVideo.getDevices(true);
  } catch {
    try {
      return await navigator.mediaDevices.enumerateDevices();
    } catch {
      return [];
    }
  }
}

/* ── Kapanış ─────────────────────────────────────────────────────────── */

/** İki izi de durdurur; katılmadan önce BEKLENİR. */
async function durdur(): Promise<void> {
  await Promise.all([kameraDurdur(), sesDurdur()]);
}

export const zoomOnizleme: VideoSurucusu["onizleme"] = {
  kameraBaslat,
  kameraSec,
  arkaPlan: arkaPlanDegistir,
  kameraDurdur,
  sesBaslat,
  sesDurdur,
  seviye,
  hoparloruDene,
  cihazlariGetir,
  durdur,
};
