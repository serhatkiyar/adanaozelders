/**
 * Agora RTC sürücüsü — `VideoSurucusu` (`../tipler.ts`) uygulaması.
 * Ham `agora-rtc-sdk-ng` YALNIZ `video/agora/*` içinde import edilir
 * (CanliDers tembel parçası, `../yukle.ts`).
 *
 * KURAL: bu dosya depo, tercih ve i18n import ETMEZ; olay yayar ve sonuç
 * döndürür. Depoya yazan nötr katmandır (`oda/durum/olayBagla.ts`, `medya.ts`);
 * "biz ayrılıyoruz" bayrağını da nötr katman `ayril()`dan ÖNCE yazar.
 *
 * ## Sözleşme
 *
 * 1. Kimlik kararlıdır: uid sunucudan (`t7` / `c9`); karşı taraf
 *    `bilet.karsi`dan tanınır. `*-ekran` uid'leri listeye girmez, paylaşım
 *    olayına çevrilir; kendi ekran uid'ime abone olunmaz.
 * 2. Kamera `setEnabled` (ışık söner), mikrofon `setMuted` (hızlı); ikisi
 *    aynı izde karıştırılmaz. Yeniden katılımdan sonra izler `localTracks`te
 *    olmadığı için açıkça yeniden yayınlanır.
 * 3. Token: `token-privilege-will-expire` → her bitiş anı için BİR KEZ
 *    `biletSonu`; nötr katman yeni bileti `bileTazele` ile verir (iki
 *    istemcide `renewToken`). Bitiş ilerlemiyorsa (ders penceresinin sonu)
 *    yenilenmez. Süresi dolarsa yeniden katılınır; yenileme 409 dönerse
 *    `SurucuHatasi("dersBitti")` → `baglanti: kapandi`.
 * 4. Paylaşım devri Zoom'un `HostGrab`ı gibi: yalnız öğretmen devralabilir;
 *    öğretmen paylaşmaya başlayınca öğrencininki durur (`paylasimBitti`).
 * 5. Ağ ölçümü Zoom'daki gibi yalnız kamerası açık olan için; kendi ses
 *    bağlantım `sesKalitesi` ile.
 */
import type {
  ConnectionDisconnectedReason,
  ConnectionState,
  IAgoraRTCRemoteUser,
  ILocalTrack,
  NetworkQuality,
  RemoteStreamType,
} from "agora-rtc-sdk-ng";

import type { AgoraDersTokenOut } from "@/types";

import { tarayiciOrtami, telefonMu, tumEkranPaylasimiMi } from "@/lib/canliDers";

import type { ArkaPlan } from "../arkaPlan";
import {
  SurucuHatasi,
  type Cihazlar,
  type HamKatilimci,
  type KameraSecenekleri,
  type KatilSecenekleri,
  type KatilimciId,
  type NotrBilet,
  type SesSecenekleri,
  type VideoOlayi,
  type VideoSurucusu,
} from "../tipler";
import { arkaPlanIyimser, arkaPlaniBirak, arkaPlaniUygula, masaustuChromium } from "./arkaPlan";
import {
  agSeviyesi,
  baglantiDurumu,
  dersBittiMi,
  ekranMi,
  ekranSahibi,
  izinReddiMi,
  kimlik,
  konusanlar,
  listeyiCevir,
  sesSeviyesi,
} from "./cevir";
import * as ekran from "./ekran";
import {
  AgoraRTC,
  aynayiAyarla,
  cihazListesi,
  ciz,
  cizimiSifirla,
  istemci,
  izCihazi,
  kameraOlustur,
  mikrofonOlustur,
  yerel,
} from "./istemci";
import { MedyaKatmani } from "./MedyaKatmani";
import { agoraOnizleme } from "./onizleme";

