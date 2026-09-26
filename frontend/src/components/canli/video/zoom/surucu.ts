/**
 * Zoom Video SDK sürücüsü — `VideoSurucusu` (`../tipler.ts`) uygulaması.
 * Ham `@zoom/videosdk` YALNIZ `video/zoom/*` içinde import edilir
 * (CanliDers tembel parçası, `../yukle.ts`).
 *
 * KURAL: bu dosya depo, tercih ve i18n import ETMEZ; olay yayar ve sonuç
 * döndürür. Depoya yazan nötr katmandır (`oda/durum/olayBagla.ts`, `medya.ts`).
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
 *    `baglanti: kapandi` olarak bildirilir; "biz ayrılıyoruz" bayrağını nötr
 *    katman `ayril()`dan ÖNCE yazar.
 * 7. Kullanıcı olayları sinyaldir; liste her olayda yeniden okunur.
 *
 * Tepki ve el kaldırma burada YOK: taşıyıcı Centrifugo (`oda/durum/tepkiler.ts`).
 */
import ZoomVideo, { MobileVideoFacingMode } from "@zoom/videosdk";

import type { ZoomDersTokenOut } from "@/types";

import { tumEkranPaylasimiMi } from "@/lib/canliDers";

import type { ArkaPlan } from "../arkaPlan";
import type {
  Cihazlar,
  DersRolu,
  HamKatilimci,
  KameraSecenekleri,
  SesSecenekleri,
  VideoOlayi,
  VideoSurucusu,
} from "../tipler";
import { arkaPlanAdresi } from "./arkaPlanAdresi";
import {
  baglantiDurumu,
  kimlik,
  listeyiCevir,
  sesIstatistigiSeviyesi,
  type ZoomKullanici,
} from "./cevir";
import {
  akis,
  basarisizMi,
  cokluVideoyuOku,
  istemci,
  kayitliPaylasimOgesi,
  oturumdaMi,
} from "./istemci";
import { MedyaKatmani } from "./MedyaKatmani";
import { ozellikDestekli, zoomOnizleme } from "./onizleme";

const AYRILMA_BEKLEME_MS = 3000;

let hazirlik: Promise<void> | null = null;

/* ── Olay yayını ─────────────────────────────────────────────────────── */

const dinleyiciler = new Set<(o: VideoOlayi) => void>();

function yay(o: VideoOlayi): void {
  for (const f of dinleyiciler) f(o);
}

