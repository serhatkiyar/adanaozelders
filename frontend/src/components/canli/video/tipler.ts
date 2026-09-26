/**
 * Sağlayıcıdan bağımsız görüntülü ders arayüzü (sürücü cephesi).
 *
 * KURAL: `video/<saglayici>/*` dosyaları `odaDeposu`, `tercihler` ve i18n
 * import ETMEZ. Sürücü yalnız olay yayar ve sonuç döndürür; depoya ve
 * tercihlere yazan tek yer nötr katmandır (`oda/durum/*`). Bu dosya SDK
 * import etmez.
 *
 * Tepki ve el kaldırma bu arayüzde YOK: taşıyıcıları Centrifugo `ders:{id}`
 * kanalıdır (`oda/durum/tepkiler.ts`, `tahta/dersKanali.ts`).
 */
import type { ComponentType } from "react";

import type { Yerlesim } from "@/lib/sinifDuzeni";

import type { ArkaPlan } from "./arkaPlan";

export type { ArkaPlan };

export type SaglayiciAdi = "zoom" | "agora";
/** Zoom: `String(userId)`; Agora: `"t12"` | `"c34"`. */
export type KatilimciId = string;
export type DersRolu = "ogretmen" | "ogrenci";

export interface HamKatilimci {
  id: KatilimciId;
  ad: string;
  ben: boolean;
  rol: DersRolu | null;
  videoAcik: boolean;
  /** Sese bağlı ve susturulmuş. Sese hiç bağlı değilken de kapalı sayılır. */
  mikKapali: boolean;
  sesBagli: boolean;
  /** `paylasimiEsitle` koruması: listede paylaşıyor görünen kabul edilir. */
  paylasiyor: boolean;
  yenidenBaglaniyor: boolean;
}

/** SDK/tarayıcı cihaz kaydının kullandığımız alt kümesi. */
export interface HamCihaz {
  deviceId: string;
  label: string;
  kind?: string;
}

export type CihazTuru = "mikrofon" | "hoparlor" | "kamera";

/** Sürücünün o anki ham cihaz listeleri ve etkin cihazları. */
export interface Cihazlar {
  listeler: { [T in CihazTuru]: readonly HamCihaz[] };
  secili: { [T in CihazTuru]?: string };
}

export type SurucuHataKodu =
  | "kameraYok"
  | "kameraMesgul"
  | "mikIzniYok"
  | "kameraIzniYok"
  | "paylasimIptal"
  | "paylasimReddedildi"
  | "paylasimYetkiYok"
  | "biletSuresiDoldu"
  | "dersBitti"
  | "bilinmeyen";

/**
 * Sürücünün sınıflandırılmış hatası. Nötr hata eşleyicileri
 * (`kameraHataAnahtari`, `mikIzniReddedildiMi`, `paylasimHatasiTuru`) önce
 * buna bakar; Zoom sürücüsü bugün ham SDK hatasını fırlatmayı sürdürür.
 */
export class SurucuHatasi extends Error {
  readonly kod: SurucuHataKodu;
  readonly ham?: unknown;
  constructor(kod: SurucuHataKodu, ham?: unknown) {
    super(kod);
    this.name = "SurucuHatasi";
    this.kod = kod;
    this.ham = ham;
  }
}

export type VideoOlayi =
  /** Tam liste; `*-ekran` kimlikleri ASLA listede yok. */
  | { t: "katilimcilar"; liste: HamKatilimci[] }
  | { t: "baglanti"; durum: "bagli" | "yenidenBaglaniyor" | "kapandi" }
  | { t: "konusanlar"; idler: KatilimciId[] }
  /** Kendi mikrofon seviyem, 0–9. */
  | { t: "sesSeviyem"; seviye: number }
  /**
   * Ağ kalitesi, 0–5. Alan yoksa o yön değişmez; `null` o yönün ölçümünü
   * siler (kamera kapandı / bilinmiyor).
   */
  | { t: "ag"; id: KatilimciId; yukari?: number | null; asagi?: number | null }
  /** Kendi ses bağlantımın kalitesi (0–5); `null` ölçüm yok. */
  | { t: "sesKalitesi"; encode: number | null; decode: number | null }
  | { t: "sesEngellendi"; engellendi: boolean }
  | { t: "cihazlarDegisti" }
  | { t: "kapaliykenKonusma" }
  | { t: "medyaHatasi" }
  /**
   * Karşı tarafın paylaşımı (sahibin kimliği; Agora'da `"t12-ekran"` →
   * `"t12"`), `null` bitti. `esitle`: olay değil anlık okuma (katılınca /
   * yeniden bağlanınca) — yalnız listede paylaşıyor görünen kabul edilir.
   */
  | { t: "paylasim"; id: KatilimciId | null; esitle?: boolean }
  /** Kendi paylaşımım dışarıdan durdu (tarayıcının "Paylaşımı durdur"u). */
  | { t: "paylasimBitti" }
  | { t: "paylasimYuzeyi"; tumEkran: boolean }
  /** Bilet bitmek üzere; nötr katman `biletTazele` → `bileTazele` çağırır. */
  | { t: "biletSonu"; kalanSn: number };