const AYRILMA_BEKLEME_MS = 3000;
const AG_YOKLAMA_MS = 2000;
const SES_TARAMA_MS = 250;
const DUSUK_AKIS = 1 as RemoteStreamType;
const YUKSEK_AKIS = 0 as RemoteStreamType;

/* ── Olay yayını ─────────────────────────────────────────────────────── */

const dinleyiciler = new Set<(o: VideoOlayi) => void>();

function yay(o: VideoOlayi): void {
  for (const f of dinleyiciler) f(o);
}

/* ── Oturum durumu ───────────────────────────────────────────────────── */

let bilet: NotrBilet | null = null;
let secenek: KatilSecenekleri | null = null;
/** Katıldık ve henüz `ayril()` çağrılmadı (yeniden bağlanma/katılım sırasında da). */
let katildi = false;
/** Token süresi dolunca yapılan iç yeniden katılım sürüyor. */
let icKatilim = false;
/** Hangi bitiş anı için `biletSonu` yayıldı (yinelenmesin). */
let sonBiletSonu: string | null = null;

let sesBagli = false;
let yalnizHoparlor = false;
let hoparlorId: string | undefined;
/** Son kamera seçenekleri (arka plan / cihaz / ayna). */
let sonKamera: KameraSecenekleri = { ayna: true, arkaPlan: "yok" };

function agoraBileti(): AgoraDersTokenOut {
  if (!bilet) throw new Error("Agora bileti yok");
  return bilet.ham as AgoraDersTokenOut;
}

function benId(): KatilimciId {
  return bilet ? agoraBileti().uid : "";
}

/* ── Katılımcılar ────────────────────────────────────────────────────── */

function listeyiOku(): HamKatilimci[] {
  if (!bilet) return [];
  return listeyiCevir(
    {
      id: benId(),
      ad: bilet.ad,
      rol: bilet.rol,
      videoAcik: Boolean(yerel.kam && yerel.kameraAcik && yerel.kam.enabled),
      sesBagli,
      mikKapali: yalnizHoparlor || !yerel.mik || yerel.mik.muted,
      paylasiyor: ekran.paylasiyorMu(),
    },
    istemci.remoteUsers,
    bilet.karsi,
  );
}

function listeYay(): HamKatilimci[] {
  const liste = listeyiOku();
  yay({ t: "katilimcilar", liste });
  return liste;
}

/** Karşı tarafın ekran kullanıcısı (yayında) — kendi ekran uid'im hariç. */
function uzakPaylasan(): IAgoraRTCRemoteUser | undefined {
  const benimEkranim = bilet ? agoraBileti().ekran.uid : null;
  return istemci.remoteUsers.find(
    (u) => ekranMi(u.uid) && String(u.uid) !== benimEkranim && u.hasVideo,
  );
}

/** Katılınca / yeniden bağlanınca anlık paylaşım okuması. */
function paylasimiEsitle(): void {
  const u = uzakPaylasan();
  yay({ t: "paylasim", id: u ? ekranSahibi(u.uid) : null, esitle: true });
}

/* ── Uzak yayınlar ───────────────────────────────────────────────────── */

function hoparlorSecilebilir(): boolean {
  return (
    masaustuChromium() &&
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
  );
}

function hoparloruUygula(): void {
  if (!hoparlorId || !hoparlorSecilebilir()) return;
  for (const u of istemci.remoteUsers) {
    u.audioTrack?.setPlaybackDevice(hoparlorId).catch((e: unknown) => {
      console.warn("Agora setPlaybackDevice", e);
    });
  }
}

/** Paylaşım sürerken karşı kamerayı düşük akışa indirir (fiyat kademesi). */
function kameraAkisiniAyarla(): void {
  const dusuk = uzakPaylasan() !== undefined;
  for (const u of istemci.remoteUsers) {
    if (ekranMi(u.uid) || !u.hasVideo) continue;
    istemci
      .setRemoteVideoStreamType(u.uid, dusuk ? DUSUK_AKIS : YUKSEK_AKIS)
      .catch(() => undefined);
  }
}

