/**
 * Sürücü olayı → oda durumu dönüşümleri. SAF ve sağlayıcıdan bağımsız: SDK
 * import edilmez; sürücünün nötr olaylarıyla (`video/tipler.ts`
 * `VideoOlayi`) çalışır, böylece jsdom'da SDK yüklenmeden sınanabilir.
 *
 * Katılımcı olaylarında sürücü TAM listeyi verir (`katilimcilariEsitle`).
 * Kimlikler metindir (Zoom: `String(userId)`).
 */
import type { KarsiTarafDurumu } from "@/lib/canliDers";

import {
  SurucuHatasi,
  type CihazTuru,
  type DersRolu,
  type HamCihaz,
  type HamKatilimci,
  type KatilimciId,
} from "../../video/tipler";

export type { CihazTuru, HamCihaz };

export interface Katilimci {
  id: KatilimciId;
  ad: string;
  rol: DersRolu | null;
  videoAcik: boolean;
  /** Sese bağlı ve susturulmuş. Sese hiç bağlı değilken de kapalı sayılır. */
  mikKapali: boolean;
  sesBagli: boolean;
  paylasiyor: boolean;
  /** Bağlantısı kopmuş, yeniden kuruluyor (Zoom `isInFailover`). */
  yenidenBaglaniyor: boolean;
}

/**
 * Ağ kalitesi son değerleri (0–5). Kamera kapanınca eski değer
 * atılır; sonrasında gelen (SDK'nın ses yolundan da yayınladığı) değerler tutulur.
 */
export interface AgOlcumu {
  uplink?: number;
  downlink?: number;
}

/** `onizleme` → `katiliyor` → `odada`; hata olursa önizlemeye döner. */
export type Asama = "onizleme" | "katiliyor" | "odada";

export type Baglanti = "bagli" | "yenidenBaglaniyor" | "kapandi";

export interface OdaDurumu {
  asama: Asama;
  baglanti: Baglanti | null;
  benId: KatilimciId | null;
  katilimcilar: Katilimci[];
  /** Şu an konuşanların kimlikleri. */
  konusanlar: KatilimciId[];
  /** Tarayıcı sesi başlatmayı engelledi → "Sesi aç" düğmesi. */
  sesEngellendi: boolean;
  /** Karşı taraf bu oturumda en az bir kez görüldü mü (bekleniyor / ayrıldı ayrımı). */
  karsiTarafGoruldu: boolean;
  /** Ayrılmayı biz başlattık: gelen Closed olayı "bağlantı koptu" sayılmaz. */
  ayriliyor: boolean;
  /** Kullanıcıya gösterilecek son hata (i18n anahtarı). */
  hata: string | null;
  /** Önizlemede `getDevices`, odada `get*List` ile okunan cihazlar. */
  cihazlar: CihazListeleri;
  /** Kullanılan (odada) ya da kullanılacak (önizlemede) cihaz kimlikleri. */
  secili: SeciliCihazlar;
  /** Odada kendi mikrofon seviyem (0–9). */
  sesSeviyesi: number;
  izinler: { kamera: IzinDurumu; mikrofon: IzinDurumu };
  /** İzin yönlendirme penceresi açık mı. */
  izinPenceresi: boolean;
  /** Kullanıcı kimliğine göre son ağ kalitesi ölçümleri. */
  agKaliteleri: Record<KatilimciId, AgOlcumu>;
  /**
   * KENDİ ses bağlantımın kalitesi (0–5): `encode` gönderdiğim, `decode`
   * aldığım ses. Kamera kapalıyken kendi kartımın göstergesi buradan; veri
   * kesilince (susunca) sürücü `null` bildirir.
   */
  sesKalitesi: SesKalitesi;
  /** Tepki taşıyıcısı (Centrifugo `ders:{id}`) kullanılabilir mi. */
  tepkiKanali: boolean;
  /** Kendi elim kalkık mı. */
  elimKalkik: boolean;
  /** Elini kaldıran diğer katılımcıların kimlikleri. */
  kalkikEller: KatilimciId[];
  /** Ekranda yükselen tepkiler (en çok `EN_COK_TEPKI`). */
  tepkiler: UcanTepki[];
  /** Karşı tarafın izlenen ekran paylaşımı (sahibinin kimliği); yoksa `null`. */
  aktifPaylasim: KatilimciId | null;
  /** Kendi ekranımı paylaşıyorum (başlatma başarılı → durdurulana dek). */
  benPaylasiyorum: boolean;
  /** Kendi paylaşımım tüm ekran (sonsuz yansıma uyarısı). */
  benTumEkran: boolean;
}

