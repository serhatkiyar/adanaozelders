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
 */
import ZoomVideo, { type LocalAudioTrack, type LocalVideoTrack } from "@zoom/videosdk";

import type { HamCihaz } from "./indirgeyiciler";

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

/* ── Görüntü ─────────────────────────────────────────────────────────── */

let iz: LocalVideoTrack | null = null;

/**
 * Kamera önizlemesi. `arkaPlan` (Zoom `imageUrl`: `'blur'` ya da görsel
 * adresi) verildiyse öğe `<canvas>` olmalı: SDK sanal arka planı yalnız
 * canvas/`video-player`a çizer. Arka planla açılamazsa arka plansız açılır
 * ve `false` döner (kamera kapalı kalmasın).
 */
export function onizlemeBaslat(
  oge: HTMLVideoElement | HTMLCanvasElement,
  kameraId?: string,
  arkaPlan?: string,
): Promise<boolean> {
  let uygulandi = true;
  return videoSirasi(async () => {
    if (iz) return;
    const baslat = async (vb?: string) => {
      const yeni = ZoomVideo.createLocalVideoTrack(kameraId);
      iz = yeni;
      try {
        await dene(yeni.start(oge, vb ? { imageUrl: vb } : undefined));
      } catch (hata) {
        iz = null;
        await yeni.stop().catch(() => undefined);
        throw hata;
      }
    };
    if (!arkaPlan) return baslat();
    try {
      await baslat(arkaPlan);
    } catch (hata) {
      console.warn("Zoom önizleme (arka plan)", hata);
      uygulandi = false;
      await baslat();
    }
  }).then(() => uygulandi);
}

/** Açık önizlemenin arka planını değiştirir (`undefined`: kaldırır). */
export function onizlemeArkaPlan(arkaPlan: string | undefined): Promise<void> {
  return videoSirasi(async () => {
    if (iz) await dene(iz.updateVirtualBackground(arkaPlan));
  });
}

/** Önizleme açıkken kamerayı değiştirir (kapalıysa bir sonraki açılışta). */
export function onizlemeKameraSec(kameraId: string): Promise<void> {
  return videoSirasi(async () => {
    if (iz) await dene(iz.switchCamera(kameraId));
  });
}

/** Yalnız kamera önizlemesini durdurur (mikrofon seviyesi sürer). */
export function kameraOnizlemeDurdur(): Promise<void> {
  return videoSirasi(async () => {
    const eski = iz;
    iz = null;
    if (eski) await eski.stop().catch(() => undefined);
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
export function sesOnizlemeBaslat(mikrofonId?: string): Promise<void> {
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

export function sesOnizlemeDurdur(): Promise<void> {
  return sesSirasi(async () => {
    const eski = sesIz;
    sesIz = null;
    sesIzMikrofonu = undefined;
    if (eski) await eski.stop().catch(() => undefined);
  });
}

/** Anlık ham seviye (RMS, 0–1); iz yoksa 0. */
export function onizlemeSeviyesi(): number {
  try {
    return sesIz?.getCurrentVolume() ?? 0;
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
export function hoparloruDene(hoparlorId?: string): (() => void) | null {
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
export async function cihazlariGetir(): Promise<HamCihaz[]> {
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
export async function onizlemeDurdur(): Promise<void> {
  await Promise.all([kameraOnizlemeDurdur(), sesOnizlemeDurdur()]);
}