async function yayinAlindi(u: IAgoraRTCRemoteUser, tur: "audio" | "video" | "datachannel") {
  if (tur === "datachannel" || !bilet) return;
  if (ekranMi(u.uid)) {
    // Kendi ekranıma ASLA abone olunmaz (çift ücret).
    if (String(u.uid) === agoraBileti().ekran.uid || tur !== "video") return;
    try {
      await istemci.subscribe(u, "video");
    } catch (e) {
      console.warn("Agora subscribe (ekran)", e);
      return;
    }
    // Devir (Zoom HostGrab): yalnız öğretmen devralır. Öğretmen paylaşırken
    // öğrenci ekranı gelirse öğretmeninki sürer; öğrencininki öğretmenin
    // ekranı gelince durur. Aynı anda başlarlarsa ikisi birden durmaz.
    if (ekran.paylasiyorMu() && bilet.rol !== "ogretmen") {
      await ekran.paylasimiDurdur();
      yay({ t: "paylasimBitti" });
    }
    kameraAkisiniAyarla();
    listeYay();
    yay({ t: "paylasim", id: ekranSahibi(u.uid) });
    ciz();
    return;
  }
  try {
    if (tur === "audio") {
      const iz = await istemci.subscribe(u, "audio");
      if (hoparlorId && hoparlorSecilebilir()) {
        iz.setPlaybackDevice(hoparlorId).catch(() => undefined);
      }
      iz.play();
    } else {
      await istemci.subscribe(u, "video");
      kameraAkisiniAyarla();
    }
  } catch (e) {
    console.warn(`Agora subscribe (${tur})`, e);
  }
  listeYay();
  ciz();
}

function yayinBitti(u: IAgoraRTCRemoteUser, tur: "audio" | "video" | "datachannel") {
  if (ekranMi(u.uid)) {
    if (!bilet || String(u.uid) === agoraBileti().ekran.uid || tur !== "video") return;
    kameraAkisiniAyarla();
    listeYay();
    yay({ t: "paylasim", id: null });
    ciz();
    return;
  }
  if (tur === "video") yay({ t: "ag", id: kimlik(u.uid), yukari: null, asagi: null });
  listeYay();
  ciz();
}

function kullaniciAyrildi(u: IAgoraRTCRemoteUser) {
  if (ekranMi(u.uid)) {
    yayinBitti(u, "video");
    return;
  }
  yay({ t: "ag", id: kimlik(u.uid), yukari: null, asagi: null });
  listeYay();
  ciz();
}

/* ── Ölçümler: ağ (2 sn) ve ses düzeyi (250 ms) ─────────────────────── */

let agZamanlayici: number | undefined;
let sesZamanlayici: number | undefined;
const sonAg = new Map<KatilimciId, string>();
let sonSesKalitesi = "";
let sonSeviye = -1;
let sonKonusanlar = "";

function agYay(id: KatilimciId, yukari: number | null, asagi: number | null) {
  const anahtar = `${yukari}/${asagi}`;
  if (sonAg.get(id) === anahtar) return;
  sonAg.set(id, anahtar);
  yay({ t: "ag", id, yukari, asagi });
}

/** Uzak taraflar: `getRemoteNetworkQuality` (yalnız kamerası açık olan). */
function uzakAgiYokla(): void {
  let olcum: Record<string, NetworkQuality>;
  try {
    olcum = istemci.getRemoteNetworkQuality();
  } catch {
    return;
  }
  for (const u of istemci.remoteUsers) {
    if (ekranMi(u.uid) || !u.hasVideo) continue;
    const q = olcum[String(u.uid)];
    if (!q) continue;
    agYay(kimlik(u.uid), agSeviyesi(q.uplinkNetworkQuality), agSeviyesi(q.downlinkNetworkQuality));
  }
}

