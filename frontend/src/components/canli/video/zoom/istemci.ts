/**
 * Zoom istemcisi (tekil) ve sahnenin çizim kapıları — sürücü
 * (`surucu.ts`) ile medya katmanının (`MedyaKatmani.tsx`) ortak parçası.
 * Ham `@zoom/videosdk` yalnız `video/zoom/*` içinde import edilir.
 */
import ZoomVideo, { VideoQuality, type VideoPlayer } from "@zoom/videosdk";

import type { VideoKalitesi } from "@/lib/kameraKutusu";

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

/**
 * Zoom'a özel kalite: nötr kaliteler + `gizli` (gizlenen karşı karo). Gizli
 * karo ÇÖZÜLMEZ, en düşük kaliteye (90P) iner — bkz. `videoCoz`.
 */
export type ZoomKalitesi = VideoKalitesi | "gizli";

/** Kalite → Zoom kalitesi (gizli 90P, küçük karo 180P, orta 360P, büyük 720P). */
export function kaliteCevir(k: ZoomKalitesi): VideoQuality {
  if (k === "gizli") return VideoQuality.Video_90P;
  if (k === "dusuk") return VideoQuality.Video_180P;
  if (k === "orta") return VideoQuality.Video_360P;
  return VideoQuality.Video_720P;
}

/**
 * OYUNCU (öğe) başına sıralı iş kuyruğu: hızlı gizle/göster ve kalite
 * değişiminde `attachVideo`/`detachVideo` üst üste binmesin. Anahtar öğedir,
 * kullanıcı değil: karşı taraf yenileyip YENİ `userId` ile dönünce eski
 * kimliğin `detachVideo`'su bitmeden yeni kimliğin `attachVideo`'su aynı
 * öğede başlamasın. Oturum kontrolü iş SIRASI gelince yapılır.
 */
const kuyruk = new Map<HTMLElement, Promise<void>>();

function sirala(oyuncu: HTMLElement, is: () => Promise<void>): Promise<void> {
  const onceki = kuyruk.get(oyuncu) ?? Promise.resolve();
  const sonraki = onceki
    .catch(() => undefined)
    .then(() => (oturumdaMi() ? is() : undefined));
  kuyruk.set(oyuncu, sonraki);
  void sonraki.finally(() => {
    if (kuyruk.get(oyuncu) === sonraki) kuyruk.delete(oyuncu);
  });
  return sonraki;
}

const YENIDEN_DENEME_MS = 300;

async function bagla(userId: number, oyuncu: HTMLElement, kalite: ZoomKalitesi): Promise<void> {
  const nitelik = kaliteCevir(kalite);
  for (let deneme = 0; deneme < 2; deneme++) {
    try {
      const sonuc = await akis().attachVideo(userId, nitelik, oyuncu as VideoPlayer);
      if (!basarisizMi(sonuc) || sonuc instanceof HTMLElement) return;
      console.warn("Zoom attachVideo", sonuc);
    } catch (hata) {
      console.warn("Zoom attachVideo", hata);
    }
    // Ayrılmadan hemen sonra bağlama bazen reddediliyor: bir kez yeniden dene.
    if (deneme === 0) await new Promise((r) => setTimeout(r, YENIDEN_DENEME_MS));
    if (!oturumdaMi()) return;
  }
}

/** Kalıcı `<video-player>`a çizim — medya katmanının tek SDK kapısı. */
export function videoBagla(
  userId: number,
  oyuncu: HTMLElement,
  kalite: ZoomKalitesi = "yuksek",
): Promise<void> {
  return sirala(oyuncu, () => bagla(userId, oyuncu, kalite));
}

/**
 * Oyuncuyu çözer. YALNIZ karşı kişi ayrılınca / kamerasını kapatınca ya da
 * sahne kalkınca kullanılır; GİZLEMEK için kullanılmaz. SDK'da son oyuncu
 * çözülünce karşı taraf için `unsubscribeVideo` çağrılır; gizle/göster ile
 * bu yol tekrarlanınca iki yönde video akışı çöküyor, ancak sayfa yenilenince
 * düzeliyordu (Zoom, 27 Eyl 2026 uçtan uca ölçüm). Gizli karo bağlı kalır,
 * kalitesi `kaliteDegistir(…, "gizli")` ile 90P'ye iner.
 */
export function videoCoz(userId: number, oyuncu: HTMLElement): Promise<void> {
  return sirala(oyuncu, async () => {
    try {
      await akis().detachVideo(userId, oyuncu as VideoPlayer);
    } catch {
      // oyuncu zaten boş
    }
  });
}

/**
 * Bağlı oyuncunun kalitesini değiştirir: AYNI öğeye yeniden `attachVideo`.
 * SDK (2.5.0 paket kodu) öğe o kullanıcıya zaten bağlıysa `video-quality`
 * niteliğini günceller ve `subscribeVideo(userId, kalite)` ile aboneliği yeni
 * kaliteye çevirir; çözme/yeniden bağlama YAPILMAZ (çöküş yolu, bkz. `videoCoz`).
 */
export function kaliteDegistir(
  userId: number,
  oyuncu: HTMLElement,
  kalite: ZoomKalitesi,
): Promise<void> {
  return videoBagla(userId, oyuncu, kalite);
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

/* ── Karşı paylaşımın içerik boyutu ─────────────────────────────────── */

let karsiPaylasimOlcusu: { w: number; h: number } | null = null;
const paylasimBoyutuDinleyicileri = new Set<() => void>();

/** `share-content-dimension-change` ("received"); paylaşım bitince `null`. */
export function karsiPaylasimBoyutuAyarla(o: { w: number; h: number } | null): void {
  const onceki = karsiPaylasimOlcusu;
  if (o === onceki || (o && onceki && o.w === onceki.w && o.h === onceki.h)) return;
  karsiPaylasimOlcusu = o;
  for (const d of paylasimBoyutuDinleyicileri) d();
}

export function karsiPaylasimBoyutu(): { w: number; h: number } | null {
  return karsiPaylasimOlcusu;
}

export function karsiPaylasimBoyutuDinle(d: () => void): () => void {
  paylasimBoyutuDinleyicileri.add(d);
  return () => paylasimBoyutuDinleyicileri.delete(d);
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