export interface UcanTepki {
  id: number;
  emoji: TepkiEmojisi;
  ad: string;
  ben: boolean;
  /** Yatay konum, sahne genişliğine oran (0–1). */
  sol: number;
}

export interface SesKalitesi {
  encode?: number;
  decode?: number;
}

export interface Cihaz {
  id: string;
  ad: string;
}

export interface CihazListeleri {
  mikrofon: Cihaz[];
  hoparlor: Cihaz[];
  kamera: Cihaz[];
}


export interface SeciliCihazlar {
  mikrofon?: string;
  hoparlor?: string;
  kamera?: string;
}

/** `navigator.permissions` durumu. */
export type IzinDurumu = "granted" | "denied" | "prompt" | "bilinmiyor";

export const BASLANGIC: OdaDurumu = {
  asama: "onizleme",
  baglanti: null,
  benId: null,
  katilimcilar: [],
  konusanlar: [],
  sesEngellendi: false,
  karsiTarafGoruldu: false,
  ayriliyor: false,
  hata: null,
  cihazlar: { mikrofon: [], hoparlor: [], kamera: [] },
  secili: {},
  sesSeviyesi: 0,
  izinler: { kamera: "bilinmiyor", mikrofon: "bilinmiyor" },
  izinPenceresi: false,
  agKaliteleri: {},
  sesKalitesi: {},
  tepkiKanali: false,
  elimKalkik: false,
  kalkikEller: [],
  tepkiler: [],
  aktifPaylasim: null,
  benPaylasiyorum: false,
  benTumEkran: false,
};

/** Sürücünün ham kaydı → depodaki katılımcı (`ben` bayrağı `benId`de). */
function katilimciya(k: HamKatilimci): Katilimci {
  return {
    id: k.id,
    ad: k.ad,
    rol: k.rol,
    videoAcik: k.videoAcik,
    mikKapali: k.mikKapali,
    sesBagli: k.sesBagli,
    paylasiyor: k.paylasiyor,
    yenidenBaglaniyor: k.yenidenBaglaniyor,
  };
}

/**
 * Sürücünün bildirdiği TAM listeyle durumu eşitler. Listede `ben` yoksa
 * (henüz katılmadan) önceki kimlik korunur.
 */
export function katilimcilariEsitle(durum: OdaDurumu, liste: readonly HamKatilimci[]): OdaDurumu {
  const benId = liste.find((k) => k.ben)?.id ?? durum.benId;
  const katilimcilar = liste.map(katilimciya);
  const digerVar = katilimcilar.some((k) => k.id !== benId);
  return {
    ...durum,
    benId,
    katilimcilar,
    karsiTarafGoruldu: durum.karsiTarafGoruldu || digerVar,
    // Ayrılan kişi konuşanlar listesinde kalmasın.
    konusanlar: durum.konusanlar.filter((id) => katilimcilar.some((k) => k.id === id)),
    agKaliteleri: agKaliteleriniBuda(durum.agKaliteleri, katilimcilar),
    // Ayrılanın kalkık eli kalmasın.
    kalkikEller: ayniysaKoru(
      durum.kalkikEller,
      durum.kalkikEller.filter((id) => katilimcilar.some((k) => k.id === id)),
    ),
    // Paylaşan ayrıldıysa paylaşımı da gitmiştir (bitiş olayı gelmeyebilir).
    aktifPaylasim:
      durum.aktifPaylasim !== null && katilimcilar.some((k) => k.id === durum.aktifPaylasim)
        ? durum.aktifPaylasim
        : null,
  };
}

