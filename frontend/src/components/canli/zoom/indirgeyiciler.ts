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
  sharerOn?: boolean;
}

export interface Katilimci {
  userId: number;
  ad: string;
  videoAcik: boolean;
  /** Sese bağlı ve susturulmuş. Sese hiç bağlı değilken de kapalı sayılır. */
  mikKapali: boolean;
  sesBagli: boolean;
  paylasiyor: boolean;
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
}

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
};

export function katilimciyaCevir(k: ZoomKullanici): Katilimci {
  const sesBagli = Boolean(k.audio);
  return {
    userId: k.userId,
    ad: k.displayName,
    videoAcik: Boolean(k.bVideoOn),
    mikKapali: !sesBagli || k.muted !== false,
    sesBagli,
    paylasiyor: Boolean(k.sharerOn),
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
  };
}

/** `peer-video-state-change`: liste yeniden okunana dek iyimser güncelleme. */
export function videoDurumuDegisti(
  durum: OdaDurumu,
  olay: { action: "Start" | "Stop"; userId: number },
): OdaDurumu {
  const videoAcik = olay.action === "Start";
  return {
    ...durum,
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
  return baglanti ? { ...durum, baglanti } : durum;
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
 * Önizleme kamerasının hatası → gösterilecek ipucunun i18n anahtarı.
 * Tarayıcı `DOMException` adları (getUserMedia) ve Zoom hata dizeleri.
 */
export function kameraHataAnahtari(hata: unknown): string {
  const ad = hata instanceof Error ? `${hata.name} ${hata.message}` : String(hata ?? "");
  if (/NotAllowed|Permission|FORBIDDEN/i.test(ad)) return "join.cameraNotGranted";
  if (/NotFound|CAN_NOT_DETECT|DevicesNotFound/i.test(ad)) return "join.cameraNotFound";
  if (/NotReadable|IS_TAKEN|TrackStart|in use/i.test(ad)) return "join.cameraInUse";
  return "media.deviceError";
}
