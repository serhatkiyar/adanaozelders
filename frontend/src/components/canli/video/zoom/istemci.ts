/**
 * Zoom istemcisi (tekil) ve sahnenin çizim kapıları — sürücü
 * (`surucu.ts`) ile medya katmanının (`MedyaKatmani.tsx`) ortak parçası.
 * Ham `@zoom/videosdk` yalnız `video/zoom/*` içinde import edilir.
 */
import ZoomVideo, { VideoQuality, type VideoPlayer } from "@zoom/videosdk";

/** `createClient()` modül düzeyinde: SDK tekil nesne döndürür. */
export const istemci = ZoomVideo.createClient();

export function akis() {
  return istemci.getMediaStream();
}

/**
 * Zoom'un hata nesnesi (`ExecutedFailure`: `type` + `reason`). Tip tanımı
 * başarıda `''` der ama gerçekte `join` başarıda oturum bilgisi NESNESİ döner
 * (`bAICompanionMgr`, `bCanPinMultiVideo`…; canlı denemede görüldü, 24 Eyl
 * 2026) — "nesne = hata" varsayımı başarılı katılımı hata sayıyordu.
 */
export function basarisizMi(sonuc: unknown): boolean {
  if (typeof sonuc !== "object" || sonuc === null) return false;
  const s = sonuc as { type?: unknown; reason?: unknown };
  return typeof s.type === "string" && "reason" in s;
}

export function oturumdaMi(): boolean {
  try {
    return Boolean(istemci.getSessionInfo()?.isInMeeting);
  } catch {
    return false;
  }
}

/* ── Çoklu video (katılınca okunur) ─────────────────────────────────── */

let coklu = true;

/** Platform aynı kapta birden çok video çizebiliyor mu (`isSupportMultipleVideos`). */
export function cokluVideoMu(): boolean {
  return coklu;
}

export function cokluVideoyuOku(): void {
  try {
    coklu = akis().isSupportMultipleVideos();
  } catch {
    // okunamazsa varsayılan: aynı kap
    coklu = true;
  }
}

/* ── Sahne çizimi ────────────────────────────────────────────────────── */

/** Kalıcı `<video-player>`a çizim — medya katmanının tek SDK kapısı. */
export async function videoBagla(userId: number, oyuncu: HTMLElement): Promise<void> {
  if (!oturumdaMi()) return;
  try {
    await akis().attachVideo(userId, VideoQuality.Video_720P, oyuncu as VideoPlayer);
  } catch (hata) {
    console.warn("Zoom attachVideo", hata);
  }
}

export async function videoCoz(userId: number, oyuncu: HTMLElement): Promise<void> {
  if (!oturumdaMi()) return;
  try {
    await akis().detachVideo(userId, oyuncu as VideoPlayer);
  } catch {
    // oyuncu zaten boş
  }
}

/** Kendi paylaşımım `<video>` mu `<canvas>` mı ister (`isStartShareScreenWithVideoElement`). */
export function paylasimVideoOgesiIster(): boolean {
  try {
    return akis().isStartShareScreenWithVideoElement();
  } catch {
    return false;
  }
}

/** Sahnedeki kalıcı kendi-paylaşım öğesi (medya katmanı kaydeder). */
let paylasimOgesi: HTMLVideoElement | HTMLCanvasElement | null = null;

export function paylasimOgesiniKaydet(oge: HTMLVideoElement | HTMLCanvasElement | null): void {
  paylasimOgesi = oge;
}

export function kayitliPaylasimOgesi(): HTMLVideoElement | HTMLCanvasElement | null {
  return paylasimOgesi;
}

/** Karşı tarafın paylaşımını kalıcı `paylasim` kabındaki oyuncuya çizer. */
export async function paylasimBagla(userId: number, oyuncu: HTMLElement): Promise<void> {
  if (!oturumdaMi()) return;
  try {
    const sonuc = await akis().attachShareView(userId, oyuncu as VideoPlayer);
    if (basarisizMi(sonuc) && !(sonuc instanceof HTMLElement)) {
      console.warn("Zoom attachShareView", sonuc);
    }
  } catch (hata) {
    console.warn("Zoom attachShareView", hata);
  }
}

export async function paylasimCoz(userId: number, oyuncu: HTMLElement): Promise<void> {
  if (!oturumdaMi()) return;
  try {
    await akis().detachShareView(userId, oyuncu as VideoPlayer);
  } catch {
    // oyuncu zaten boş
  }
}