/**
 * Ayrılanın (ya da kimliği değişenin) eski ölçümü atılır. Kamerası kapanan
 * kalır: kapanış anındaki eski değeri `videoDurumuDegisti` zaten sildi,
 * sonrasında gelenler (SDK ses yolundan da yayınlar) gerçek ölçümdür.
 */
function agKaliteleriniBuda(
  olcumler: Record<KatilimciId, AgOlcumu>,
  katilimcilar: readonly Katilimci[],
): Record<KatilimciId, AgOlcumu> {
  const sonuc: Record<KatilimciId, AgOlcumu> = {};
  let degisti = false;
  for (const [id, olcum] of Object.entries(olcumler)) {
    if (katilimcilar.some((k) => k.id === id)) sonuc[id] = olcum;
    else degisti = true;
  }
  return degisti ? sonuc : olcumler;
}

/**
 * Ağ kalitesi olayı: alanı olmayan yön değişmez, `null` o yönü siler; iki
 * yön de boşalırsa ölçüm atılır. Değişmediyse AYNI durum.
 */
export function agKalitesiDegisti(
  durum: OdaDurumu,
  olay: { id: KatilimciId; yukari?: number | null; asagi?: number | null },
): OdaDurumu {
  const onceki = durum.agKaliteleri[olay.id];
  const yeni: AgOlcumu = { ...onceki };
  const yaz = (alan: keyof AgOlcumu, deger: number | null | undefined) => {
    if (deger === undefined) return;
    if (deger === null || !Number.isFinite(deger)) delete yeni[alan];
    else yeni[alan] = deger;
  };
  yaz("uplink", olay.yukari);
  yaz("downlink", olay.asagi);
  if (
    (onceki?.uplink ?? null) === (yeni.uplink ?? null) &&
    (onceki?.downlink ?? null) === (yeni.downlink ?? null)
  ) {
    return durum;
  }
  const agKaliteleri = { ...durum.agKaliteleri };
  if (yeni.uplink === undefined && yeni.downlink === undefined) delete agKaliteleri[olay.id];
  else agKaliteleri[olay.id] = yeni;
  return { ...durum, agKaliteleri };
}

function enKotu(degerler: Array<number | undefined>): number | null {
  const gecerli = degerler.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return gecerli.length ? Math.min(...gecerli) : null;
}

/**
 * Gösterilecek seviye: bilinen yönlerin en kötüsü. Ağ ölçümü yoksa kendi
 * kartım için ses istatistiği; o da yoksa `null` (gösterge gizlenir).
 */
export function agSeviyesi(durum: OdaDurumu, id: KatilimciId | undefined): number | null {
  if (id === undefined) return null;
  const olcum = durum.agKaliteleri[id];
  const ag = olcum ? enKotu([olcum.uplink, olcum.downlink]) : null;
  if (ag !== null) return ag;
  if (id !== durum.benId) return null;
  return enKotu([durum.sesKalitesi.encode, durum.sesKalitesi.decode]);
}

/** Kendi kameramı kapatınca eski (görüntü dönemindeki) ağ ölçümüm atılır. */
export function agOlcumunuSil(durum: OdaDurumu, id: KatilimciId | null): OdaDurumu {
  if (id === null || !(id in durum.agKaliteleri)) return durum;
  const agKaliteleri = { ...durum.agKaliteleri };
  delete agKaliteleri[id];
  return { ...durum, agKaliteleri };
}

/** Ses istatistiği seviyesi; değişmediyse AYNI durum (her saniye gelir). */
export function sesKalitesiDegisti(
  durum: OdaDurumu,
  yon: keyof SesKalitesi,
  seviye: number | null,
): OdaDurumu {
  const onceki = durum.sesKalitesi[yon];
  if ((onceki ?? null) === seviye) return durum;
  const sesKalitesi = { ...durum.sesKalitesi };
  if (seviye === null) delete sesKalitesi[yon];
  else sesKalitesi[yon] = seviye;
  return { ...durum, sesKalitesi };
}