/** Kendi ağım (`network-quality`, 2 sn'de bir). */
function benimAgim(q: NetworkQuality): void {
  const yukari = agSeviyesi(q.uplinkNetworkQuality);
  const asagi = agSeviyesi(q.downlinkNetworkQuality);
  if (yerel.kam && yerel.kameraAcik && yerel.kam.enabled) agYay(benId(), yukari, asagi);
  const encode = sesBagli ? yukari : null;
  const decode = sesBagli ? asagi : null;
  const anahtar = `${encode}/${decode}`;
  if (anahtar === sonSesKalitesi) return;
  sonSesKalitesi = anahtar;
  yay({ t: "sesKalitesi", encode, decode });
}

function duzey(iz: { getVolumeLevel(): number } | null | undefined): number {
  try {
    return iz?.getVolumeLevel() ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Konuşanlar ve kendi seviyem. `volume-indicator` 2 sn'de bir gelir; karo
 * halkası için yavaş kalır, bu yüzden `getVolumeLevel` ince taraması.
 */
function sesiTara(): void {
  const mikAcik = yerel.mik && sesBagli && !yalnizHoparlor && !yerel.mik.muted;
  const benimki = mikAcik ? duzey(yerel.mik) : 0;
  const seviye = sesSeviyesi(benimki);
  if (seviye !== sonSeviye) {
    sonSeviye = seviye;
    yay({ t: "sesSeviyem", seviye });
  }
  const liste = [{ id: benId(), duzey: benimki }];
  for (const u of istemci.remoteUsers) {
    if (ekranMi(u.uid) || !u.audioTrack) continue;
    liste.push({ id: kimlik(u.uid), duzey: duzey(u.audioTrack) });
  }
  const idler = konusanlar(liste);
  const anahtar = idler.join(",");
  if (anahtar === sonKonusanlar) return;
  sonKonusanlar = anahtar;
  yay({ t: "konusanlar", idler });
}

function olcumleriBaslat(): void {
  olcumleriDurdur();
  agZamanlayici = window.setInterval(uzakAgiYokla, AG_YOKLAMA_MS);
  sesZamanlayici = window.setInterval(sesiTara, SES_TARAMA_MS);
}

function olcumleriDurdur(): void {
  window.clearInterval(agZamanlayici);
  window.clearInterval(sesZamanlayici);
  agZamanlayici = sesZamanlayici = undefined;
  sonAg.clear();
  sonSesKalitesi = "";
  sonSeviye = -1;
  sonKonusanlar = "";
}

/* ── Cihazlar ────────────────────────────────────────────────────────── */

let cihazOnbellegi: Cihazlar["listeler"] | null = null;

async function cihazlariYenile(): Promise<void> {
  const liste = await cihazListesi();
  cihazOnbellegi = {
    mikrofon: liste.filter((c) => c.kind === "audioinput"),
    hoparlor: liste.filter((c) => c.kind === "audiooutput"),
    kamera: liste.filter((c) => c.kind === "videoinput"),
  };
  yay({ t: "cihazlarDegisti" });
}

/** Son okunan cihaz listeleri ve etkin cihazlar; henüz okunmadıysa `null`. */
function cihazlar(): Cihazlar | null {
  if (!cihazOnbellegi) return null;
  return {
    listeler: cihazOnbellegi,
    secili: {
      mikrofon: izCihazi(yerel.mik),
      hoparlor: hoparlorId,
      kamera: izCihazi(yerel.kam) ?? sonKamera.kameraId,
    },
  };
}

async function cihazSec(tur: "mikrofon" | "hoparlor" | "kamera", id: string): Promise<void> {
  if (tur === "mikrofon") {
    if (yerel.mik) await yerel.mik.setDevice(id);
  } else if (tur === "hoparlor") {
    hoparlorId = id;
    hoparloruUygula();
  } else {
    sonKamera = { ...sonKamera, kameraId: id };
    if (yerel.kam) await yerel.kam.setDevice(id);
  }
  void cihazlariYenile();
}

/* ── Katılma ─────────────────────────────────────────────────────────── */

function hazirla(): Promise<void> {
  // Ağır ön yükleme yok: SDK parçası zaten indi; eklenti ilk seçimde.
  return Promise.resolve();
}

/** Bir yerel izi (etkin ve yayında değilse) ana istemciden yayınlar. */
async function yayinla(iz: ILocalTrack): Promise<void> {
  if (!katildi || !iz.enabled) return;
  if (istemci.localTracks.includes(iz)) return;
  await istemci.publish(iz);
}

/** Ana istemciyi kanala sokar ve (yeniden katılımda) izleri yeniden yayınlar. */
async function kanalaGir(ab: AgoraDersTokenOut): Promise<void> {
  await istemci.join(ab.app_id, ab.kanal, ab.token, ab.uid);
  try {
    // Paylaşım sırasında karşı taraf kameramı düşük akıştan izleyebilsin.
    await istemci.enableDualStream();
  } catch (e) {
    console.warn("Agora enableDualStream", e);
  }
}

async function katil(
  b: NotrBilet,
  s: KatilSecenekleri,
): Promise<{ benId: KatilimciId; ilk: HamKatilimci[] }> {
  await hazirla();
  bilet = b;
  secenek = s;
  sonBiletSonu = null;
  await kanalaGir(agoraBileti());
  katildi = true;
  olcumleriBaslat();
  yay({ t: "baglanti", durum: "bagli" });
  const ilk = listeYay();
  paylasimiEsitle();
  void cihazlariYenile();
  return { benId: benId(), ilk };
}

/**
 * Token süresi doldu: yeni biletle yeniden katılır (mikrofon/kamera izleri
 * korunur, yeniden yayınlanır; paylaşım durur). 409 → ders bitti.
 */
async function yenidenKatil(): Promise<void> {
  if (!katildi || !secenek || icKatilim) return;
  icKatilim = true;
  yay({ t: "baglanti", durum: "yenidenBaglaniyor" });
  try {
    let yeni: NotrBilet;
    try {
      yeni = await secenek.biletTazele();
    } catch (e) {
      throw new SurucuHatasi(dersBittiMi(e) ? "dersBitti" : "biletSuresiDoldu", e);
    }
    bilet = yeni;
    sonBiletSonu = null;
    const paylasiyordum = ekran.paylasiyorMu();
    if (paylasiyordum) await ekran.paylasimiDurdur();
    await istemci.leave().catch(() => undefined);
    await kanalaGir(agoraBileti());
    if (yerel.mik && sesBagli && !yalnizHoparlor && !yerel.mik.muted) await yayinla(yerel.mik);
    if (yerel.kam && yerel.kameraAcik) await yayinla(yerel.kam);
    icKatilim = false;
    yay({ t: "baglanti", durum: "bagli" });
    listeYay();
    paylasimiEsitle();
    if (paylasiyordum) yay({ t: "paylasimBitti" });
    ciz();
  } catch (e) {
    icKatilim = false;
    console.warn("Agora yeniden katılım", e);
    yay({ t: "baglanti", durum: "kapandi" });
  }
}

/** Yeni bilet: iki istemcide `renewToken`. Bitiş ilerlemiyorsa işsiz. */
async function bileTazele(b: NotrBilet): Promise<void> {
  if (!katildi || b.saglayici !== "agora") return;
  const eski = bilet ? agoraBileti() : null;
  const yeni = b.ham as AgoraDersTokenOut;
  if (eski && Date.parse(yeni.expires_at) <= Date.parse(eski.expires_at)) return;
  bilet = b;
  await istemci.renewToken(yeni.token);
  await ekran.ekranBileTazele(yeni.ekran.token).catch((e: unknown) => {
    console.warn("Agora ekran renewToken", e);
  });
}

/* ── Olay köprüsü ────────────────────────────────────────────────────── */

/** Paylaşım dışarıdan durdu (tarayıcı düğmesi / token). */
function paylasimDisaridanBitti(): void {
  listeYay();
  ciz();
  yay({ t: "paylasimBitti" });
}

function sdkyaBaglan(): () => void {
  const kullaniciDegisti = () => {
    listeYay();
    ciz();
  };
  const yayinlandi = (u: IAgoraRTCRemoteUser, tur: "audio" | "video" | "datachannel") => {
    void yayinAlindi(u, tur);
  };
  const baglanti = (
    simdiki: ConnectionState,
    onceki: ConnectionState,
    neden?: ConnectionDisconnectedReason,
  ) => {
    if (icKatilim) return;
    const durum = baglantiDurumu(simdiki, onceki, neden);
    if (!durum) return;
    yay({ t: "baglanti", durum });
    // Yeniden bağlanınca durumlar değişmiş olabilir: liste ve paylaşım tazelenir.
    if (durum === "bagli" && onceki === "RECONNECTING") {
      listeYay();
      paylasimiEsitle();
      ciz();
    }
  };
  const biletBitiyor = () => {
    if (!bilet) return;
    const bitis = agoraBileti().expires_at;
    if (sonBiletSonu === bitis) return;
    sonBiletSonu = bitis;
    const kalanSn = Math.max(0, Math.round((Date.parse(bitis) - Date.now()) / 1000));
    yay({ t: "biletSonu", kalanSn });
  };
  const biletBitti = () => void yenidenKatil();

  const dinleyiciler: Array<[string, (...a: never[]) => void]> = [
    ["user-joined", kullaniciDegisti],
    ["user-left", kullaniciAyrildi],
    ["user-published", yayinlandi],
    ["user-unpublished", yayinBitti],
    ["user-info-updated", kullaniciDegisti],
    ["connection-state-change", baglanti],
    ["network-quality", benimAgim],
    ["token-privilege-will-expire", biletBitiyor],
    ["token-privilege-did-expire", biletBitti],
  ];
  for (const [olay, f] of dinleyiciler) istemci.on(olay, f as (...a: unknown[]) => void);

  const cihazDegisti = () => void cihazlariYenile();
  AgoraRTC.onAutoplayFailed = () => yay({ t: "sesEngellendi", engellendi: true });
  AgoraRTC.onMicrophoneChanged = cihazDegisti;
  AgoraRTC.onCameraChanged = cihazDegisti;
  AgoraRTC.onPlaybackDeviceChanged = cihazDegisti;

  return () => {
    for (const [olay, f] of dinleyiciler) istemci.off(olay, f as (...a: unknown[]) => void);
    AgoraRTC.onAutoplayFailed = undefined;
    AgoraRTC.onMicrophoneChanged = undefined;
    AgoraRTC.onCameraChanged = undefined;
    AgoraRTC.onPlaybackDeviceChanged = undefined;
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

/* ── Ses ─────────────────────────────────────────────────────────────── */

function sesKuruldu(): void {
  yay({ t: "sesEngellendi", engellendi: false });
  void cihazlariYenile();
  listeYay();
}

/**
 * Mikrofonu kurar; `mute` ile kapalı başlar (kapalıyken yayınlanmaz).
 * Mikrofon izni yoksa yalnız hoparlörle "bağlanır" — karşı taraf yine
 * duyulur — ve `"yalnizHoparlor"` döner. Diğer hatalar fırlatılır.
 */
async function sesiBaslat(
  o: { mute: boolean } & SesSecenekleri,
): Promise<"tam" | "yalnizHoparlor"> {
  if (o.hoparlorId) hoparlorId = o.hoparlorId;
  hoparloruUygula();
  if (!yerel.mik) {
    try {
      yerel.mik = await mikrofonOlustur(o.mikId);
    } catch (e) {
      if (!izinReddiMi(e) && !(e instanceof SurucuHatasi && e.kod === "mikIzniYok")) throw e;
      console.warn("Agora mikrofon (izin yok)", e);
      sesBagli = true;
      yalnizHoparlor = true;
      sesKuruldu();
      return "yalnizHoparlor";
    }
  }
  yalnizHoparlor = false;
  await yerel.mik.setMuted(o.mute);
  if (!o.mute) await yayinla(yerel.mik);
  sesBagli = true;
  sesKuruldu();
  return "tam";
}

/**
 * "Sesi aç": ses kurulmadıysa kurar; kuruluysa tarayıcının otomatik oynatma
 * engelini kullanıcı hareketiyle kaldırır (uzak sesler yeniden çalınır).
 */
async function sesiAc(
  o: { mikAcik: boolean } & SesSecenekleri,
): Promise<"tam" | "yalnizHoparlor"> {
  const sonuc = sesBagli
    ? "tam"
    : await sesiBaslat({ mute: !o.mikAcik, mikId: o.mikId, hoparlorId: o.hoparlorId });
  try {
    AgoraRTC.resumeAudioContext();
  } catch {
    // eski tarayıcı
  }
  for (const u of istemci.remoteUsers) {
    if (!ekranMi(u.uid)) u.audioTrack?.play();
  }
  yay({ t: "sesEngellendi", engellendi: false });
  listeYay();
  return sonuc;
}

async function mikrofon(ac: boolean, o: SesSecenekleri = {}): Promise<void> {
  if (!sesBagli) {
    if ((await sesiBaslat({ mute: !ac, ...o })) === "yalnizHoparlor" && ac) {
      throw new SurucuHatasi("mikIzniYok");
    }
    return;
  }
  if (yalnizHoparlor) {
    if (!ac) return;
    // İzin sonradan verilmiş olabilir: mikrofon yeniden denenir.
    yerel.mik = await mikrofonOlustur(o.mikId);
    yalnizHoparlor = false;
  }
  const mik = yerel.mik;
  if (!mik) return;
  await mik.setMuted(!ac);
  if (ac) await yayinla(mik);
  listeYay();
}

/* ── Kamera ──────────────────────────────────────────────────────────── */

async function kamera(ac: boolean, o?: KameraSecenekleri): Promise<{ arkaPlanUygulandi: boolean }> {
  if (!ac) {
    yerel.kameraAcik = false;
    if (yerel.kam?.enabled) await yerel.kam.setEnabled(false);
    ciz();
    listeYay();
    return { arkaPlanUygulandi: true };
  }
  if (o) {
    sonKamera = o;
    aynayiAyarla(o.ayna);
  }
  if (!yerel.kam) {
    const kam = await kameraOlustur({ kameraId: sonKamera.kameraId, onKamera: yerel.onKamera });
    kam.on("track-ended", () => yay({ t: "medyaHatasi" }));
    yerel.kam = kam;
  } else {
    if (!yerel.kam.enabled) await yerel.kam.setEnabled(true);
    const istenen = sonKamera.kameraId;
    if (istenen && yerel.onKamera && izCihazi(yerel.kam) !== istenen) {
      await yerel.kam.setDevice(istenen).catch((e: unknown) => console.warn("Agora setDevice", e));
    }
  }
  const arkaPlanUygulandi = await arkaPlaniUygula(yerel.kam, sonKamera.arkaPlan);
  yerel.kameraAcik = true;
  await yayinla(yerel.kam);
  ciz();
  listeYay();
  void cihazlariYenile();
  return { arkaPlanUygulandi };
}

/** Telefonda ön/arka kamera (`setDevice({ facingMode })`). */
async function kamerayiCevir(): Promise<void> {
  const on = !yerel.onKamera;
  if (yerel.kam) await yerel.kam.setDevice({ facingMode: on ? "user" : "environment" });
  yerel.onKamera = on;
  ciz();
}

/** Kendi görüntümü aynala (yalnız bende; arka kamera aynalanmaz). */
async function aynala(ayna: boolean): Promise<void> {
  sonKamera = { ...sonKamera, ayna };
  aynayiAyarla(ayna);
}

async function arkaPlan(ap: ArkaPlan): Promise<{ uygulandi: boolean }> {
  sonKamera = { ...sonKamera, arkaPlan: ap };
  if (!yerel.kam || !yerel.kameraAcik) return { uygulandi: true };
  return { uygulandi: await arkaPlaniUygula(yerel.kam, ap) };
}

/* ── Ekran paylaşımı ─────────────────────────────────────────────────── */

function paylasimDestekli(): boolean {
  try {
    return (
      !telefonMu(tarayiciOrtami()) &&
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
      AgoraRTC.checkSystemRequirements()
    );
  } catch {
    return false;
  }
}

async function paylasimiBaslat(): Promise<void> {
  if (!katildi || !bilet) throw new Error("Agora oturumu yok");
  await ekran.paylasimiBaslat(agoraBileti(), paylasimDisaridanBitti);
  listeYay();
  // Yüzey, nötr katman "paylaşıyorum"u yazdıktan SONRA bildirilir (bir tur).
  window.setTimeout(() => {
    const yuzey = ekran.paylasimYuzeyi();
    if (yuzey) yay({ t: "paylasimYuzeyi", tumEkran: tumEkranPaylasimiMi(yuzey) });
  }, 0);
}

async function paylasimiDurdur(): Promise<void> {
  await ekran.paylasimiDurdur();
  ciz();
  listeYay();
}

/* ── Ayrılma ─────────────────────────────────────────────────────────── */

let ayrilma: Promise<void> | null = null;

function izleriKapat(): void {
  arkaPlaniBirak(yerel.kam);
  for (const iz of [yerel.kam, yerel.mik]) {
    try {
      iz?.close();
    } catch {
      // zaten kapalı
    }
  }
  yerel.kam = null;
  yerel.mik = null;
  yerel.kameraAcik = false;
}

/**
 * YALNIZ kendini kanaldan çıkarır. Yerel izler kapanır (kamera ışığı söner);
 * en çok ~3 sn beklenir. "Biz ayrılıyoruz" bayrağını nötr katman ÖNCE yazar.
 */
function ayril(): Promise<void> {
  if (!katildi) return ayrilma ?? Promise.resolve();
  if (!ayrilma) {
    olcumleriDurdur();
    // İzler hemen kapanır: 3 sn beklemesi dolsa da kamera ışığı yanık kalmasın.
    cizimiSifirla();
    izleriKapat();
    const cikis = (async () => {
      await ekran.paylasimiDurdur().catch(() => undefined);
      await istemci.leave().catch(() => undefined);
    })();
    ayrilma = Promise.race([
      cikis,
      new Promise<void>((coz) => window.setTimeout(coz, AYRILMA_BEKLEME_MS)),
    ]).finally(() => {
      katildi = false;
      sesBagli = false;
      yalnizHoparlor = false;
      ayrilma = null;
    });
  }
  return ayrilma;
}

export const agoraSurucusu: VideoSurucusu = {
  ad: "agora",
  kararliKimlik: true,
  hazirla,
  katil,
  ayril,
  oturumdaMi: () => katildi,
  olaylar,
  bileTazele,
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
  paylasimDevralabilir: () => bilet?.rol === "ogretmen",
  destekler: {
    arkaPlan: async () => arkaPlanIyimser(),
    hoparlorSecimi: hoparlorSecilebilir,
    ekranPaylasimi: paylasimDestekli,
    kameraCevirme: () => true,
    kapaliykenKonusma: false,
  },
  onizleme: agoraOnizleme,
  MedyaKatmani,
};
