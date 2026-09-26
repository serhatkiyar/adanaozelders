/**
 * Ekran paylaşımı — İKİNCİ Agora istemcisi. Bir istemci aynı anda tek video
 * izi yayınlar; kamera ana istemcide kalır, ekran `{uid}-ekran` uid'iyle ve
 * sunucunun verdiği ayrı token'la bu istemciden yayınlanır.
 *
 * - 720p / 15 fps, `detail` (yazı keskin kalsın): 1080p varsayılanı kamerayla
 *   birlikte izlenince fiyat kademesini 2K'ya çıkarırdı.
 * - Bu istemci HİÇBİR ŞEYE abone olmaz (`autoSubscribe` varsayılan kapalı,
 *   yayın dinleyicisi yok); ana istemci de kendi ekran uid'ime abone olmaz.
 * - Tarayıcının "Paylaşımı durdur"u `track-ended` → `bitti`.
 */
import type { IAgoraRTCClient, ILocalVideoTrack } from "agora-rtc-sdk-ng";

import type { AgoraDersTokenOut } from "@/types";

import { SurucuHatasi } from "../tipler";
import { paylasimHataKodu } from "./cevir";
import { AgoraRTC, yerel } from "./istemci";

let ekranIstemci: IAgoraRTCClient | null = null;
let durdurma: Promise<void> | null = null;

function ekranIstemcisi(bitti: () => void): IAgoraRTCClient {
  if (!ekranIstemci) {
    ekranIstemci = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    // Token yenilemesi ana istemcinin `biletSonu` yolundan (`ekranBileTazele`);
    // yine de süresi dolarsa paylaşım durur.
    ekranIstemci.on("token-privilege-did-expire", () => {
      void paylasimiDurdur().then(bitti);
    });
  }
  return ekranIstemci;
}

export function paylasiyorMu(): boolean {
  return yerel.ekran !== null;
}

/**
 * Ekran seçiciyi açar, ikinci istemciyle katılıp yayınlar. Vazgeçme/ret
 * `SurucuHatasi` (`paylasimIptal` / `paylasimReddedildi`) olarak fırlar.
 * `bitti`: paylaşım DIŞARIDAN durdu (tarayıcı düğmesi, token).
 */
export async function paylasimiBaslat(ab: AgoraDersTokenOut, bitti: () => void): Promise<void> {
  if (yerel.ekran) return;
  let iz: ILocalVideoTrack;
  try {
    iz = await AgoraRTC.createScreenVideoTrack(
      { encoderConfig: "720p_3", optimizationMode: "detail" },
      "disable",
    );
  } catch (hata) {
    const kod = paylasimHataKodu(hata);
    throw kod ? new SurucuHatasi(kod, hata) : hata;
  }
  const istemci = ekranIstemcisi(bitti);
  try {
    await istemci.join(ab.app_id, ab.kanal, ab.ekran.token, ab.ekran.uid);
    await istemci.publish(iz);
  } catch (hata) {
    iz.close();
    await istemci.leave().catch(() => undefined);
    throw hata;
  }
  iz.on("track-ended", () => {
    void paylasimiDurdur().then(bitti);
  });
  yerel.ekran = iz;
}

/** Paylaşımı bitirir: iz kapanır, ikinci istemci kanaldan çıkar. Tekrar çağrılabilir. */
export function paylasimiDurdur(): Promise<void> {
  const iz = yerel.ekran;
  if (!iz) return durdurma ?? Promise.resolve();
  yerel.ekran = null;
  durdurma = (async () => {
    try {
      iz.close();
    } catch {
      // zaten kapalı
    }
    await ekranIstemci?.leave().catch(() => undefined);
  })().finally(() => {
    durdurma = null;
  });
  return durdurma;
}

/** Paylaşım sürüyorsa ikinci istemcinin token'ını yeniler. */
export async function ekranBileTazele(token: string): Promise<void> {
  if (!yerel.ekran || !ekranIstemci || ekranIstemci.connectionState !== "CONNECTED") return;
  await ekranIstemci.renewToken(token);
}

/** Kendi paylaşımım tüm ekran mı? İzin ayarı/kısıtı/etiketi (`tumEkranPaylasimiMi`). */
export function paylasimYuzeyi(): {
  displaySurface?: string;
  kisitYuzeyi?: string;
  etiket?: string;
} | null {
  const iz = yerel.ekran?.getMediaStreamTrack();
  if (!iz) return null;
  return {
    displaySurface: (iz.getSettings() as { displaySurface?: string }).displaySurface,
    kisitYuzeyi: (iz.getConstraints() as { displaySurface?: string }).displaySurface,
    etiket: iz.label,
  };
}