/**
 * Medya yakalama/çözme beklenmedik biçimde durdu (Zoom `active-media-failed`).
 * Önerilen çözüm sayfayı yenilemek; şerit "Sayfayı yenile" düğmesiyle çıkar.
 */
export function medyaHatasi(durum: OdaDurumu): OdaDurumu {
  return { ...durum, hata: MEDYA_HATASI };
}

export const MEDYA_HATASI = "media.activeMediaFailed";

/**
 * Katıldı/ayrıldı bildirimleri için iki liste arasındaki fark. Kimlik değil
 * AD karşılaştırılır: Zoom kimliği yeniden bağlanınca değişebilir, birebir
 * derste ad kararlıdır. Kendimiz hiçbir zaman bildirilmeyiz.
 */
export function digerAdlari(liste: readonly Katilimci[], benId: KatilimciId | null): Set<string> {
  return new Set(liste.filter((k) => k.id !== benId).map((k) => k.ad));
}

/**
 * `eski` o anki `benId` ile ALINMIŞ olmalı (`digerAdlari`): kendi kimliğimiz
 * yeniden bağlanınca değişirse eski kaydımız "ayrıldı" sayılmasın.
 */
export function katilimciFarki(
  eski: ReadonlySet<string>,
  yeni: ReadonlySet<string>,
): { katilanlar: string[]; ayrilanlar: string[] } {
  return {
    katilanlar: [...yeni].filter((ad) => !eski.has(ad)),
    ayrilanlar: [...eski].filter((ad) => !yeni.has(ad)),
  };
}

export function baglantiDegisti(durum: OdaDurumu, baglanti: Baglanti): OdaDurumu {
  // Ölçümler burada SİLİNMEZ: olay yalnız değişimde gelir, aynı seviyede
  // dönen bağlantı yeniden bildirmeyebilir. Kimliği değişenin ölçümünü
  // yeniden okunan liste (`agKaliteleriniBuda`) atar.
  return durum.baglanti === baglanti ? durum : { ...durum, baglanti };
}

/** Kopan bağlantı yeniden kuruldu mu (Reconnecting → Connected)? */
export function yenidenBaglandi(onceki: Baglanti | null, sonraki: Baglanti | null): boolean {
  return onceki === "yenidenBaglaniyor" && sonraki === "bagli";
}

/**
 * Oturum BİZİM ayrılmamız dışında mı kapandı? (`onKapandi` tetikleyicisi —
 * yalnız odadayken ve ayrılmayı biz başlatmadıysak.)
 */
export function beklenmedikKapanis(durum: OdaDurumu): boolean {
  return durum.asama === "odada" && durum.baglanti === "kapandi" && !durum.ayriliyor;
}

/** Şu an konuşanlar. */
export function aktifKonusanlar(durum: OdaDurumu, idler: readonly KatilimciId[]): OdaDurumu {
  return { ...durum, konusanlar: [...idler] };
}

export function sesEngellendi(durum: OdaDurumu, engellendi: boolean): OdaDurumu {
  return { ...durum, sesEngellendi: engellendi };
}

export function benKimim(durum: OdaDurumu): Katilimci | null {
  return durum.katilimcilar.find((k) => k.id === durum.benId) ?? null;
}

/** Birebir derste karşı taraf: kendimiz dışındaki ilk katılımcı. */
export function karsiTaraf(durum: OdaDurumu): Katilimci | null {
  if (durum.benId === null) return null;
  return durum.katilimcilar.find((k) => k.id !== durum.benId) ?? null;
}

export function karsiTarafDurumu(durum: OdaDurumu): KarsiTarafDurumu {
  if (karsiTaraf(durum)) return "odada";
  return durum.karsiTarafGoruldu ? "ayrildi" : "bekleniyor";
}

/**
 * Hatanın aranabilir metni: `Error` için ad + ileti; Zoom'un çözülmüş
 * sonuç nesnesi (`{type, reason}`) için o alanlar; diğerleri dizeye.
 */
