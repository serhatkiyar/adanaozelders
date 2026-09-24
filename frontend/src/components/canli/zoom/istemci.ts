/**
 * Zoom Video SDK istemci servisi — ham `@zoom/videosdk` YALNIZ burada ve
 * `onizleme.ts`te import edilir (CanliDers tembel parçası).
 *
 * ## Sözleşme (plan §2.2; eski toolkit odasının yedi maddesi korunur)
 *
 * 1. `createClient()` modül düzeyinde (SDK tekil nesne döndürür). `init`
 *    bir kez, bellekte tutulan söz ile; `tr-TR` reddedilirse `en-US`.
 *    Ardından `preloadDependentAssets()`.
 * 2. `join(oturum, token, ad, undefined, bostaKalmaDk)`.
 * 3. Ayrılma HER ZAMAN argümansız `leave()`. Argümanlı çağrı host için
 *    oturumu HERKESE bitirir; kullanıcı kararı (24 Eyl 2026): öğretmen dahil
 *    herkes yalnız kendisi ayrılır, ders karşı taraf için sürer.
 * 4. StrictMode: katılma yalnız kullanıcı tıklamasıyla olur; söküm yalnız
 *    `getSessionInfo().isInMeeting` iken ayrılır.
 * 5. Ayrılmada en çok 3 sn beklenir; `destroyClient` ayrılma sözü
 *    SONUÇLANINCA zincirlenir (zaman aşımında değil).
 * 6. Bizim ayrılmamız dışındaki kapanış (`connection-change` Closed/Fail)
 *    depoda `beklenmedikKapanis` olarak görünür.
 * 7. Kullanıcı olayları sinyaldir; liste her olayda yeniden okunur.
 */
import ZoomVideo, {
  MobileVideoFacingMode,
  VideoQuality,
  type VideoPlayer,
} from "@zoom/videosdk";

import type { ZoomDersTokenOut } from "@/types";

import {
  aktifKonusanlar,
  baglantiDegisti,
  cihazlarDegisti,
  cihazSecildi,
  gecerliCihazId,
  izinDegisti,
  katilimcilariEsitle,
  listeleriKur,
  mikIzniReddedildiMi,
  sesEngellendi,
  videoDurumuDegisti,
  type CihazTuru,
  type ZoomKullanici,
} from "./indirgeyiciler";
import { depoyaUygula, useOdaDeposu } from "./odaDeposu";
import { tercihleriOku, tercihleriYaz } from "./tercihler";

const istemci = ZoomVideo.createClient();

const AYRILMA_BEKLEME_MS = 3000;

let hazirlik: Promise<void> | null = null;

/** SDK "başarısız" sonucu reddetmeden, çözülmüş bir nesneyle de bildirebilir. */
function basarisizMi(sonuc: unknown): boolean {
  return typeof sonuc === "object" && sonuc !== null;
}

async function initDene(dil: string): Promise<boolean> {
  try {
    const sonuc = await istemci.init(dil, "Global", {
      patchJsMedia: true,
      stayAwake: true,
      // Sekme kapanınca/yenilenince yalnız AYRIL (bitirme değil).
      leaveOnPageUnload: true,
      // Firefox/SharedArrayBuffer'sız platformda da karşı taraf + kendi görüntün.
      enforceMultipleVideos: true,
      // Kullanıcı kararı (24 Eyl 2026): ayrıntılı istemci günlüğü Zoom'a gitmez.
      isLogDetailed: false,
    });
    return !basarisizMi(sonuc);
  } catch {
    return false;
  }
}

/** `init` — bir kez; önizleme ekranı açılır açılmaz çağrılır (WASM ön yükleme). */
export function hazirla(): Promise<void> {
  if (!hazirlik) {
    hazirlik = (async () => {
      const tamam = (await initDene("tr-TR")) || (await initDene("en-US"));
      if (!tamam) {
        hazirlik = null;
        throw new Error("Zoom istemcisi başlatılamadı");
      }
      try {
        ZoomVideo.preloadDependentAssets();
      } catch {
        // ön yükleme yalnız hız içindir
      }
    })();
  }
  return hazirlik;
}

function akis() {
  return istemci.getMediaStream();
}

function kullanicilariOku() {
  const liste = istemci.getAllUser() as unknown as ZoomKullanici[];
  const ben = istemci.getCurrentUserInfo() as unknown as ZoomKullanici | undefined;
  depoyaUygula((d) => katilimcilariEsitle(d, liste ?? [], ben));
}

