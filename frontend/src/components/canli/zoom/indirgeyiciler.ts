/**
 * Zoom olay → oda durumu dönüşümleri. SAF: SDK import edilmez, yalnız
 * olayların taşıdığı alanların küçük bir alt kümesiyle çalışır; böylece
 * jsdom'da SDK yüklenmeden sınanabilir.
 *
 * Olaylar SİNYALDİR: kullanıcı olaylarında gerçek durum `getAllUser()` /
 * `getCurrentUserInfo()` ile yeniden okunur ve `katilimcilariEsitle`ye
 * verilir (plan §2.2). Veri modeli Zoom'un kendisidir (`userId`, `bVideoOn`,
 * `muted`), LiveKit taklidi yoktur.
 */
import type { KarsiTarafDurumu } from "@/lib/canliDers";

/** Zoom `Participant`ın kullandığımız alt kümesi. */
export interface ZoomKullanici {
  userId: number;
  displayName: string;
  bVideoOn: boolean;
  /** Sese bağlı değilse `undefined`. */
  muted?: boolean;
  /** `''` sese bağlı değil, `computer` bilgisayar sesi. */
  audio?: string;
  /** Mikrofon izni yokken yalnız hoparlörle bağlı (`startAudio({ speakerOnly })`). */
  isSpeakerOnly?: boolean;
  sharerOn?: boolean;
  /** Katılımcının bağlantısı yeniden kuruluyor (Zoom failover). */
  isInFailover?: boolean;
}

export interface Katilimci {
  userId: number;
  ad: string;
  videoAcik: boolean;
  /** Sese bağlı ve susturulmuş. Sese hiç bağlı değilken de kapalı sayılır. */
  mikKapali: boolean;
  sesBagli: boolean;
  paylasiyor: boolean;
  /** Zoom `isInFailover`: bağlantısı kopmuş, yeniden kuruluyor. */
  yenidenBaglaniyor: boolean;
}

/** `network-quality-change` son değerleri (0–5); yalnız kamerası açık olanlar. */
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
  benId: number | null;
  katilimcilar: Katilimci[];
  /** Şu an konuşanların `userId`leri (`active-speaker`). */
  konusanlar: number[];
  /** Tarayıcı sesi başlatmayı engelledi → "Sesi aç" düğmesi. */
  sesEngellendi: boolean;
  /** Karşı taraf bu oturumda en az bir kez görüldü mü (bekleniyor / ayrıldı ayrımı). */
  karsiTarafGoruldu: boolean;
  /** Platform aynı kapta birden çok video çizebiliyor mu (`isSupportMultipleVideos`). */
  cokluVideo: boolean;
  /** Ayrılmayı biz başlattık: gelen Closed olayı "bağlantı koptu" sayılmaz. */
  ayriliyor: boolean;
  /** Kullanıcıya gösterilecek son hata (i18n anahtarı). */
  hata: string | null;
  /** Önizlemede `getDevices`, odada `get*List` ile okunan cihazlar. */
  cihazlar: CihazListeleri;
  /** Kullanılan (odada) ya da kullanılacak (önizlemede) cihaz kimlikleri. */
  secili: SeciliCihazlar;
  /** Odada kendi mikrofon seviyem (`current-audio-level-change`, 0–9). */
  sesSeviyesi: number;
  izinler: { kamera: IzinDurumu; mikrofon: IzinDurumu };
  /** İzin yönlendirme penceresi açık mı. */
  izinPenceresi: boolean;
  /** Kullanıcı kimliğine göre son ağ kalitesi ölçümleri. */
  agKaliteleri: Record<number, AgOlcumu>;
  /** Karşı tarafın izlenen ekran paylaşımı (`active-share-change`); yoksa `null`. */
  aktifPaylasim: number | null;
  /** Kendi ekranımı paylaşıyorum (`startShareScreen` başarılı → durdurulana dek). */
  benPaylasiyorum: boolean;
  /** Kendi paylaşımım tüm ekran (sonsuz yansıma uyarısı). */
  benTumEkran: boolean;
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

