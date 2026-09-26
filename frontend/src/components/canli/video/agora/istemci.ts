/**
 * Agora ana istemcisi (tekil), yerel izler ve sahnenin çizim yuvaları —
 * sürücü (`surucu.ts`), ekran paylaşımı (`ekran.ts`) ve medya katmanının
 * (`MedyaKatmani.tsx`) ortak parçası. Ham `agora-rtc-sdk-ng` yalnız
 * `video/agora/*` içinde import edilir (CanliDers tembel parçası).
 *
 * Çizim: medya katmanı yalnız boş yuva `div`lerini kaydeder ve sahnenin
 * nötr durumunu (karşı taraf, paylaşım, ayna) verir; hangi izin hangi
 * yuvada oynayacağına burada karar verilir. Aynı iz aynı yuvada aynı
 * aynayla oynuyorsa yeniden çalınmaz. Ayna yalnız kendi ön kameramda;
 * uzak izler ve kendi ekranım asla aynalanmaz.
 */
import AgoraRTC, {
  type ICameraVideoTrack,
  type IMicrophoneAudioTrack,
  type ILocalVideoTrack,
  type IRemoteVideoTrack,
} from "agora-rtc-sdk-ng";

import { tarayiciOrtami, telefonMu } from "@/lib/canliDers";

import { SurucuHatasi, type KatilimciId } from "../tipler";
import { EKRAN_EKI, izinReddiMi, kameraHataKodu } from "./cevir";

// Ayrıntılı SDK günlüğü konsola da Agora'ya da gitmez (Zoom'daki
// `isLogDetailed: false` kararıyla aynı).
try {
  AgoraRTC.setLogLevel(3);
  AgoraRTC.disableLogUpload();
} catch {
  // günlük ayarı yalnız gürültü içindir
}

export { AgoraRTC };

/** Ana istemci (kamera + mikrofon). Ekran paylaşımı ayrı istemcide (`ekran.ts`). */
export const istemci = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

/** Yerel izler: yalnız sürücü yazar. */
export const yerel: {
  mik: IMicrophoneAudioTrack | null;
  kam: ICameraVideoTrack | null;
  /** Kendi ekran paylaşımım (ikinci istemcide yayında). */
  ekran: ILocalVideoTrack | null;
  /** Kamera sahnede görünsün mü (kullanıcı açtı ve iz etkin). */
  kameraAcik: boolean;
  /** Ön kamera mı (arka kamera aynalanmaz). */
  onKamera: boolean;
} = { mik: null, kam: null, ekran: null, kameraAcik: false, onKamera: true };

/* ── İz oluşturma (oda ve önizleme ortak) ─────────────────────────────── */

/**
 * Kamera izi (720p). Arka kamerada `facingMode: environment`; telefonda
 * cihaz seçilmemişse ön kamera. `facingMode` ile `cameraId` birlikte
 * verilemez. Hata sınıflandırılır (`SurucuHatasi`), tanınmazsa ham fırlar.
 */
export async function kameraOlustur(o: {
  kameraId?: string;
  onKamera?: boolean;
}): Promise<ICameraVideoTrack> {
  const telefon = telefonMu(tarayiciOrtami());
  const kaynak =
    o.onKamera === false
      ? { facingMode: "environment" as const }
      : o.kameraId
        ? { cameraId: o.kameraId }
        : telefon
          ? { facingMode: "user" as const }
          : {};
  try {
    return await AgoraRTC.createCameraVideoTrack({ encoderConfig: "720p_1", ...kaynak });
  } catch (hata) {
    const kod = kameraHataKodu(hata);
    throw kod ? new SurucuHatasi(kod, hata) : hata;
  }
}

/** Mikrofon izi; izin reddi `SurucuHatasi("mikIzniYok")`. */
export async function mikrofonOlustur(mikId?: string): Promise<IMicrophoneAudioTrack> {
  try {
    return await AgoraRTC.createMicrophoneAudioTrack(mikId ? { microphoneId: mikId } : undefined);
  } catch (hata) {
    throw izinReddiMi(hata) ? new SurucuHatasi("mikIzniYok", hata) : hata;
  }
}

/** İzin istemeden cihaz listesi (adlar izin verildikten sonra dolar). */
export async function cihazListesi(): Promise<MediaDeviceInfo[]> {
  try {
    return await AgoraRTC.getDevices(true);
  } catch {
    try {
      return await navigator.mediaDevices.enumerateDevices();
    } catch {
      return [];
    }
  }
}

