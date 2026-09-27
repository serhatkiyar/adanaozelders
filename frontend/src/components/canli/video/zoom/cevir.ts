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
  /** Belirteçteki `user_identity` (eski ad; SDK'da deprecated). */
  userIdentity?: string;
  /** Belirteçteki `user_key`: uygulamadaki KALICI kimlik (`t{id}`/`c{id}`). */
  userKey?: string;
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
    // Failover'daki kaydın son karesi donuk kalır: görüntü kapalı sayılır,
    // karo avatar + "Yeniden bağlanıyor…" gösterir (medya katmanı çözer).
    videoAcik: Boolean(k.bVideoOn) && !k.isInFailover,
    mikKapali: !sesBagli || Boolean(k.isSpeakerOnly) || k.muted !== false,
    sesBagli,
    paylasiyor: Boolean(k.sharerOn),
    yenidenBaglaniyor: Boolean(k.isInFailover),
  };
}

/** Aynı kişiyi yeniden katılımlar arasında tanır: Zoom `userId`si her
 * katılımda değişir; `user_key` (JWT) değişmez. */
export const kisiAnahtari = (k: ZoomKullanici): string =>
  k.userKey || k.userIdentity || k.displayName;

/**
 * Aynı kişinin birden çok CANLI (failover olmayan) kaydı varken hangisinin
 * seçileceğine dair KANIT. `getAllUser()` sırası belgelenmiş bir katılma
 * sırası değildir; seçimde KULLANILMAZ.
 * - `guncel`: `user-added` olayıyla o `userKey` için gelen son `userId`.
 * - `onceki`: bir önceki uzlaştırmada gösterilen `userId`.
 * - `uyar`: kanıt yoksa çağrılır; o durumda kayıtların hepsi bırakılır.
 */
export interface KimlikKaniti {
  guncel?: ReadonlyMap<string, number>;
  onceki?: ReadonlyMap<string, number>;
  uyar?: (anahtar: string, idler: number[]) => void;
}

/**
 * `getAllUser()` + `getCurrentUserInfo()` → tam nötr liste. Kendi kaydımız
 * listede yoksa (bazı sürümlerde katılım anında) eklenir.
 *
 * Hayalet kayıtlar atılır: sekmeyi kapatan/yenileyen kişi yeniden katılınca
 * YENİ `userId` alır; eskisi dakikalarca `isInFailover` olarak listede kalır
 * (canlı denemede görüldü, 25 Eyl 2026). Aynı kişinin (`userKey`) canlı kaydı
 * varsa failover kaydı gösterilmez. Tek başına failover kaydı (gerçekten
 * yeniden bağlanan) ve kendi kaydımız korunur.
 *
 * Aynı kişinin birden çok canlı kaydı: tek ise o; birden çoksa önce
 * `kanit.guncel`, sonra `kanit.onceki`; ikisi de yoksa SESSİZ SEÇİM YOK —
 * hepsi bırakılır ve `kanit.uyar` çağrılır.
 */
export function listeyiCevir(
  liste: readonly ZoomKullanici[],
  ben: ZoomKullanici | null | undefined,
  benimRolum: DersRolu | null,
  kanit: KimlikKaniti = {},
): HamKatilimci[] {
  const tum = ben && !liste.some((k) => k.userId === ben.userId) ? [ben, ...liste] : liste;
  const canliKayitlar = new Map<string, number[]>();
  for (const k of tum) {
    if (k.userId === ben?.userId || k.isInFailover) continue;
    const a = kisiAnahtari(k);
    canliKayitlar.set(a, [...(canliKayitlar.get(a) ?? []), k.userId]);
  }
  // Hayalet ayıklama için kendi (canlı) kaydımız da sayılır.
  const canliAnahtarlar = new Set(tum.filter((k) => !k.isInFailover).map(kisiAnahtari));
  const secilen = new Map<string, number | null>();
  for (const [a, idler] of canliKayitlar) {
    if (idler.length === 1) {
      secilen.set(a, idler[0]);
      continue;
    }
    const g = kanit.guncel?.get(a);
    const o = kanit.onceki?.get(a);
    if (g !== undefined && idler.includes(g)) secilen.set(a, g);
    else if (o !== undefined && idler.includes(o)) secilen.set(a, o);
    else {
      secilen.set(a, null);
      kanit.uyar?.(a, idler);
    }
  }
  return tum
    .filter((k) => {
      if (k.userId === ben?.userId) return true;
      const a = kisiAnahtari(k);
      if (k.isInFailover) return !canliAnahtarlar.has(a);
      const s = secilen.get(a);
      return s === null || s === k.userId;
    })
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