export type CihazTuru = keyof CihazListeleri;

export interface SeciliCihazlar {
  mikrofon?: string;
  hoparlor?: string;
  kamera?: string;
}

/** `navigator.permissions` / `device-permission-change` durumu. */
export type IzinDurumu = "granted" | "denied" | "prompt" | "bilinmiyor";

export const BASLANGIC: OdaDurumu = {
  asama: "onizleme",
  baglanti: null,
  benId: null,
  katilimcilar: [],
  konusanlar: [],
  sesEngellendi: false,
  karsiTarafGoruldu: false,
  cokluVideo: true,
  ayriliyor: false,
  hata: null,
  cihazlar: { mikrofon: [], hoparlor: [], kamera: [] },
  secili: {},
  sesSeviyesi: 0,
  izinler: { kamera: "bilinmiyor", mikrofon: "bilinmiyor" },
  izinPenceresi: false,
  agKaliteleri: {},
  aktifPaylasim: null,
  benPaylasiyorum: false,
  benTumEkran: false,
};

export function katilimciyaCevir(k: ZoomKullanici): Katilimci {
  const sesBagli = Boolean(k.audio);
  return {
    userId: k.userId,
    ad: k.displayName,
    videoAcik: Boolean(k.bVideoOn),
    mikKapali: !sesBagli || Boolean(k.isSpeakerOnly) || k.muted !== false,
    sesBagli,
    paylasiyor: Boolean(k.sharerOn),
    yenidenBaglaniyor: Boolean(k.isInFailover),
  };
}

/**
 * `user-added` / `user-removed` / `user-updated` / `peer-video-state-change`
 * sonrasında SDK'dan okunan tam listeyle durumu eşitler. `ben` okunamazsa
 * (henüz katılmadan) önceki kimlik korunur.
 */
export function katilimcilariEsitle(
  durum: OdaDurumu,
  liste: readonly ZoomKullanici[],
  ben: ZoomKullanici | null | undefined,
): OdaDurumu {
  const benId = ben?.userId ?? durum.benId;
  const katilimcilar = liste.map(katilimciyaCevir);
  // Kendi kaydımız listede yoksa (bazı sürümlerde katılım anında) eklenir.
  if (ben && !katilimcilar.some((k) => k.userId === ben.userId)) {
    katilimcilar.unshift(katilimciyaCevir(ben));
  }
  const digerVar = katilimcilar.some((k) => k.userId !== benId);
  return {
    ...durum,
    benId,
    katilimcilar,
    karsiTarafGoruldu: durum.karsiTarafGoruldu || digerVar,
    // Ayrılan kişi konuşanlar listesinde kalmasın.
    konusanlar: durum.konusanlar.filter((id) => katilimcilar.some((k) => k.userId === id)),
    agKaliteleri: agKaliteleriniBuda(durum.agKaliteleri, katilimcilar),
    // Paylaşan ayrıldıysa paylaşımı da gitmiştir (Inactive gelmeyebilir).
    aktifPaylasim:
      durum.aktifPaylasim !== null && katilimcilar.some((k) => k.userId === durum.aktifPaylasim)
        ? durum.aktifPaylasim
        : null,
  };
}

/**
 * Ölçüm yalnız kamerası açık kullanıcı için yayınlanır: kamerası kapanan ya
 * da ayrılanın eski değeri kalırsa gösterge yanıltır ("bilinmiyor" olmalı).
 */
function agKaliteleriniBuda(
  olcumler: Record<number, AgOlcumu>,
  katilimcilar: readonly Katilimci[],
): Record<number, AgOlcumu> {
  const sonuc: Record<number, AgOlcumu> = {};
  let degisti = false;
  for (const [anahtar, olcum] of Object.entries(olcumler)) {
    const id = Number(anahtar);
    if (katilimcilar.some((k) => k.userId === id && k.videoAcik)) sonuc[id] = olcum;
    else degisti = true;
  }
  return degisti ? sonuc : olcumler;
}

