/**
 * Zoom kayıtları/olayları → nötr sürücü türleri. SAF: SDK import edilmez;
 * jsdom'da sınanabilir.
 */
import type { DersRolu, HamKatilimci, VideoOlayi } from "../tipler";

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
  /** Belirteçteki `user_identity` (verilmişse); hesap başına sabit. */
  userIdentity?: string;
}

export const kimlik = (userId: number): string => String(userId);

/**
 * Zoom kaydı → nötr katılımcı. Rol, biletteki kendi rolümüzden: birebir
 * derste karşı taraf öbür roldür (Zoom'da öğretmen `host`, öğrenci `role_type` 0).
 */
export function katilimciyaCevir(
  k: ZoomKullanici,
  benId: number | undefined,
  benimRolum: DersRolu | null,
): HamKatilimci {
  const sesBagli = Boolean(k.audio);
  const ben = k.userId === benId;
  const karsiRol: DersRolu | null =
    benimRolum === null ? null : benimRolum === "ogretmen" ? "ogrenci" : "ogretmen";
  return {
    id: kimlik(k.userId),
    ad: k.displayName,
    ben,
    rol: ben ? benimRolum : karsiRol,
    videoAcik: Boolean(k.bVideoOn),
    mikKapali: !sesBagli || Boolean(k.isSpeakerOnly) || k.muted !== false,
    sesBagli,
    paylasiyor: Boolean(k.sharerOn),
    yenidenBaglaniyor: Boolean(k.isInFailover),
  };
}

const kisiAnahtari = (k: ZoomKullanici): string => k.userIdentity || k.displayName;

/**
 * `getAllUser()` + `getCurrentUserInfo()` → tam nötr liste. Kendi kaydımız
 * listede yoksa (bazı sürümlerde katılım anında) eklenir.
 *
 * Hayalet kayıtlar atılır: sekmeyi kapatan/yenileyen kişi yeniden katılınca
 * YENİ `userId` alır; eskisi dakikalarca `isInFailover` olarak listede kalır
 * (canlı denemede görüldü, 25 Eyl 2026). Aynı kişinin (`userIdentity`, yoksa
 * ad) canlı kaydı varsa failover kaydı gösterilmez; yoksa karşı taraf ilk
 * failover kaydına bağlanıp canlı kaydın görüntüsünü hiç çizmiyordu.
 * Tek başına failover kaydı (gerçekten yeniden bağlanan) ve kendi kaydımız
 * korunur.
 */
export function listeyiCevir(
  liste: readonly ZoomKullanici[],
  ben: ZoomKullanici | null | undefined,
  benimRolum: DersRolu | null,
): HamKatilimci[] {
  const tum = ben && !liste.some((k) => k.userId === ben.userId) ? [ben, ...liste] : liste;
  const canli = new Set(tum.filter((k) => !k.isInFailover).map(kisiAnahtari));
  return tum
    .filter((k) => k.userId === ben?.userId || !k.isInFailover || !canli.has(kisiAnahtari(k)))
    .map((k) => katilimciyaCevir(k, ben?.userId, benimRolum));
}

type BaglantiDurumu = Extract<VideoOlayi, { t: "baglanti" }>["durum"];

/** Zoom `ConnectionState` dizesi → nötr bağlantı durumu. */
export function baglantiDurumu(state: string): BaglantiDurumu | null {
  if (state === "Connected") return "bagli";
  if (state === "Reconnecting") return "yenidenBaglaniyor";
  if (state === "Closed" || state === "Fail") return "kapandi";
  return null;
}

/**
 * Zoom ses istatistiği (`AudioQosData`) → 0–5 seviye (`agKalitesi` ölçeği:
 * 4 iyi, 2 orta, 1 zayıf). Yalnız milisaniye birimli `rtt` ve `jitter`
 * kullanılır; `avg_loss`un birimi SDK'da belgelenmemiş. Hepsi 0 ise (akış
 * yok, SDK'nın boş başlangıç değeri) ölçüm yok: `null`.
 */
export function sesIstatistigiSeviyesi(veri: {
  rtt?: number;
  jitter?: number;
  sample_rate?: number;
}): number | null {
  const rtt = Number(veri.rtt);
  const jitter = Number(veri.jitter);
  if (!Number.isFinite(rtt) || !Number.isFinite(jitter)) return null;
  if (rtt <= 0 && jitter <= 0 && !veri.sample_rate) return null;
  if (rtt >= 600 || jitter >= 80) return 1;
  if (rtt >= 300 || jitter >= 30) return 2;
  return 4;
}

/**
 * Önizleme mikrofon seviyesi: Zoom `getCurrentVolume()` ham RMS (0–1,
 * konuşma çoğunlukla 0,02–0,2) döndürür; çubuk için algısal ölçek.
 */
export function seviyeOrani(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.min(1, Math.sqrt(rms) * 1.6);
}
