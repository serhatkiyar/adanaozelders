/**
 * Oda eylemlerinin nötr kapısı: sürücüyü (`surucu()`) çağırır, sonucunu
 * depoya ve tarayıcı tercihlerine yazar. Sürücü depo/tercih bilmez; seçili
 * cihazlar, ayna ve arka plan buradan verilir.
 */
import { surucu } from "../../video/etkin";
import type { ArkaPlan } from "../../video/arkaPlan";
import type { CihazTuru, KameraSecenekleri, SesSecenekleri } from "../../video/tipler";
import {
  agOlcumunuSil,
  benimPaylasimim,
  cihazlarDegisti,
  cihazSecildi,
  gecerliCihazId,
  listeleriKur,
} from "./indirgeyiciler";
import { depoyaUygula, useOdaDeposu } from "./odaDeposu";
import { tercihleriOku, tercihleriYaz } from "./tercihler";

/**
 * Oturumdaki cihaz listeleri ve etkin cihazlar → depo. Katılınca, ses ya da
 * kamera başlayınca (izin yeni verilmiş olabilir) ve cihaz değişiminde.
 */
export function cihazlariOku(): void {
  const c = surucu().cihazlar();
  if (!c) return;
  const listeler = listeleriKur(c.listeler);
  depoyaUygula((d) => cihazlarDegisti(d, listeler, c.secili));
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

function sesSecenekleri(): SesSecenekleri {
  return { mikId: tercihEdilen("mikrofon"), hoparlorId: tercihEdilen("hoparlor") };
}

function kameraSecenekleri(): KameraSecenekleri {
  const t = tercihleriOku();
  return { kameraId: tercihEdilen("kamera"), ayna: t.ayna, arkaPlan: t.arkaPlan };
}

/** Bilgisayar sesine bağlanır (izin yoksa yalnız hoparlör). */
export function sesiBaslat(mute: boolean): Promise<"tam" | "yalnizHoparlor"> {
  return surucu().sesiBaslat({ mute, ...sesSecenekleri() });
}

/** "Sesi aç": tarayıcı sesi engellediyse kullanıcı hareketiyle yeniden dener. */
export async function sesiAc(mikAcik: boolean): Promise<void> {
  if ((await surucu().sesiAc({ mikAcik, ...sesSecenekleri() })) === "yalnizHoparlor") {
    useOdaDeposu.setState({ hata: "media.micNotGranted" });
  }
}

export function mikrofonuDegistir(ac: boolean): Promise<void> {
  return surucu().mikrofon(ac, sesSecenekleri());
}

/**
 * Kamerayı tercih edilen cihaz, ayna ve arka planla açar / kapatır. Arka
 * plan uygulanamadıysa kamera arka plansız açılmıştır; kullanıcı uyarılır.
 */
export async function kamerayiDegistir(ac: boolean): Promise<void> {
  const { arkaPlanUygulandi } = await surucu().kamera(ac, ac ? kameraSecenekleri() : undefined);
  // Kapanınca eski (görüntü dönemindeki) ağ ölçümüm atılır.
  if (!ac) depoyaUygula((d) => agOlcumunuSil(d, d.benId));
  if (!arkaPlanUygulandi) useOdaDeposu.setState({ hata: "media.backgroundFailed" });
}

export function kamerayiCevir(): Promise<void> {
  return surucu().kamerayiCevir();
}

/** Ders içinde cihaz değişimi; tercih ve seçim her durumda saklanır. */
export async function cihazSec(tur: CihazTuru, id: string): Promise<void> {
  await surucu().cihazSec(tur, id);
  if (tur === "mikrofon") tercihleriYaz({ mikrofonId: id });
  else if (tur === "hoparlor") tercihleriYaz({ hoparlorId: id });
  else tercihleriYaz({ kameraId: id });
  depoyaUygula((d) => cihazSecildi(d, tur, id));
}

/** Kendi görüntümü aynala (yalnız bende görünür). */
export function aynala(ayna: boolean): Promise<void> {
  tercihleriYaz({ ayna });
  return surucu().aynala(ayna);
}

/** Ders içinde arka planı değiştirir (tercih her durumda saklanır). */
export async function arkaPlaniDegistir(ap: ArkaPlan): Promise<void> {
  tercihleriYaz({ arkaPlan: ap });
  const { uygulandi } = await surucu().arkaPlan(ap);
  if (!uygulandi) useOdaDeposu.setState({ hata: "media.backgroundFailed" });
}

/** Ekranımı paylaş. Hata fırlatılır; tepkisi `paylasimHatasiTuru`. */
export async function paylasimiBaslat(): Promise<void> {
  await surucu().paylasimiBaslat();
  depoyaUygula((d) => benimPaylasimim(d, true));
}

export async function paylasimiDurdur(): Promise<void> {
  try {
    await surucu().paylasimiDurdur();
  } finally {
    depoyaUygula((d) => benimPaylasimim(d, false));
  }
}

/**
 * YALNIZ kendini oturumdan çıkarır — sürücünün `ayril`ına TEK kapı. "Biz
 * ayrılıyoruz" bayrağı sürücüden ÖNCE yazılır: kendi kapanış olayımız
 * "bağlantı koptu" sayılmasın.
 */
export function ayril(): Promise<void> {
  useOdaDeposu.setState({ ayriliyor: true });
  return surucu().ayril();
}