export interface NotrBilet {
  saglayici: SaglayiciAdi;
  rol: DersRolu;
  /** Karşı tarafa görünen ad (sunucudan). */
  ad: string;
  /** Biletin son geçerlilik anı (ISO). */
  bitis: string;
  /** Agora'da zorunlu; Zoom `null`. */
  karsi: { id: KatilimciId; ad: string; rol: DersRolu } | null;
  /** Sağlayıcının kendi bilet yanıtı (yalnız sürücü okur). */
  ham: unknown;
}

export interface KatilSecenekleri {
  biletTazele: () => Promise<NotrBilet>;
  /**
   * Tek kişi kalınca oturumun kapanma süresi (dk). Zoom `join`e verilir:
   * verilmezse Zoom'un 40 dk varsayılanı dersi erken kapatabilirdi.
   */
  bostaKalmaDk: number;
}

export interface KameraSecenekleri {
  kameraId?: string;
  ayna: boolean;
  arkaPlan: ArkaPlan;
}

export interface SesSecenekleri {
  mikId?: string;
  hoparlorId?: string;
}

export interface MedyaKatmaniProps {
  yerlesim: Pick<Yerlesim, "video" | "benKaro" | "karsiKaro" | "paylasim" | "yuzen">;
  /** Paylaşım başlığı (ve `AynaUyarisi`) genel sahnede; medya altında kalır. */
  paylasimBaslikPx: number;
  benId: KatilimciId | null;
  benVideo: boolean;
  ayna: boolean;
  karsiId: KatilimciId | null;
  karsiVideo: boolean;
  aktifPaylasim: KatilimciId | null;
  benPaylasiyorum: boolean;
}

export interface VideoSurucusu {
  ad: SaglayiciAdi;
  /** Zoom `false` (katıldı/ayrıldı farkı ada göre), Agora `true`. */
  kararliKimlik: boolean;
  hazirla(): Promise<void>;
  katil(bilet: NotrBilet, s: KatilSecenekleri): Promise<{ benId: KatilimciId; ilk: HamKatilimci[] }>;
  /** Yalnız kendini çıkarır; `ayriliyor`u nötr katman ÖNCE yazar. */
  ayril(): Promise<void>;
  oturumdaMi(): boolean;
  olaylar(dinle: (o: VideoOlayi) => void): () => void;
  /** Agora: iki client'ta `renewToken`; Zoom: işsiz. */
  bileTazele(b: NotrBilet): Promise<void>;

  sesiBaslat(o: { mute: boolean } & SesSecenekleri): Promise<"tam" | "yalnizHoparlor">;
  /**
   * "Sesi aç": ses bağlı değilse kullanıcı hareketiyle yeniden başlatır
   * (sonucu döner); bağlıysa yalnız engeli kaldırır ve `"tam"` döner.
   */
  sesiAc(o: { mikAcik: boolean } & SesSecenekleri): Promise<"tam" | "yalnizHoparlor">;
  /** Ses bağlı değilse önce sesi kurar; izin yoksa `NotAllowedError` fırlatır. */
  mikrofon(ac: boolean, o?: SesSecenekleri): Promise<void>;
  kamera(ac: boolean, o?: KameraSecenekleri): Promise<{ arkaPlanUygulandi: boolean }>;
  kamerayiCevir(): Promise<void>;
  aynala(ayna: boolean): Promise<void>;
  arkaPlan(ap: ArkaPlan): Promise<{ uygulandi: boolean }>;
  cihazSec(tur: CihazTuru, id: string): Promise<void>;
  cihazlar(): Cihazlar | null;

  paylasimiBaslat(): Promise<void>;
  paylasimiDurdur(): Promise<void>;
  paylasimDevralabilir(): boolean;

  destekler: {
    /** Sanal arka plan (Agora eklentisi tembel yüklenir). */
    arkaPlan(): Promise<boolean>;
    hoparlorSecimi(): boolean;
    ekranPaylasimi(): boolean;
    kameraCevirme(): boolean;
    kapaliykenKonusma: boolean;
  };
  onizleme: {
    /** İç öğeyi (video/canvas) ve aynayı sürücü kurar. */
    kameraBaslat(kap: HTMLElement, o: KameraSecenekleri): Promise<{ arkaPlanUygulandi: boolean }>;
    kameraSec(id: string): Promise<void>;
    arkaPlan(ap: ArkaPlan): Promise<{ uygulandi: boolean }>;
    kameraDurdur(): Promise<void>;
    sesBaslat(micId?: string): Promise<void>;
    sesDurdur(): Promise<void>;
    /** Gösterime hazır 0–1. */
    seviye(): number;
    hoparloruDene(id?: string): (() => void) | null;
    cihazlariGetir(): Promise<HamCihaz[]>;
    durdur(): Promise<void>;
  };
  /** Kararlı bileşen: sahne her çizimde aynı referansı kullanır. */
  MedyaKatmani: ComponentType<MedyaKatmaniProps>;
}