/** `network-quality-change`: bir yönün (uplink/downlink) yeni seviyesi. */
export function agKalitesiDegisti(
  durum: OdaDurumu,
  olay: { userId: number; type: string; level: number },
): OdaDurumu {
  if (olay.type !== "uplink" && olay.type !== "downlink") return durum;
  if (!Number.isFinite(olay.level)) return durum;
  const onceki = durum.agKaliteleri[olay.userId] ?? {};
  if (onceki[olay.type] === olay.level) return durum;
  return {
    ...durum,
    agKaliteleri: { ...durum.agKaliteleri, [olay.userId]: { ...onceki, [olay.type]: olay.level } },
  };
}

/** Gösterilecek seviye: bilinen yönlerin en kötüsü; ölçüm yoksa `null`. */
export function agSeviyesi(durum: OdaDurumu, userId: number | undefined): number | null {
  if (userId === undefined) return null;
  const olcum = durum.agKaliteleri[userId];
  if (!olcum) return null;
  const degerler = [olcum.uplink, olcum.downlink].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  return degerler.length ? Math.min(...degerler) : null;
}

/**
 * `active-media-failed`: medya yakalama/çözme beklenmedik biçimde durdu.
 * Zoom'un önerisi sayfayı yenilemek; şerit "Sayfayı yenile" düğmesiyle çıkar.
 */
export function medyaHatasi(durum: OdaDurumu): OdaDurumu {
  return { ...durum, hata: MEDYA_HATASI };
}

export const MEDYA_HATASI = "media.activeMediaFailed";

/**
 * Katıldı/ayrıldı bildirimleri için iki liste arasındaki fark. Kimlik değil
 * AD karşılaştırılır: Zoom `userId`si yeniden bağlanınca değişebilir, birebir
 * derste ad kararlıdır. Kendimiz hiçbir zaman bildirilmeyiz.
 */