/** Yerel izin etkin cihaz kimliği (izden okunur). */
export function izCihazi(
  iz: { getMediaStreamTrack(): MediaStreamTrack } | null,
): string | undefined {
  if (!iz) return undefined;
  try {
    return iz.getMediaStreamTrack().getSettings().deviceId || undefined;
  } catch {
    return undefined;
  }
}

/* ── Sahne çizimi ────────────────────────────────────────────────────── */

export type Yuva = "ben" | "karsi" | "paylasim";

/** Medya katmanının verdiği nötr sahne durumu. */
export interface KatmanDurumu {
  karsiId: KatilimciId | null;
  aktifPaylasim: KatilimciId | null;
  benPaylasiyorum: boolean;
  ayna: boolean;
}

const yuvalar = new Map<Yuva, HTMLElement>();
const oynayan = new Map<
  Yuva,
  { iz: ILocalVideoTrack | IRemoteVideoTrack; ayna: boolean; el: HTMLElement }
>();
let katman: KatmanDurumu = {
  karsiId: null,
  aktifPaylasim: null,
  benPaylasiyorum: false,
  ayna: true,
};

function uzakVideo(uid: string | null): IRemoteVideoTrack | null {
  if (uid === null) return null;
  return istemci.remoteUsers.find((u) => String(u.uid) === uid)?.videoTrack ?? null;
}

function istenen(
  yuva: Yuva,
): { iz: ILocalVideoTrack | IRemoteVideoTrack; ayna: boolean; fit: "cover" | "contain" } | null {
  if (yuva === "ben") {
    const kam = yerel.kam;
    if (!kam || !yerel.kameraAcik || !kam.enabled) return null;
    return { iz: kam, ayna: katman.ayna && yerel.onKamera, fit: "cover" };
  }
  if (yuva === "karsi") {
    const iz = uzakVideo(katman.karsiId);
    return iz ? { iz, ayna: false, fit: "cover" } : null;
  }
  if (katman.benPaylasiyorum) {
    return yerel.ekran ? { iz: yerel.ekran, ayna: false, fit: "contain" } : null;
  }
  const iz = uzakVideo(katman.aktifPaylasim === null ? null : katman.aktifPaylasim + EKRAN_EKI);
  return iz ? { iz, ayna: false, fit: "contain" } : null;
}

function durdur(iz: ILocalVideoTrack | IRemoteVideoTrack) {
  try {
    iz.stop();
  } catch {
    // iz kapanmış olabilir
  }
}

/** Her yuvayı istenen izle eşitler; değişmeyen yuvaya dokunmaz. */
export function ciz(): void {
  for (const yuva of ["ben", "karsi", "paylasim"] as const) {
    const el = yuvalar.get(yuva) ?? null;
    const hedef = el ? istenen(yuva) : null;
    const simdiki = oynayan.get(yuva);
    if (
      simdiki &&
      hedef &&
      simdiki.el === el &&
      simdiki.iz === hedef.iz &&
      simdiki.ayna === hedef.ayna
    ) {
      continue;
    }
    if (simdiki) {
      oynayan.delete(yuva);
      durdur(simdiki.iz);
    }
    if (!el || !hedef) continue;
    try {
      hedef.iz.play(el, { mirror: hedef.ayna, fit: hedef.fit });
      oynayan.set(yuva, { iz: hedef.iz, ayna: hedef.ayna, el });
    } catch (hata) {
      console.warn("Agora play", hata);
    }
  }
}

/** Medya katmanı yuvayı kaydeder (`null`: söküldü). */
export function yuvaKaydet(yuva: Yuva, el: HTMLElement | null): void {
  if (el) yuvalar.set(yuva, el);
  else yuvalar.delete(yuva);
  ciz();
}

export function katmaniGuncelle(d: KatmanDurumu): void {
  katman = d;
  ciz();
}

/** Ayna tercihi sürücüden değişti (sahne yeniden çizilmeden de uygulanır). */
export function aynayiAyarla(ayna: boolean): void {
  if (katman.ayna === ayna) return;
  katman = { ...katman, ayna };
  ciz();
}

/** Ayrılınca: oynayan her şey durur (yuvalar kalıcıdır). */
export function cizimiSifirla(): void {
  for (const { iz } of oynayan.values()) durdur(iz);
  oynayan.clear();
}