export function oturumdaMi(): boolean {
  try {
    return Boolean(istemci.getSessionInfo()?.isInMeeting);
  } catch {
    return false;
  }
}

export async function katil(bilet: ZoomDersTokenOut, bostaKalmaDk: number): Promise<void> {
  await hazirla();
  const sonuc = await istemci.join(
    bilet.oturum_adi,
    bilet.token,
    bilet.kullanici_adi,
    undefined,
    bostaKalmaDk,
  );
  if (basarisizMi(sonuc)) throw sonuc;
  let coklu = true;
  try {
    coklu = akis().isSupportMultipleVideos();
  } catch {
    // okunamazsa varsayılan: aynı kap
  }
  depoyaUygula((d) => ({ ...d, cokluVideo: coklu, baglanti: "bagli" }));
  kullanicilariOku();
  cihazlariOku();
}

/* ── Cihazlar ────────────────────────────────────────────────────────── */

function kimlikOku(oku: () => string): string | undefined {
  try {
    return oku() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Oturumdaki cihaz listeleri ve etkin cihazlar → depo. Katılınca, ses ya da
 * kamera başlayınca (izin yeni verilmiş olabilir) ve `device-change`te.
 */
export function cihazlariOku(): void {
  let cihazlar;
  try {
    const a = akis();
    cihazlar = listeleriKur({
      mikrofon: a.getMicList() ?? [],
      hoparlor: a.getSpeakerList() ?? [],
      kamera: a.getCameraList() ?? [],
    });
  } catch {
    return;
  }
  const secili = {
    mikrofon: kimlikOku(() => akis().getActiveMicrophone()),
    hoparlor: kimlikOku(() => akis().getActiveSpeaker()),
    kamera: kimlikOku(() => akis().getActiveCamera()),
  };
  depoyaUygula((d) => cihazlarDegisti(d, cihazlar, secili));
}

/**
 * Tercihteki cihaz oturumun listesinde hâlâ varsa onun kimliği, yoksa
 * `undefined` (sistem varsayılanı): bayat kimlik katılma anında medyayı düşürür.
 */
function tercihEdilen(tur: CihazTuru): string | undefined {
  const t = tercihleriOku();
  const id = tur === "mikrofon" ? t.mikrofonId : tur === "hoparlor" ? t.hoparlorId : t.kameraId;
  return gecerliCihazId(id, useOdaDeposu.getState().cihazlar[tur]);
}

/** Hoparlör seçimi (`setSinkId`) yoksa (Safari/iOS) seçici gizlenir. */
export function hoparlorSecilebilir(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

function benimKaydim(): ZoomKullanici | undefined {
  return istemci.getCurrentUserInfo() as unknown as ZoomKullanici | undefined;
}

/** Ders içinde mikrofon değişimi: ses bağlantısı KOPMADAN `switchMicrophone`. */
export async function mikrofonSec(id: string): Promise<void> {
  if (benimKaydim()?.audio) {
    const sonuc = await akis().switchMicrophone(id);
    if (basarisizMi(sonuc)) throw sonuc;
  }
  tercihleriYaz({ mikrofonId: id });
  depoyaUygula((d) => cihazSecildi(d, "mikrofon", id));
}

export async function hoparlorSec(id: string): Promise<void> {
  if (benimKaydim()?.audio) {
    const sonuc = await akis().switchSpeaker(id);
    if (basarisizMi(sonuc)) throw sonuc;
  }
  tercihleriYaz({ hoparlorId: id });
  depoyaUygula((d) => cihazSecildi(d, "hoparlor", id));
}

/** Kamera açıksa hemen değişir; kapalıysa bir sonraki `startVideo`da kullanılır. */
export async function kameraSec(id: string): Promise<void> {
  if (benimKaydim()?.bVideoOn) {
    const sonuc = await akis().switchCamera(id);
    if (basarisizMi(sonuc)) throw sonuc;
  }
  tercihleriYaz({ kameraId: id });
  depoyaUygula((d) => cihazSecildi(d, "kamera", id));
}

/** Kendi görüntümü aynala (yalnız bende görünür). Arka kamera aynalanmaz. */
export async function aynala(ayna: boolean): Promise<void> {
  tercihleriYaz({ ayna });
  if (benimKaydim()?.bVideoOn && onKamera) {
    const sonuc = await akis().mirrorVideo(ayna);
    if (basarisizMi(sonuc)) throw sonuc;
  }
}

/**
 * Tarayıcı izin durumu (`navigator.permissions`) → depo. Desteği düzensiz
 * (Firefox/Safari ad tanımayabilir): hata durumu "bilinmiyor" bırakır.
 */
export function izinleriIzle(): () => void {
  const sokumler: Array<() => void> = [];
  let gecerli = true;
  const izle = async (ad: "camera" | "microphone") => {
    try {
      const durum = await navigator.permissions.query({ name: ad as PermissionName });
      if (!gecerli) return;
      const yaz = () => depoyaUygula((d) => izinDegisti(d, { name: ad, state: durum.state }));
      yaz();
      durum.addEventListener("change", yaz);
      sokumler.push(() => durum.removeEventListener("change", yaz));
    } catch {
      // desteklenmiyor
    }
  };
  void izle("camera");
  void izle("microphone");
  return () => {
    gecerli = false;
    for (const sok of sokumler) sok();
  };
}

/**
 * Olay köprüsü: Zoom olayları → saf indirgeyici → depo. Dönen fonksiyon
 * dinleyicileri söker (StrictMode'un kur-sök-kur döngüsü için).
 */
export function olaylariBagla(
  secenekler: { kapaliykenKonusma?: () => void } = {},
): () => void {
  let zamanlayici: number | undefined;
  // Olay anında kullanıcı listesi henüz güncellenmemiş olabilir; bir tur ertele.
  const kullaniciDegisti = () => {
    window.clearTimeout(zamanlayici);
    zamanlayici = window.setTimeout(kullanicilariOku, 0);
  };
  const videoDegisti = (olay: { action: "Start" | "Stop"; userId: number }) => {
    depoyaUygula((d) => videoDurumuDegisti(d, olay));
    kullaniciDegisti();
  };
  const baglanti = (olay: { state: string }) => depoyaUygula((d) => baglantiDegisti(d, olay));
  const konusan = (olay: Array<{ userId: number }>) =>
    depoyaUygula((d) => aktifKonusanlar(d, olay ?? []));
  const sesOtomatikBaslamadi = () => depoyaUygula((d) => sesEngellendi(d, true));
  const sesSeviyesi = (olay: { level: number }) =>
    useOdaDeposu.setState({ sesSeviyesi: olay?.level ?? 0 });
  const izin = (olay: { name: "camera" | "microphone"; state: string }) =>
    depoyaUygula((d) => izinDegisti(d, olay));
  const kapaliykenKonusma = () => secenekler.kapaliykenKonusma?.();

  const dinleyiciler: Array<[string, (yuk: never) => void]> = [
    ["user-added", kullaniciDegisti],
    ["user-removed", kullaniciDegisti],
    ["user-updated", kullaniciDegisti],
    ["peer-video-state-change", videoDegisti],
    ["connection-change", baglanti],
    ["active-speaker", konusan],
    ["auto-play-audio-failed", sesOtomatikBaslamadi],
    ["device-change", cihazlariOku],
    ["current-audio-level-change", sesSeviyesi],
    ["device-permission-change", izin],
    ["speaking-while-muted", kapaliykenKonusma],
  ];
  for (const [olay, dinleyici] of dinleyiciler) {
    istemci.on(olay, dinleyici as (yuk: unknown) => void);
  }
  return () => {
    window.clearTimeout(zamanlayici);
    for (const [olay, dinleyici] of dinleyiciler) {
      try {
        istemci.off(olay, dinleyici as (yuk: unknown) => void);
      } catch {
        // istemci zaten yok
      }
    }
  };
}

/* ── Medya ───────────────────────────────────────────────────────────── */

/**
 * Bilgisayar sesine bağlanır; `mute` ile mikrofon kapalı başlar.
 *
 * Mikrofon izni reddedildiyse (`AUDIO_CAPTURE_FAILED`) yalnız hoparlörle
 * bağlanır — karşı taraf yine duyulur — ve `"yalnizHoparlor"` döner. Diğer
 * hatalar (ör. kullanıcı etkinleşmesi kaybı) fırlatılır; "Sesi aç" onlar için.
 */
export async function sesiBaslat(mute: boolean): Promise<"tam" | "yalnizHoparlor"> {
  let hata: unknown;
  try {
    const sonuc = await akis().startAudio({
      mute,
      microphoneId: tercihEdilen("mikrofon"),
      speakerId: tercihEdilen("hoparlor"),
    });
    if (basarisizMi(sonuc)) hata = sonuc;
  } catch (e) {
    hata = e ?? new Error("startAudio");
  }
  if (hata === undefined) {
    depoyaUygula((d) => sesEngellendi(d, false));
    cihazlariOku();
    return "tam";
  }
  if (!mikIzniReddedildiMi(hata)) throw hata;
  console.warn("Zoom startAudio (mikrofon izni yok)", hata);
  const sonuc = await akis().startAudio({
    speakerOnly: true,
    speakerId: tercihEdilen("hoparlor"),
  });
  if (basarisizMi(sonuc)) throw sonuc;
  depoyaUygula((d) => sesEngellendi(d, false));
  cihazlariOku();
  return "yalnizHoparlor";
}

/**
 * "Sesi aç": tarayıcı sesi engellediyse kullanıcı hareketiyle yeniden dener.
 * Ses zaten bağlıysa (yalnız çalma engellendiyse) hareketin kendisi yeter.
 */
export async function sesiAc(mikAcik: boolean): Promise<void> {
  const ben = istemci.getCurrentUserInfo() as unknown as ZoomKullanici | undefined;
  if (!ben?.audio) {
    if ((await sesiBaslat(!mikAcik)) === "yalnizHoparlor") {
      useOdaDeposu.setState({ hata: "media.micNotGranted" });
    }
  } else {
    depoyaUygula((d) => sesEngellendi(d, false));
  }
  kullanicilariOku();
}

export async function mikrofonuDegistir(ac: boolean): Promise<void> {
  const ben = istemci.getCurrentUserInfo() as unknown as ZoomKullanici | undefined;
  if (!ben?.audio) {
    if ((await sesiBaslat(!ac)) === "yalnizHoparlor" && ac) throw new Error("mikrofon izni yok");
  } else {
    const sonuc = ac ? await akis().unmuteAudio() : await akis().muteAudio();
    if (basarisizMi(sonuc)) throw sonuc;
  }
  kullanicilariOku();
}

export async function kamerayiDegistir(ac: boolean): Promise<void> {
  const sonuc = ac
    ? await akis().startVideo({
        cameraId: tercihEdilen("kamera"),
        mirrored: onKamera && tercihleriOku().ayna,
      })
    : await akis().stopVideo();
  if (basarisizMi(sonuc)) throw sonuc;
  kullanicilariOku();
  if (ac) cihazlariOku();
}

let onKamera = true;

/** Telefonda ön/arka kamera. */
export async function kamerayiCevir(): Promise<void> {
  onKamera = !onKamera;
  const yon = onKamera ? MobileVideoFacingMode.User : MobileVideoFacingMode.Environment;
  const sonuc = await akis().switchCamera(yon);
  if (basarisizMi(sonuc)) {
    onKamera = !onKamera;
    throw sonuc;
  }
  // Arka kamera aynalanmaz; ön kamera tercihe göre.
  try {
    await akis().mirrorVideo(onKamera && tercihleriOku().ayna);
  } catch {
    // aynalama desteklenmiyorsa görüntü yine gelir
  }
}

/** Kalıcı `<video-player>`a çizim — ZoomVideoSahnesi'nin tek SDK kapısı. */
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

/* ── Ayrılma ─────────────────────────────────────────────────────────── */

let ayrilma: Promise<void> | null = null;

/**
 * YALNIZ kendini oturumdan çıkarır (host için de). En çok ~3 sn bekler;
 * `destroyClient` ayrılma sözü sonuçlanınca çalışır.
 */
export function ayril(): Promise<void> {
  // "Biz ayrılıyoruz" bayrağı leave'den ÖNCE: kendi Closed olayımız
  // "bağlantı koptu" sayılmasın.
  useOdaDeposu.setState({ ayriliyor: true });
  if (!oturumdaMi()) return Promise.resolve();
  if (!ayrilma) {
    // ARGÜMANSIZ — bkz. dosya başı madde 3.
    const cikis = istemci
      .leave()
      .then(() => undefined)
      .catch(() => undefined);
    void cikis.finally(() => {
      hazirlik = null;
      void ZoomVideo.destroyClient().catch(() => undefined);
    });
    ayrilma = Promise.race([
      cikis,
      new Promise<void>((coz) => window.setTimeout(coz, AYRILMA_BEKLEME_MS)),
    ]);
  }
  return ayrilma;
}