export function hataMetni(hata: unknown): string {
  if (hata instanceof SurucuHatasi) return `${hata.kod} ${hataMetni(hata.ham)}`;
  if (hata instanceof Error) return `${hata.name} ${hata.message}`;
  if (typeof hata === "object" && hata !== null) {
    const { type, reason, name, message } = hata as Record<string, unknown>;
    return [type, reason, name, message].map((v) => String(v ?? "")).join(" ");
  }
  return String(hata ?? "");
}

/**
 * Önizleme ya da oda kamerasının hatası → gösterilecek ipucunun i18n
 * anahtarı. Tarayıcı `DOMException` adları (getUserMedia) ve Zoom hata
 * dizeleri (`startVideo` hatayı düz nesne olarak da döndürür).
 */
export function kameraHataAnahtari(hata: unknown): string {
  if (hata instanceof SurucuHatasi) {
    if (hata.kod === "kameraIzniYok") return "join.cameraNotGranted";
    if (hata.kod === "kameraYok") return "join.cameraNotFound";
    if (hata.kod === "kameraMesgul") return "join.cameraInUse";
  }
  const ad = hataMetni(hata);
  if (/NotAllowed|Permission|FORBIDDEN/i.test(ad)) return "join.cameraNotGranted";
  if (/NotFound|CAN_NOT_DETECT|DevicesNotFound/i.test(ad)) return "join.cameraNotFound";
  if (/NotReadable|IS_TAKEN|TrackStart|in use/i.test(ad)) return "join.cameraInUse";
  return "media.deviceError";
}

/**
 * `startAudio` hatası mikrofon izninin reddi mi? Zoom bunu
 * `INSUFFICIENT_PRIVILEGES` / `AUDIO_CAPTURE_FAILED` ile bildirir; bazı
 * tarayıcılar getUserMedia'nın `NotAllowedError`ını olduğu gibi geçirir.
 * Otomatik oynatma engeli (kullanıcı etkinleşmesi kaybı) bu değildir.
 */
export function mikIzniReddedildiMi(hata: unknown): boolean {
  if (hata instanceof SurucuHatasi && hata.kod === "mikIzniYok") return true;
  const metin = hataMetni(hata);
  return /AUDIO_CAPTURE_FAILED|INSUFFICIENT_PRIVILEGES|NotAllowed|Permission denied/i.test(metin);
}

/* ── Cihazlar ve izinler (Paket 2) ──────────────────────────────────── */

const TUR_KIND: Record<CihazTuru, string> = {
  mikrofon: "audioinput",
  hoparlor: "audiooutput",
  kamera: "videoinput",
};

/**
 * Ham listeyi seçiciye hazırlar: kimliksiz kayıtlar (izin yokken tarayıcı
 * boş kimlik verir) ve yinelenenler atılır; adsız cihaz sırayla adlanır.
 * `kind` taşıyan liste (ör. `getDevices`) türe göre süzülür.
 */
export function cihazListesi(
  ham: readonly HamCihaz[],
  tur: CihazTuru,
  yedekAd: string,
): Cihaz[] {
  const gorulen = new Set<string>();
  const sonuc: Cihaz[] = [];
  for (const c of ham) {
    if (c.kind !== undefined && c.kind !== TUR_KIND[tur]) continue;
    if (!c.deviceId || gorulen.has(c.deviceId)) continue;
    gorulen.add(c.deviceId);
    sonuc.push({ id: c.deviceId, ad: c.label?.trim() || `${yedekAd} ${sonuc.length + 1}` });
  }
  return sonuc;
}

/** Kayıtlı kimlik listede hâlâ var mı? Yoksa `undefined` (sistem varsayılanı). */
export function gecerliCihazId(id: string | undefined, liste: readonly Cihaz[]): string | undefined {
  return id && liste.some((c) => c.id === id) ? id : undefined;
}