/** Biletteki kendi rolüm (katılımcıların `rol` alanı buradan türer). */
let benimRolum: DersRolu | null = null;

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
function hazirla(): Promise<void> {
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

function benimKaydim(): ZoomKullanici | undefined {
  return istemci.getCurrentUserInfo() as unknown as ZoomKullanici | undefined;
}

function listeyiOku(): HamKatilimci[] {
  const liste = (istemci.getAllUser() as unknown as ZoomKullanici[]) ?? [];
  return listeyiCevir(liste, benimKaydim(), benimRolum);
}

function kullanicilariOku(): HamKatilimci[] {
  const liste = listeyiOku();
  yay({ t: "katilimcilar", liste });
  agKaliteleriniOku(liste);
  return liste;
}

/**
 * Olay kaçtıysa (katılmadan önce başlamış paylaşım) SDK'nın o anki paylaşımı.
 * YALNIZ katılınca ve yeniden bağlanınca: her kullanıcı olayında okunursa
 * `sharerOn` `active-share-change`ten önce gelip paylaşım erken (çizilemezken)
 * bağlanır, asıl olay aynı kimlikle gelince de yeniden denenmez.
 */
function paylasimiOku() {
  let aktifId = 0;
  try {
    aktifId = akis().getActiveShareUserId() || 0;
  } catch {
    return;
  }
  yay({ t: "paylasim", id: aktifId ? kimlik(aktifId) : null, esitle: true });
}

/**
 * `network-quality-change` yalnız DEĞİŞİMDE gelir: katılınca, kamera yeniden
 * açılınca ya da yeni `userId` ile dönünce seviye aynıysa olay gelmez. Liste
 * her okunduğunda kamerası açık herkesin güncel değeri SDK'dan okunur.
 */
function agKaliteleriniOku(liste: readonly HamKatilimci[]) {
  for (const k of liste) {
    if (!k.videoAcik) continue;
    let olcum;
    try {
      olcum = akis().getNetworkQuality(Number(k.id));
    } catch {
      continue;
    }
    const yukari = typeof olcum?.uplink === "number" ? olcum.uplink : undefined;
    const asagi = typeof olcum?.downlink === "number" ? olcum.downlink : undefined;
    if (yukari !== undefined || asagi !== undefined) yay({ t: "ag", id: k.id, yukari, asagi });
  }
}

/**
 * Kendi ses bağlantımın istatistiği (`audio-statistic-data-change`, saniyede
 * bir). Kamera kapalıyken kendi kartımın bağlantı göstergesi buradan gelir.
 * Ses bağlanınca ve yeniden bağlanınca abone olunur; hata yalnız göstergeyi
 * gizli bırakır.
 */
async function sesIstatistigineAbone(): Promise<void> {
  try {
    const sonuc = await akis().subscribeAudioStatisticData();
    if (basarisizMi(sonuc)) console.warn("Zoom subscribeAudioStatisticData", sonuc);
  } catch (e) {
    console.warn("Zoom subscribeAudioStatisticData", e);
  }
}

/** Bu kadar süre yeni istatistik gelmezse (sustu / karşı taraf sustu) değer silinir. */
const SES_ISTATISTIGI_ESKIME_MS = 5000;

async function katil(
  bilet: Parameters<VideoSurucusu["katil"]>[0],
  s: Parameters<VideoSurucusu["katil"]>[1],
): Promise<{ benId: string; ilk: HamKatilimci[] }> {
  await hazirla();
  const zb = bilet.ham as ZoomDersTokenOut;
  benimRolum = bilet.rol;
  const sonuc = await istemci.join(
    zb.oturum_adi,
    zb.token,
    zb.kullanici_adi,
    undefined,
    s.bostaKalmaDk,
  );
  if (basarisizMi(sonuc)) throw sonuc;
  cokluVideoyuOku();
  sonBaglanti = "bagli";
  yay({ t: "baglanti", durum: "bagli" });
  const ilk = kullanicilariOku();
  paylasimiOku();
  yay({ t: "cihazlarDegisti" });
  const ben = benimKaydim();
  return { benId: ben ? kimlik(ben.userId) : (ilk.find((k) => k.ben)?.id ?? ""), ilk };
}

/* ── Cihazlar ────────────────────────────────────────────────────────── */

function kimlikOku(oku: () => string): string | undefined {
  try {
    return oku() || undefined;
  } catch {
    return undefined;
  }
}

/** Oturumdaki ham cihaz listeleri ve etkin cihazlar; okunamazsa `null`. */
function cihazlar(): Cihazlar | null {
  let listeler: Cihazlar["listeler"];
  try {
    const a = akis();
    listeler = {
      mikrofon: a.getMicList() ?? [],
      hoparlor: a.getSpeakerList() ?? [],
      kamera: a.getCameraList() ?? [],
    };
  } catch {
    return null;
  }
  return {
    listeler,
    secili: {
      mikrofon: kimlikOku(() => akis().getActiveMicrophone()),
      hoparlor: kimlikOku(() => akis().getActiveSpeaker()),
      kamera: kimlikOku(() => akis().getActiveCamera()),
    },
  };
}

/** Hoparlör seçimi (`setSinkId`) yoksa (Safari/iOS) seçici gizlenir. */
function hoparlorSecilebilir(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/**
 * Ders içinde cihaz değişimi. Mikrofon ses bağlantısı KOPMADAN
 * `switchMicrophone`; kapalı olan cihaz bir sonraki başlatmada kullanılır.
 */
async function cihazSec(tur: "mikrofon" | "hoparlor" | "kamera", id: string): Promise<void> {
  const ben = benimKaydim();
  let sonuc: unknown;
  if (tur === "mikrofon") {
    // Yalnız hoparlörde değiştirilecek mikrofon yok; seçim sonraki `startAudio`da.
    if (ben?.audio && !ben.isSpeakerOnly) sonuc = await akis().switchMicrophone(id);
  } else if (tur === "hoparlor") {
    if (ben?.audio) sonuc = await akis().switchSpeaker(id);
  } else {
    sonKamera = { ...sonKamera, kameraId: id };
    if (ben?.bVideoOn) sonuc = await akis().switchCamera(id);
  }
  if (basarisizMi(sonuc)) throw sonuc;
}

/** Kendi görüntümü aynala (yalnız bende görünür). Arka kamera aynalanmaz. */
async function aynala(ayna: boolean): Promise<void> {
  sonKamera = { ...sonKamera, ayna };
  if (benimKaydim()?.bVideoOn && onKamera) {
    const sonuc = await akis().mirrorVideo(ayna);
    if (basarisizMi(sonuc)) throw sonuc;
  }
}

/* ── Olay köprüsü ────────────────────────────────────────────────────── */

let sonBaglanti: "bagli" | "yenidenBaglaniyor" | "kapandi" | null = null;

/**
 * Zoom olayları → nötr olaylar. İlk dinleyici gelince SDK'ya bağlanır, son
 * dinleyici gidince söker (StrictMode'un kur-sök-kur döngüsü için).
 */
function sdkyaBaglan(): () => void {
  let zamanlayici: number | undefined;
  // Olay anında kullanıcı listesi henüz güncellenmemiş olabilir; bir tur ertele.
  const kullaniciDegisti = () => {
    window.clearTimeout(zamanlayici);
    zamanlayici = window.setTimeout(kullanicilariOku, 0);
  };
  // Liste yeniden okunana dek iyimser güncelleme; kapanan kameranın eski
  // ağ ölçümü atılır.
  const videoDegisti = (olay: { action: "Start" | "Stop"; userId: number }) => {
    const id = kimlik(olay.userId);
    const videoAcik = olay.action === "Start";
    if (!videoAcik) yay({ t: "ag", id, yukari: null, asagi: null });
    try {
      yay({
        t: "katilimcilar",
        liste: listeyiOku().map((k) => (k.id === id ? { ...k, videoAcik } : k)),
      });
    } catch {
      // liste okunamadı: ertelenen okuma düzeltir
    }
    kullaniciDegisti();
  };
  const baglanti = (olay: { state: string }) => {
    const durum = baglantiDurumu(olay.state);
    if (!durum) return;
    const onceki = sonBaglanti;
    sonBaglanti = durum;
    yay({ t: "baglanti", durum });
    // Yeniden bağlanınca kimlikler/durumlar değişmiş olabilir: listeyi tazele.
    if (onceki === "yenidenBaglaniyor" && durum === "bagli") {
      kullaniciDegisti();
      window.setTimeout(paylasimiOku, 0);
      void sesIstatistigineAbone();
    }
  };
  const agKalitesi = (olay: { userId: number; type: string; level: number }) => {
    if (!Number.isFinite(olay.level)) return;
    const id = kimlik(olay.userId);
    if (olay.type === "uplink") yay({ t: "ag", id, yukari: olay.level });
    else if (olay.type === "downlink") yay({ t: "ag", id, asagi: olay.level });
  };
  const sesKalitesi: { encode: number | null; decode: number | null } = {
    encode: null,
    decode: null,
  };
  const eskime: { encode?: number; decode?: number } = {};
  const sesIstatistigi = (olay: {
    data?: { encoding?: boolean; rtt?: number; jitter?: number; sample_rate?: number };
  }) => {
    const veri = olay?.data;
    if (!veri) return;
    const yon = veri.encoding ? "encode" : "decode";
    sesKalitesi[yon] = sesIstatistigiSeviyesi(veri);
    yay({ t: "sesKalitesi", ...sesKalitesi });
    window.clearTimeout(eskime[yon]);
    eskime[yon] = window.setTimeout(() => {
      sesKalitesi[yon] = null;
      yay({ t: "sesKalitesi", ...sesKalitesi });
    }, SES_ISTATISTIGI_ESKIME_MS);
  };
  const medyaBozuldu = (olay: { code?: number; message?: string; type?: string }) => {
    console.warn("Zoom active-media-failed", olay);
    yay({ t: "medyaHatasi" });
  };
  const konusan = (olay: Array<{ userId: number }>) =>
    yay({ t: "konusanlar", idler: (olay ?? []).map((k) => kimlik(k.userId)) });
  const sesOtomatikBaslamadi = () => yay({ t: "sesEngellendi", engellendi: true });
  const sesSeviyesi = (olay: { level: number }) =>
    yay({ t: "sesSeviyem", seviye: olay?.level ?? 0 });
  const kapaliykenKonusma = () => yay({ t: "kapaliykenKonusma" });
  const cihazDegisti = () => yay({ t: "cihazlarDegisti" });
  const paylasimDegisti = (olay: { state: string; userId: number }) => {
    if (olay.state === "Active") yay({ t: "paylasim", id: kimlik(olay.userId) });
    else if (olay.state === "Inactive") yay({ t: "paylasim", id: null });
  };
  // Tarayıcının "Paylaşımı durdur" düğmesi ya da başka birinin paylaşımı.
  const paylasimDurduruldu = () => yay({ t: "paylasimBitti" });
  const paylasimBoyutu = (olay: { type?: string }) => {
    if (olay?.type === "sended") tumEkranOku();
  };

  const sdkDinleyicileri: Array<[string, (yuk: never) => void]> = [
    ["user-added", kullaniciDegisti],
    ["user-removed", kullaniciDegisti],
    ["user-updated", kullaniciDegisti],
    ["peer-video-state-change", videoDegisti],
    ["connection-change", baglanti],
    ["active-speaker", konusan],
    ["auto-play-audio-failed", sesOtomatikBaslamadi],
    ["device-change", cihazDegisti],
    ["current-audio-level-change", sesSeviyesi],
    ["speaking-while-muted", kapaliykenKonusma],
    ["network-quality-change", agKalitesi],
    ["audio-statistic-data-change", sesIstatistigi],
    ["active-media-failed", medyaBozuldu],
    ["active-share-change", paylasimDegisti],
    ["passively-stop-share", paylasimDurduruldu],
    ["share-content-dimension-change", paylasimBoyutu],
  ];
  for (const [olay, dinleyici] of sdkDinleyicileri) {
    istemci.on(olay, dinleyici as (yuk: unknown) => void);
  }
  return () => {
    window.clearTimeout(zamanlayici);
    window.clearTimeout(eskime.encode);
    window.clearTimeout(eskime.decode);
    for (const [olay, dinleyici] of sdkDinleyicileri) {
      try {
        istemci.off(olay, dinleyici as (yuk: unknown) => void);
      } catch {
        // istemci zaten yok
      }
    }
  };
}

let sdkSokumu: (() => void) | null = null;

function olaylar(dinle: (o: VideoOlayi) => void): () => void {
  dinleyiciler.add(dinle);
  sdkSokumu ??= sdkyaBaglan();
  return () => {
    dinleyiciler.delete(dinle);
    if (dinleyiciler.size === 0 && sdkSokumu) {
      sdkSokumu();
      sdkSokumu = null;
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
async function sesiBaslat(
  o: { mute: boolean } & SesSecenekleri,
): Promise<"tam" | "yalnizHoparlor"> {
  let hata: unknown;
  try {
    const sonuc = await akis().startAudio({
      mute: o.mute,
      microphoneId: o.mikId,
      speakerId: o.hoparlorId,
    });
    if (basarisizMi(sonuc)) hata = sonuc;
  } catch (e) {
    hata = e ?? new Error("startAudio");
  }
  if (hata === undefined) {
    yay({ t: "sesEngellendi", engellendi: false });
    yay({ t: "cihazlarDegisti" });
    void sesIstatistigineAbone();
    return "tam";
  }
  if (!mikIzniReddiMi(hata)) throw hata;
  console.warn("Zoom startAudio (mikrofon izni yok)", hata);
  const sonuc = await akis().startAudio({ speakerOnly: true, speakerId: o.hoparlorId });
  if (basarisizMi(sonuc)) throw sonuc;
  yay({ t: "sesEngellendi", engellendi: false });
  yay({ t: "cihazlarDegisti" });
  void sesIstatistigineAbone();
  return "yalnizHoparlor";
}

/**
 * `startAudio` hatası mikrofon izninin reddi mi? Zoom bunu
 * `INSUFFICIENT_PRIVILEGES` / `AUDIO_CAPTURE_FAILED` ile bildirir; bazı
 * tarayıcılar getUserMedia'nın `NotAllowedError`ını olduğu gibi geçirir.
 * (Nötr `mikIzniReddedildiMi` ile aynı kural; sürücü depo katmanını import etmez.)
 */
function mikIzniReddiMi(hata: unknown): boolean {
  let metin: string;
  if (hata instanceof Error) metin = `${hata.name} ${hata.message}`;
  else if (typeof hata === "object" && hata !== null) {
    const { type, reason, name, message } = hata as Record<string, unknown>;
    metin = [type, reason, name, message].map((v) => String(v ?? "")).join(" ");
  } else metin = String(hata ?? "");
  return /AUDIO_CAPTURE_FAILED|INSUFFICIENT_PRIVILEGES|NotAllowed|Permission denied/i.test(metin);
}

/**
 * "Sesi aç": tarayıcı sesi engellediyse kullanıcı hareketiyle yeniden dener.
 * Ses zaten bağlıysa (yalnız çalma engellendiyse) hareketin kendisi yeter.
 */
async function sesiAc(
  o: { mikAcik: boolean } & SesSecenekleri,
): Promise<"tam" | "yalnizHoparlor"> {
  let sonuc: "tam" | "yalnizHoparlor" = "tam";
  if (!benimKaydim()?.audio) {
    sonuc = await sesiBaslat({ mute: !o.mikAcik, mikId: o.mikId, hoparlorId: o.hoparlorId });
  } else {
    yay({ t: "sesEngellendi", engellendi: false });
  }
  kullanicilariOku();
  return sonuc;
}

/** Nötr `mikIzniReddedildiMi`nin tanıdığı ad: arayan izin penceresini açar. */
function mikIzniYokHatasi(): Error {
  const hata = new Error("mikrofon izni yok");
  hata.name = "NotAllowedError";
  return hata;
}

async function mikrofon(ac: boolean, o: SesSecenekleri = {}): Promise<void> {
  const ben = benimKaydim();
  if (!ben?.audio) {
    if ((await sesiBaslat({ mute: !ac, ...o })) === "yalnizHoparlor" && ac) {
      throw mikIzniYokHatasi();
    }
  } else if (ben.isSpeakerOnly) {
    // Yalnız hoparlörle bağlı: mikrofon zaten yok, kapatmak işsiz. Açmak için
    // ses mikrofonla yeniden kurulur; izin hâlâ yoksa yine yalnız hoparlör.
    if (ac) {
      const durdur = await akis().stopAudio();
      if (basarisizMi(durdur)) throw durdur;
      if ((await sesiBaslat({ mute: false, ...o })) === "yalnizHoparlor") {
        throw mikIzniYokHatasi();
      }
    }
  } else {
    const sonuc = ac ? await akis().unmuteAudio() : await akis().muteAudio();
    if (basarisizMi(sonuc)) throw sonuc;
  }
  kullanicilariOku();
}

/** Son kamera seçenekleri: arka plan değişiminde kamera bunlarla yeniden açılır. */
let sonKamera: KameraSecenekleri = { ayna: true, arkaPlan: "yok" };

async function kamera(
  ac: boolean,
  o?: KameraSecenekleri,
): Promise<{ arkaPlanUygulandi: boolean }> {
  let arkaPlanUygulandi = true;
  if (ac) {
    if (o) sonKamera = o;
    arkaPlanUygulandi = await videoyuBaslat(sonKamera);
  } else {
    const sonuc = await akis().stopVideo();
    if (basarisizMi(sonuc)) throw sonuc;
  }
  kullanicilariOku();
  if (ac) yay({ t: "cihazlarDegisti" });
  return { arkaPlanUygulandi };
}

/**
 * Kamerayı seçilen arka planla açar. Arka plan yüzünden açılamazsa kamera
 * arka plansız açılır (görüntü kapalı kalmasın) ve `false` döner.
 */
async function videoyuBaslat(o: KameraSecenekleri): Promise<boolean> {
  const secenek = { cameraId: o.kameraId, mirrored: onKamera && o.ayna };
  const arkaPlan = arkaPlanSecenegi(o.arkaPlan);
  if (arkaPlan) {
    try {
      const sonuc = await akis().startVideo({ ...secenek, virtualBackground: arkaPlan });
      if (!basarisizMi(sonuc)) return true;
      console.warn("Zoom startVideo (arka plan)", sonuc);
    } catch (e) {
      console.warn("Zoom startVideo (arka plan)", e);
    }
    if (benimKaydim()?.bVideoOn) return true;
  }
  const sonuc = await akis().startVideo(secenek);
  if (basarisizMi(sonuc)) throw sonuc;
  return !arkaPlan;
}

/* ── Sanal arka plan (bulanıklaştırma / düz renk) ───────────────────── */

/**
 * Bu cihaz sanal arka planı destekliyor mu? Odada `isSupportVirtualBackground`,
 * önizlemede `checkFeatureRequirements` (telefon tarayıcılarında ikisi de hayır).
 */
function arkaPlanDestekli(): boolean {
  if (oturumdaMi()) {
    try {
      return akis().isSupportVirtualBackground();
    } catch {
      return false;
    }
  }
  return ozellikDestekli("Virtual Background");
}

function arkaPlanSecenegi(ap: ArkaPlan): { imageUrl: string } | undefined {
  if (!arkaPlanDestekli()) return undefined;
  const adres = arkaPlanAdresi(ap);
  return adres ? { imageUrl: adres } : undefined;
}

/**
 * Ders içinde arka planı değiştirir. Görüntü arka planla başlatıldıysa
 * `updateVirtualBackgroundImage`; arka plansız başlatıldıysa arka plan ancak
 * kamerayı yeniden başlatmakla gelir.
 */
async function arkaPlan(ap: ArkaPlan): Promise<{ uygulandi: boolean }> {
  sonKamera = { ...sonKamera, arkaPlan: ap };
  if (!benimKaydim()?.bVideoOn || !arkaPlanDestekli()) return { uygulandi: true };
  const adres = arkaPlanAdresi(ap);
  let yapilandirildi = false;
  try {
    yapilandirildi = Boolean(akis().getVirtualbackgroundStatus()?.isVBConfigured);
  } catch {
    yapilandirildi = false;
  }
  if (yapilandirildi) {
    const sonuc = await akis().updateVirtualBackgroundImage(adres);
    if (basarisizMi(sonuc)) throw sonuc;
    return { uygulandi: true };
  }
  if (!adres) return { uygulandi: true };
  const dur = await akis().stopVideo();
  if (basarisizMi(dur)) throw dur;
  const { arkaPlanUygulandi } = await kamera(true);
  return { uygulandi: arkaPlanUygulandi };
}

let onKamera = true;

/** Telefonda ön/arka kamera. */
async function kamerayiCevir(): Promise<void> {
  onKamera = !onKamera;
  const yon = onKamera ? MobileVideoFacingMode.User : MobileVideoFacingMode.Environment;
  const sonuc = await akis().switchCamera(yon);
  if (basarisizMi(sonuc)) {
    onKamera = !onKamera;
    throw sonuc;
  }
  // Arka kamera aynalanmaz; ön kamera tercihe göre.
  try {
    await akis().mirrorVideo(onKamera && sonKamera.ayna);
  } catch {
    // aynalama desteklenmiyorsa görüntü yine gelir
  }
}

/* ── Ekran paylaşımı (Paket 4) ──────────────────────────────────────── */

/**
 * Tarayıcı ekran paylaşabilir mi? Zoom'un denetimi + `getDisplayMedia`.
 * Telefonda düğme zaten yok (plan §5 P4).
 */
function paylasimDestekli(): boolean {
  try {
    return (
      Boolean(ZoomVideo.checkSystemRequirements()?.screen) &&
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function"
    );
  } catch {
    return false;
  }
}

/**
 * Host (öğretmen) mıyım? SDK varsayılanı `HostGrab`: biri paylaşırken yalnız
 * host/yönetici paylaşımı devralabilir; diğerinin düğmesi kapatılır.
 */
function paylasimDevralabilir(): boolean {
  try {
    return istemci.isHost() || istemci.isManager();
  } catch {
    return false;
  }
}

/**
 * Kendi paylaşımım tüm ekran mı? Önce SDK'nın `getShareStreamSettings()`
 * (öğe türünden bağımsız, canvas yolu dahil); yüzey bildirmezse `<video>`
 * öğesinin izinden (ayar/kısıt/etiket) yedek okuma.
 */
function tumEkranOku() {
  let yuzey: string | undefined;
  try {
    yuzey = akis().getShareStreamSettings()?.displaySurface;
  } catch {
    yuzey = undefined;
  }
  if (yuzey) {
    yay({ t: "paylasimYuzeyi", tumEkran: tumEkranPaylasimiMi({ displaySurface: yuzey }) });
    return;
  }
  const oge = kayitliPaylasimOgesi();
  if (!(oge instanceof HTMLVideoElement)) return;
  const akisNesnesi = oge.srcObject;
  if (typeof MediaStream === "undefined" || !(akisNesnesi instanceof MediaStream)) return;
  const iz = akisNesnesi.getVideoTracks()[0];
  if (!iz) return;
  yay({
    t: "paylasimYuzeyi",
    tumEkran: tumEkranPaylasimiMi({
      displaySurface: (iz.getSettings() as { displaySurface?: string }).displaySurface,
      kisitYuzeyi: (iz.getConstraints() as { displaySurface?: string }).displaySurface,
      etiket: iz.label,
    }),
  });
}

/** Ekranımı paylaş. Hata fırlatılır; tepkisi `paylasimHatasiTuru`. */
async function paylasimiBaslat(): Promise<void> {
  const oge = kayitliPaylasimOgesi();
  if (!oge) throw new Error("paylasim ogesi yok");
  const sonuc = await akis().startShareScreen(oge);
  if (basarisizMi(sonuc)) throw sonuc;
  // Yüzey, nötr katman "paylaşıyorum"u yazdıktan SONRA bildirilir (bir tur).
  window.setTimeout(tumEkranOku, 0);
}

async function paylasimiDurdur(): Promise<void> {
  const sonuc = await akis().stopShareScreen();
  if (basarisizMi(sonuc)) console.warn("Zoom stopShareScreen", sonuc);
}

/* ── Ayrılma ─────────────────────────────────────────────────────────── */

let ayrilma: Promise<void> | null = null;

/**
 * YALNIZ kendini oturumdan çıkarır (host için de). En çok ~3 sn bekler;
 * `destroyClient` ayrılma sözü sonuçlanınca çalışır. "Biz ayrılıyoruz"
 * bayrağını nötr katman bundan ÖNCE yazar (`oda/durum/medya.ts` `ayril`).
 */
function ayril(): Promise<void> {
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

export const zoomSurucusu: VideoSurucusu = {
  ad: "zoom",
  kararliKimlik: false,
  hazirla,
  katil,
  ayril,
  oturumdaMi,
  olaylar,
  // Zoom bileti oturum boyunca geçerli; tazeleme yalnız katılmadan önce.
  bileTazele: async () => {},
  sesiBaslat,
  sesiAc,
  mikrofon,
  kamera,
  kamerayiCevir,
  aynala,
  arkaPlan,
  cihazSec,
  cihazlar,
  paylasimiBaslat,
  paylasimiDurdur,
  paylasimDevralabilir,
  destekler: {
    arkaPlan: async () => arkaPlanDestekli(),
    hoparlorSecimi: hoparlorSecilebilir,
    ekranPaylasimi: paylasimDestekli,
    kameraCevirme: () => true,
    kapaliykenKonusma: true,
  },
  onizleme: zoomOnizleme,
  MedyaKatmani,
};