export function digerAdlari(liste: readonly Katilimci[], benId: number | null): Set<string> {
  return new Set(liste.filter((k) => k.userId !== benId).map((k) => k.ad));
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

/** `peer-video-state-change`: liste yeniden okunana dek iyimser güncelleme. */
export function videoDurumuDegisti(
  durum: OdaDurumu,
  olay: { action: "Start" | "Stop"; userId: number },
): OdaDurumu {
  const videoAcik = olay.action === "Start";
  let agKaliteleri = durum.agKaliteleri;
  if (!videoAcik && olay.userId in agKaliteleri) {
    agKaliteleri = { ...agKaliteleri };
    delete agKaliteleri[olay.userId];
  }
  return {
    ...durum,
    agKaliteleri,
    katilimcilar: durum.katilimcilar.map((k) =>
      k.userId === olay.userId ? { ...k, videoAcik } : k,
    ),
  };
}

/** Zoom `ConnectionState` dizesi → bizim bağlantı durumumuz. */
export function baglantiDurumu(state: string): Baglanti | null {
  if (state === "Connected") return "bagli";
  if (state === "Reconnecting") return "yenidenBaglaniyor";
  if (state === "Closed" || state === "Fail") return "kapandi";
  return null;
}

export function baglantiDegisti(durum: OdaDurumu, olay: { state: string }): OdaDurumu {
  const baglanti = baglantiDurumu(olay.state);
  // Ölçümler burada SİLİNMEZ: olay yalnız değişimde gelir, aynı seviyede
  // dönen bağlantı yeniden bildirmeyebilir. Kimliği değişen ya da kamerası
  // kapananın ölçümünü yeniden okunan liste (`agKaliteleriniBuda`) atar.
  return baglanti ? { ...durum, baglanti } : durum;
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

/** `active-speaker`: yükte şu an konuşanlar gelir. */
export function aktifKonusanlar(
  durum: OdaDurumu,
  olay: readonly { userId: number }[],
): OdaDurumu {
  return { ...durum, konusanlar: olay.map((k) => k.userId) };
}

export function sesEngellendi(durum: OdaDurumu, engellendi: boolean): OdaDurumu {
  return { ...durum, sesEngellendi: engellendi };
}

export function benKimim(durum: OdaDurumu): Katilimci | null {
  return durum.katilimcilar.find((k) => k.userId === durum.benId) ?? null;
}

/** Birebir derste karşı taraf: kendimiz dışındaki ilk katılımcı. */
export function karsiTaraf(durum: OdaDurumu): Katilimci | null {
  if (durum.benId === null) return null;
  return durum.katilimcilar.find((k) => k.userId !== durum.benId) ?? null;
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
  const metin = hataMetni(hata);
  return /AUDIO_CAPTURE_FAILED|INSUFFICIENT_PRIVILEGES|NotAllowed|Permission denied/i.test(metin);
}

/* ── Cihazlar ve izinler (Paket 2) ──────────────────────────────────── */

/** SDK/tarayıcı cihaz kaydının kullandığımız alt kümesi. */
export interface HamCihaz {
  deviceId: string;
  label: string;
  kind?: string;
}

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

/** `navigator.permissions` ya da Zoom `device-permission-change`. */
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

/**
 * Önizleme mikrofon seviyesi: Zoom `getCurrentVolume()` ham RMS (0–1,
 * konuşma çoğunlukla 0,02–0,2) döndürür; çubuk için algısal ölçek.
 */
export function seviyeOrani(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.min(1, Math.sqrt(rms) * 1.6);
}

/** Odada `current-audio-level-change` seviyesi (0–9) → çubuk oranı. */
export function odaSeviyeOrani(seviye: number): number {
  if (!Number.isFinite(seviye) || seviye <= 0) return 0;
  return Math.min(1, seviye / 9);
}

const YEDEK_AD: Record<CihazTuru, string> = {
  mikrofon: "Mikrofon",
  hoparlor: "Hoparlör",
  kamera: "Kamera",
};

/** Üç tür için ham listeler (odada `get*List`) ya da tek karışık liste (`getDevices`). */
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
 * `active-share-change`: karşı tarafın paylaşımı başladı/bitti. Kendi
 * paylaşımımız burada izlenmez (`benPaylasiyorum`); kendi kimliğimizle gelen
 * olay yok sayılır.
 */
export function aktifPaylasimDegisti(
  durum: OdaDurumu,
  olay: { state: string; userId: number },
): OdaDurumu {
  if (olay.state === "Active") {
    if (olay.userId === durum.benId || durum.aktifPaylasim === olay.userId) return durum;
    return { ...durum, aktifPaylasim: olay.userId };
  }
  if (olay.state === "Inactive" && durum.aktifPaylasim !== null) {
    // Kimlik eşleşmese de temizlenir: birebir derste tek paylaşım izlenir.
    return { ...durum, aktifPaylasim: null };
  }
  return durum;
}

/**
 * Katılınca / yeniden bağlanınca SDK'nın o anki paylaşımı
 * (`getActiveShareUserId`, yoksa 0). Olay kaçtıysa boşluğu doldurur; yalnız
 * listede paylaşıyor görünen karşı taraf kabul edilir (bayat kimlik düzeni
 * geri getirmesin).
 */
export function paylasimiEsitle(durum: OdaDurumu, aktifId: number): OdaDurumu {
  if (durum.aktifPaylasim !== null || !aktifId || aktifId === durum.benId) return durum;
  const paylasan = durum.katilimcilar.find((k) => k.userId === aktifId);
  return paylasan?.paylasiyor ? { ...durum, aktifPaylasim: aktifId } : durum;
}

/** Kendi paylaşımım başladı / durdu (düğme ya da `passively-stop-share`). */
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

export type PaylasimHatasiTuru = "iptal" | "izin" | "diger";

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
  if (typeof hata === "object" && hata !== null) {
    const kod = (hata as { errorCode?: unknown }).errorCode;
    if (kod === PAYLASIM_SISTEM_REDDI) return "izin";
    if (kod === PAYLASIM_KULLANICI_REDDI) return "iptal";
  }
  const metin = hataMetni(hata);
  if (/NotAllowedError/.test(metin)) return /by system/i.test(metin) ? "izin" : "iptal";
  if (/screen recording|allow the permission/i.test(metin)) return "izin";
  return "diger";
}