/**
 * Yeni listeler ve etkin kimlikler. Boş gelen liste öncekini SİLMEZ: oda
 * SDK'sı listeyi ses/kamera başlayana dek boş verebilir; önizlemenin
 * (`getDevices`) okuduğu aynı tarayıcı kimlikleri o arada geçerli kalır.
 * Tanımsız etkin kimlik de önceki seçimi ezmez.
 */
export function cihazlarDegisti(
  durum: OdaDurumu,
  cihazlar: CihazListeleri,
  secili: SeciliCihazlar,
): OdaDurumu {
  const birlesik: CihazListeleri = {
    mikrofon: cihazlar.mikrofon.length ? cihazlar.mikrofon : durum.cihazlar.mikrofon,
    hoparlor: cihazlar.hoparlor.length ? cihazlar.hoparlor : durum.cihazlar.hoparlor,
    kamera: cihazlar.kamera.length ? cihazlar.kamera : durum.cihazlar.kamera,
  };
  const yeniSecili: SeciliCihazlar = { ...durum.secili };
  for (const tur of ["mikrofon", "hoparlor", "kamera"] as const) {
    if (secili[tur]) yeniSecili[tur] = secili[tur];
  }
  return { ...durum, cihazlar: birlesik, secili: yeniSecili };
}

export function cihazSecildi(durum: OdaDurumu, tur: CihazTuru, id: string): OdaDurumu {
  return { ...durum, secili: { ...durum.secili, [tur]: id } };
}

/** `navigator.permissions` izin değişimi. */
export function izinDegisti(
  durum: OdaDurumu,
  olay: { name: "camera" | "microphone"; state: string },
): OdaDurumu {
  const state: IzinDurumu =
    olay.state === "granted" || olay.state === "denied" || olay.state === "prompt"
      ? olay.state
      : "bilinmiyor";
  const anahtar = olay.name === "camera" ? "kamera" : "mikrofon";
  if (durum.izinler[anahtar] === state) return durum;
  const izinler = { ...durum.izinler, [anahtar]: state };
  // Meet: istenen izin verilince yönlendirme penceresi kendiliğinden kapanır.
  const izinPenceresi =
    durum.izinPenceresi && !(izinler.kamera !== "denied" && izinler.mikrofon !== "denied");
  return { ...durum, izinler, izinPenceresi };
}

/** Odada kendi mikrofon seviyem (0–9) → çubuk oranı. */
export function odaSeviyeOrani(seviye: number): number {
  if (!Number.isFinite(seviye) || seviye <= 0) return 0;
  return Math.min(1, seviye / 9);
}

const YEDEK_AD: Record<CihazTuru, string> = {
  mikrofon: "Mikrofon",
  hoparlor: "Hoparlör",
  kamera: "Kamera",
};

/** Üç tür için ham listeler (odada) ya da tek karışık liste (önizlemede). */
export function listeleriKur(
  ham: readonly HamCihaz[] | { [T in CihazTuru]: readonly HamCihaz[] },
): CihazListeleri {
  const kaynak = (tur: CihazTuru) => ("length" in ham ? ham : ham[tur]);
  return {
    mikrofon: cihazListesi(kaynak("mikrofon"), "mikrofon", YEDEK_AD.mikrofon),
    hoparlor: cihazListesi(kaynak("hoparlor"), "hoparlor", YEDEK_AD.hoparlor),
    kamera: cihazListesi(kaynak("kamera"), "kamera", YEDEK_AD.kamera),
  };
}

/** Seçicide görünen kimlik: geçerli tercih, yoksa listenin ilki (sistem varsayılanı). */
export function gorunenCihazId(
  tercih: string | undefined,
  liste: readonly Cihaz[],
): string | undefined {
  return gecerliCihazId(tercih, liste) ?? liste[0]?.id;
}

/* ── Ekran paylaşımı (Paket 4) ──────────────────────────────────────── */

/**
 * Karşı tarafın paylaşımı başladı (`id`) / bitti (`null`). Kendi
 * paylaşımımız burada izlenmez (`benPaylasiyorum`); kendi kimliğimizle gelen
 * olay yok sayılır.
 */
