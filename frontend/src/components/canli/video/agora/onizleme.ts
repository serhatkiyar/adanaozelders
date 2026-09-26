/**
 * Katılmadan önceki önizleme — Agora yerel izleri (join YOK, ücret yok),
 * cihaz listesi ve hoparlör testi.
 *
 * Önizleme ekranı `katiliyor` aşamasında izleri durdurur (`durdur`); oda
 * kendi izlerini katıldıktan sonra yeniden kurar. Görüntü ve ses AYRI
 * sıralarda: bir izin sorusu öbürünü kilitlemesin.
 *
 * Kamera kabının içine SDK kendi oynatıcısını koyar; ayna `play(el, { mirror })`.
 */
import type { ICameraVideoTrack, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";

import type { ArkaPlan } from "../arkaPlan";
import type { HamCihaz, KameraSecenekleri, VideoSurucusu } from "../tipler";
import { arkaPlaniBirak, arkaPlaniUygula, masaustuChromium } from "./arkaPlan";
import { seviyeOrani } from "./cevir";
import { cihazListesi, kameraOlustur, mikrofonOlustur } from "./istemci";

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

/* ── Görüntü ─────────────────────────────────────────────────────────── */

let iz: ICameraVideoTrack | null = null;
let kap: HTMLElement | null = null;
let secenek: KameraSecenekleri | null = null;

function izKapat(): void {
  const eski = iz;
  iz = null;
  if (!eski) return;
  arkaPlaniBirak(eski);
  try {
    eski.close();
  } catch {
    // zaten kapalı
  }
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
    const yeni = await kameraOlustur({ kameraId: o.kameraId });
    iz = yeni;
    hedef.replaceChildren();
    yeni.play(hedef, { mirror: o.ayna, fit: "cover" });
    uygulandi = await arkaPlaniUygula(yeni, o.arkaPlan);
  }).then(() => ({ arkaPlanUygulandi: uygulandi }));
}

function arkaPlanDegistir(ap: ArkaPlan): Promise<{ uygulandi: boolean }> {
  let uygulandi = true;
  return videoSirasi(async () => {
    if (!secenek) return;
    secenek = { ...secenek, arkaPlan: ap };
    if (iz) uygulandi = await arkaPlaniUygula(iz, ap);
  }).then(() => ({ uygulandi }));
}

function kameraSec(kameraId: string): Promise<void> {
  return videoSirasi(async () => {
    if (secenek) secenek = { ...secenek, kameraId };
    if (iz) await iz.setDevice(kameraId);
  });
}

function kameraDurdur(): Promise<void> {
  return videoSirasi(async () => {
    izKapat();
    kap?.replaceChildren();
    kap = null;
  });
}

/* ── Ses ─────────────────────────────────────────────────────────────── */

let sesIz: IMicrophoneAudioTrack | null = null;
let sesIzMikrofonu: string | undefined;

function sesKapat(): void {
  const eski = sesIz;
  sesIz = null;
  sesIzMikrofonu = undefined;
  try {
    eski?.close();
  } catch {
    // zaten kapalı
  }
}

/** Seviye çubuğu için mikrofonu yakalar; mikrofon değişince iz yeniden kurulur. */
function sesBaslat(mikrofonId?: string): Promise<void> {
  return sesSirasi(async () => {
    if (sesIz && sesIzMikrofonu === mikrofonId) return;
    sesKapat();
    sesIz = await mikrofonOlustur(mikrofonId);
    sesIzMikrofonu = mikrofonId;
  });
}

function sesDurdur(): Promise<void> {
  return sesSirasi(async () => sesKapat());
}

function seviye(): number {
  try {
    return seviyeOrani(sesIz?.getVolumeLevel() ?? 0);
  } catch {
    return 0;
  }
}

/* ── Hoparlör testi ──────────────────────────────────────────────────── */

/** İki notalı kısa zil; test süresince saniyede bir. */
const NOTALAR = [880, 660] as const;
const NOTA_SN = 0.18;
const TEKRAR = 4;

type SesBaglami = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/**
 * Seçili hoparlörden kısa bir zil çalar — ses dosyası YOK, Web Audio ile
 * üretilir. Çıkış cihazı seçimi yalnız masaüstü Chromium'da
 * (`AudioContext.setSinkId`); diğerlerinde varsayılan çıkış. Dönen
 * fonksiyon testi durdurur.
 */
function hoparloruDene(hoparlorId?: string): (() => void) | null {
  const Baglam =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Baglam) return null;
  let ctx: SesBaglami;
  try {
    ctx = new Baglam() as SesBaglami;
  } catch {
    return null;
  }
  if (hoparlorId && masaustuChromium() && typeof ctx.setSinkId === "function") {
    ctx.setSinkId(hoparlorId).catch(() => undefined);
  }
  const t0 = ctx.currentTime + 0.05;
  for (let tekrar = 0; tekrar < TEKRAR; tekrar++) {
    NOTALAR.forEach((frekans, i) => {
      const bas = t0 + tekrar + i * NOTA_SN;
      const osilator = ctx.createOscillator();
      const kazanc = ctx.createGain();
      osilator.type = "sine";
      osilator.frequency.value = frekans;
      kazanc.gain.setValueAtTime(0, bas);
      kazanc.gain.linearRampToValueAtTime(0.2, bas + 0.02);
      kazanc.gain.exponentialRampToValueAtTime(0.001, bas + NOTA_SN);
      osilator.connect(kazanc).connect(ctx.destination);
      osilator.start(bas);
      osilator.stop(bas + NOTA_SN + 0.02);
    });
  }
  void ctx.resume().catch(() => undefined);
  return () => {
    void ctx.close().catch(() => undefined);
  };
}

/* ── Cihaz listesi ve kapanış ────────────────────────────────────────── */

function cihazlariGetir(): Promise<HamCihaz[]> {
  return cihazListesi();
}

/** İki izi de durdurur; katılmadan önce BEKLENİR. */
async function durdur(): Promise<void> {
  await Promise.all([kameraDurdur(), sesDurdur()]);
}

export const agoraOnizleme: VideoSurucusu["onizleme"] = {
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
