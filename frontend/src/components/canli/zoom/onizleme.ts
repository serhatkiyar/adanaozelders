/**
 * Katılmadan önceki kamera önizlemesi — `ZoomVideo.createLocalVideoTrack`.
 *
 * Önizleme izi derse girmeden ÖNCE durdurulup beklenmelidir: aksi hâlde
 * `startVideo` kamerayı meşgul bulur (iOS/Android'de VIDEO_CAMERA_IS_TAKEN).
 * Mikrofon önizlemesi (seviye çubuğu, cihaz seçimi) Paket 2'de.
 */
import ZoomVideo, { type LocalVideoTrack } from "@zoom/videosdk";

let iz: LocalVideoTrack | null = null;
let islem: Promise<void> = Promise.resolve();

/** İşlemler sıraya girer: hızlı aç/kapa ve StrictMode kur-sök-kur yarışmaz. */
function sirala(is: () => Promise<void>): Promise<void> {
  const sonraki = islem.then(is, is);
  islem = sonraki.catch(() => undefined);
  return sonraki;
}

export function onizlemeBaslat(video: HTMLVideoElement): Promise<void> {
  return sirala(async () => {
    if (iz) return;
    const yeni = ZoomVideo.createLocalVideoTrack();
    iz = yeni;
    try {
      const sonuc = await yeni.start(video);
      if (sonuc instanceof Error) throw sonuc;
    } catch (hata) {
      iz = null;
      await yeni.stop().catch(() => undefined);
      throw hata;
    }
  });
}

export function onizlemeDurdur(): Promise<void> {
  return sirala(async () => {
    const eski = iz;
    iz = null;
    if (eski) await eski.stop().catch(() => undefined);
  });
}