export function aktifPaylasimDegisti(durum: OdaDurumu, id: KatilimciId | null): OdaDurumu {
  if (id !== null) {
    if (id === durum.benId || durum.aktifPaylasim === id) return durum;
    return { ...durum, aktifPaylasim: id };
  }
  if (durum.aktifPaylasim !== null) {
    // Kimlik eşleşmese de temizlenir: birebir derste tek paylaşım izlenir.
    return { ...durum, aktifPaylasim: null };
  }
  return durum;
}

/**
 * Katılınca / yeniden bağlanınca sürücünün okuduğu o anki paylaşım (yoksa
 * `null`). Olay kaçtıysa boşluğu doldurur; yalnız listede paylaşıyor görünen
 * karşı taraf kabul edilir (bayat kimlik düzeni geri getirmesin).
 */
export function paylasimiEsitle(durum: OdaDurumu, aktifId: KatilimciId | null): OdaDurumu {
  if (durum.aktifPaylasim !== null || !aktifId || aktifId === durum.benId) return durum;
  const paylasan = durum.katilimcilar.find((k) => k.id === aktifId);
  return paylasan?.paylasiyor ? { ...durum, aktifPaylasim: aktifId } : durum;
}

/** Kendi paylaşımım başladı / durdu (düğme ya da tarayıcının "Paylaşımı durdur"u). */
export function benimPaylasimim(durum: OdaDurumu, acik: boolean, tumEkran = false): OdaDurumu {
  return { ...durum, benPaylasiyorum: acik, benTumEkran: acik && tumEkran };
}

/** Sahnede paylaşım düzeni mi? Kendi paylaşımım da büyük gösterilir. */
export function paylasimVar(durum: OdaDurumu): boolean {
  return durum.benPaylasiyorum || durum.aktifPaylasim !== null;
}

/** Zoom `errorCode`: kullanıcı seçiciyi kapattı / sistem ayarı izin vermiyor. */
const PAYLASIM_KULLANICI_REDDI = 6200;
const PAYLASIM_SISTEM_REDDI = 6201;
/** Zoom `SCREEN_SHARE_HOST_PRIVILEGE_REQUIRED`: başkası paylaşırken yalnız host devralabilir. */
const PAYLASIM_HOST_GEREKLI = 6204;

export type PaylasimHatasiTuru = "iptal" | "izin" | "mesgul" | "diger";

/**
 * `startShareScreen` hatası → tepki. Kullanıcı seçiciden vazgeçtiyse sessiz
 * kalınır (Meet de yalnız sistem reddinde pencere açar); izin/sistem reddi
 * yönlendirme penceresi, diğerleri kısa bildirim.
 *
 * SDK 2.5.0'da seçiciden vazgeçme 6200, izin ve macOS ekran kaydı reddi
 * 6201 döner; tarayıcının `DOMException`ı olduğu gibi gelirse Meet'in
 * ayrımı ("by system") kullanılır.
 */
export function paylasimHatasiTuru(hata: unknown): PaylasimHatasiTuru {
  if (hata instanceof SurucuHatasi) {
    if (hata.kod === "paylasimIptal") return "iptal";
    if (hata.kod === "paylasimReddedildi") return "izin";
    if (hata.kod === "paylasimYetkiYok") return "mesgul";
  }
  if (typeof hata === "object" && hata !== null) {
    const kod = (hata as { errorCode?: unknown }).errorCode;
    if (kod === PAYLASIM_SISTEM_REDDI) return "izin";
    if (kod === PAYLASIM_KULLANICI_REDDI) return "iptal";
    if (kod === PAYLASIM_HOST_GEREKLI) return "mesgul";
  }
  const metin = hataMetni(hata);
  if (/NotAllowedError/.test(metin)) return /by system/i.test(metin) ? "izin" : "iptal";
  if (/screen recording|allow the permission/i.test(metin)) return "izin";
  return "diger";
}

/* ── Tepkiler ve el kaldırma (Paket 6, Centrifugo `ders:{id}`) ──────── */

/** Meet `Emoji` kümesinin karşılığı; gelen mesajlar bu listeyle süzülür. */
export const TEPKI_EMOJILERI = ["👍", "👏", "❤️", "😂", "😮", "🎉"] as const;
export type TepkiEmojisi = (typeof TEPKI_EMOJILERI)[number];

/** Aynı anda ekranda en çok bu kadar tepki (eskisi düşer). */
export const EN_COK_TEPKI = 12;

/**
 * Ders kanalındaki tepki mesajları. `elSor`: (yeniden) abone olan ya da yeni
 * katılımcı gören taraf sorar, eli kalkık olan yeniden bildirir — kanalda
 * geçmiş yok, geç katılan kalkık eli başka türlü öğrenemez.
 */
export type TepkiMesaji =
  | { tur: "tepki"; emoji: TepkiEmojisi }
  | { tur: "el"; kalkik: boolean }
  | { tur: "elSor" };

/** Kanala giden kısa JSON gövdesi (`t` alanıyla `dersKanali.ts` yönlendirir). */
export function tepkiMesajiYaz(m: TepkiMesaji): { t: string; e?: string; k?: boolean } {
  if (m.tur === "tepki") return { t: "tepki", e: m.emoji };
  if (m.tur === "el") return { t: "el", k: m.kalkik };
  return { t: "elSor" };
}

/** Gelen gövdeyi doğrular; tanınmayan/bozuk mesaj `null`. SAF. */
export function tepkiMesajiCoz(veri: unknown): TepkiMesaji | null {
  if (typeof veri !== "object" || veri === null) return null;
  const v = veri as { t?: unknown; e?: unknown; k?: unknown };
  if (v.t === "tepki" && (TEPKI_EMOJILERI as readonly unknown[]).includes(v.e)) {
    return { tur: "tepki", emoji: v.e as TepkiEmojisi };
  }
  if (v.t === "el" && typeof v.k === "boolean") return { tur: "el", kalkik: v.k };
  if (v.t === "elSor") return { tur: "elSor" };
  return null;
}

/**
 * Kanal yayınının göndereni. Centrifugo yayını sağlayıcının katılımcı
 * kimliğini taşımaz, yalnız token'daki rolü (`chanInfo.rol`). Birebir derste
 * bir öğretmen bir öğrenci var: gönderen, o rolü taşıyan (kendimiz olmayan)
 * katılımcıdır. Rol bilinmiyor ya da kendi rolümüzse `null`. SAF.
 */
export function tepkiGondereni(
  durum: OdaDurumu,
  gonderenRol: DersRolu | null,
  benimRolum: DersRolu | null,
): Katilimci | null {
  if (gonderenRol === null || gonderenRol === benimRolum) return null;
  return durum.katilimcilar.find((k) => k.id !== durum.benId && k.rol === gonderenRol) ?? null;
}

function ayniysaKoru(eski: KatilimciId[], yeni: KatilimciId[]): KatilimciId[] {
  return eski.length === yeni.length ? eski : yeni;
}

/** Başka bir katılımcının eli kalktı / indi. */
export function eliDegisti(durum: OdaDurumu, id: KatilimciId, kalkik: boolean): OdaDurumu {
  const simdiKalkik = durum.kalkikEller.includes(id);
  if (simdiKalkik === kalkik) return durum;
  return {
    ...durum,
    kalkikEller: kalkik ? [...durum.kalkikEller, id] : durum.kalkikEller.filter((x) => x !== id),
  };
}

export function tepkiEkle(durum: OdaDurumu, tepki: UcanTepki): OdaDurumu {
  return { ...durum, tepkiler: [...durum.tepkiler, tepki].slice(-EN_COK_TEPKI) };
}

export function tepkiSil(durum: OdaDurumu, id: number): OdaDurumu {
  if (!durum.tepkiler.some((t) => t.id === id)) return durum;
  return { ...durum, tepkiler: durum.tepkiler.filter((t) => t.id !== id) };
}
