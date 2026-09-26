/**
 * Agora kayıtları/olayları → nötr sürücü türleri. SAF: SDK yalnız TÜR olarak
 * import edilir; jsdom'da sınanabilir.
 *
 * Kimlikler string uid'dir (`"t7"`, `"c9"`); ekran paylaşımı ikinci istemcinin
 * `"{sahip}-ekran"` uid'iyle yayınlanır. `*-ekran` kimlikleri katılımcı
 * listesine ASLA girmez; paylaşım olayına çevrilir.
 */
import type { ConnectionDisconnectedReason, ConnectionState, UID } from "agora-rtc-sdk-ng";

import type { DersRolu, HamKatilimci, KatilimciId, NotrBilet, VideoOlayi } from "../tipler";

export const EKRAN_EKI = "-ekran";

export const kimlik = (uid: UID): KatilimciId => String(uid);

/** Ekran paylaşımı istemcisinin uid'i mi (`"t7-ekran"`)? */
export function ekranMi(uid: UID): boolean {
  const s = String(uid);
  return s.length > EKRAN_EKI.length && s.endsWith(EKRAN_EKI);
}

/** `"t7-ekran"` → `"t7"`; ekran uid'i değilse `null`. */
export function ekranSahibi(uid: UID): KatilimciId | null {
  return ekranMi(uid) ? String(uid).slice(0, -EKRAN_EKI.length) : null;
}

/**
 * Agora ağ kalitesi (0 bilinmiyor, 1 mükemmel … 6 kopuk) → nötr 0–5 ölçek
 * (`agKalitesi`: ≤1 zayıf, <3 orta, ≥3 iyi). 0 → `null` (ölçüm yok).
 */
export function agSeviyesi(q: number | null | undefined): number | null {
  switch (q) {
    case 1:
      return 5;
    case 2:
      return 4;
    case 3:
      return 2;
    case 4:
      return 1;
    case 5:
    case 6:
      return 0;
    default:
      return null;
  }
}

type BaglantiDurumu = Extract<VideoOlayi, { t: "baglanti" }>["durum"];

/**
 * `connection-state-change` → nötr bağlantı durumu; `null` bildirilmez.
 * İlk katılmanın `CONNECTING`i ve kendi `leave()`imiz (`LEAVE`) bildirilmez;
 * `TOKEN_EXPIRE` kopuşu `token-privilege-did-expire` yolunda yeniden katılımla
 * ele alınır.
 */
export function baglantiDurumu(
  simdiki: ConnectionState,
  onceki: ConnectionState | null,
  neden?: ConnectionDisconnectedReason | string,
): BaglantiDurumu | null {
  if (simdiki === "CONNECTED") return "bagli";
  if (simdiki === "RECONNECTING") return "yenidenBaglaniyor";
  if (simdiki === "CONNECTING") return onceki === "RECONNECTING" ? "yenidenBaglaniyor" : null;
  if (simdiki === "DISCONNECTED") {
    if (neden === "LEAVE" || neden === "TOKEN_EXPIRE") return null;
    return "kapandi";
  }
  return null;
}

/** `IAgoraRTCRemoteUser`ın kullandığımız alt kümesi. */
export interface UzakKullanici {
  uid: UID;
  hasAudio: boolean;
  hasVideo: boolean;
}

/** Kendi kaydımın sürücüde tutulan durumu. */
export interface BenimDurumum {
  id: KatilimciId;
  ad: string;
  rol: DersRolu;
  videoAcik: boolean;
  sesBagli: boolean;
  /** Mikrofon yok (yalnız hoparlör) ya da susturulmuş. */
  mikKapali: boolean;
  paylasiyor: boolean;
}

const tersRol = (r: DersRolu): DersRolu => (r === "ogretmen" ? "ogrenci" : "ogretmen");

/**
 * Tam nötr liste: önce ben, sonra uzak kullanıcılar (`*-ekran` hariç). Uzak
 * kullanıcının adı ve rolü biletteki `karsi`dan; uid tutmazsa (beklenmez)
 * rol birebir dersin öbür rolü, ad uid'dir. Agora "sese bağlı değil" ile
 * "susturulmuş"u ayırmaz: uzak taraf sese bağlı sayılır, yayın yoksa kapalı.
 */
export function listeyiCevir(
  ben: BenimDurumum,
  uzaklar: readonly UzakKullanici[],
  karsi: NotrBilet["karsi"],
): HamKatilimci[] {
  const paylasanlar = new Set(
    uzaklar
      .filter((u) => u.hasVideo)
      .map((u) => ekranSahibi(u.uid))
      .filter((s): s is string => s !== null),
  );
  const sonuc: HamKatilimci[] = [
    {
      id: ben.id,
      ad: ben.ad,
      ben: true,
      rol: ben.rol,
      videoAcik: ben.videoAcik,
      mikKapali: !ben.sesBagli || ben.mikKapali,
      sesBagli: ben.sesBagli,
      paylasiyor: ben.paylasiyor,
      yenidenBaglaniyor: false,
    },
  ];
  for (const u of uzaklar) {
    if (ekranMi(u.uid)) continue;
    const id = kimlik(u.uid);
    if (id === ben.id) continue;
    const bilinen = karsi !== null && karsi.id === id;
    sonuc.push({
      id,
      ad: bilinen ? karsi.ad : id,
      ben: false,
      rol: bilinen ? karsi.rol : tersRol(ben.rol),
      videoAcik: u.hasVideo,
      mikKapali: !u.hasAudio,
      sesBagli: true,
      paylasiyor: paylasanlar.has(id),
      yenidenBaglaniyor: false,
    });
  }
  return sonuc;
}

/** Konuşuyor sayılan ses düzeyi (`getVolumeLevel`, 0–1). */
export const KONUSMA_ESIGI = 0.06;

/** Düzeyleri eşiğe göre konuşanlara çevirir; ekran uid'leri atılır. */
export function konusanlar(
  duzeyler: ReadonlyArray<{ id: KatilimciId; duzey: number }>,
  esik = KONUSMA_ESIGI,
): KatilimciId[] {
  return duzeyler.filter((d) => !ekranMi(d.id) && d.duzey >= esik).map((d) => d.id);
}

/** Önizleme çubuğu (0–1): `getVolumeLevel` doğrusal genlik; algısal ölçek. */
export function seviyeOrani(duzey: number): number {
  if (!Number.isFinite(duzey) || duzey <= 0) return 0;
  return Math.min(1, Math.sqrt(duzey) * 1.4);
}

/** Kendi mikrofon seviyem (`sesSeviyem`, 0–9). */
export function sesSeviyesi(duzey: number): number {
  return Math.round(seviyeOrani(duzey) * 9);
}

/**
 * Masaüstü Chromium (Chrome/Edge/Opera) mı? Sanal arka plan eklentisi ve
 * uzak sesin çıkış cihazı (`setPlaybackDevice`) yalnız burada önerilir;
 * telefon, Firefox ve Safari hayır. Safari'nin UA'sında `Chrome/` yoktur.
 */
export function masaustuChromiumMu(ua: string, telefon: boolean): boolean {
  if (telefon) return false;
  if (/Firefox\/|FxiOS\//.test(ua)) return false;
  return /(Chrome|Chromium|Edg)\//.test(ua);
}

/** Agora hatasının aranabilir metni: `code` + ad + ileti. */
function hataMetni(hata: unknown): string {
  if (typeof hata !== "object" || hata === null) return String(hata ?? "");
  const { code, name, message } = hata as Record<string, unknown>;
  return [code, name, message].map((v) => String(v ?? "")).join(" ");
}

/** İzin reddi mi (`PERMISSION_DENIED` / getUserMedia `NotAllowedError`)? */
export function izinReddiMi(hata: unknown): boolean {
  return /PERMISSION_DENIED|NotAllowed|Permission denied/i.test(hataMetni(hata));
}

/** Kamera açma hatası → sürücü hata kodu; tanınmazsa `null` (ham hata fırlatılır). */
export function kameraHataKodu(
  hata: unknown,
): "kameraIzniYok" | "kameraYok" | "kameraMesgul" | null {
  const metin = hataMetni(hata);
  if (izinReddiMi(hata)) return "kameraIzniYok";
  if (/DEVICE_NOT_FOUND|NotFound|OverconstrainedError/i.test(metin)) return "kameraYok";
  if (/NOT_READABLE|NotReadable|TrackStart|in use/i.test(metin)) return "kameraMesgul";
  return null;
}

/**
 * Ekran seçici hatası → sürücü hata kodu. Kullanıcının vazgeçmesi
 * `NotAllowedError: Permission denied`, işletim sisteminin reddi (macOS ekran
 * kaydı izni) `… by system` ile gelir; tanınmazsa `null`.
 */
export function paylasimHataKodu(hata: unknown): "paylasimIptal" | "paylasimReddedildi" | null {
  const metin = hataMetni(hata);
  if (/by system/i.test(metin)) return "paylasimReddedildi";
  if (izinReddiMi(hata)) return "paylasimIptal";
  return null;
}

/** Yenileme isteği ders penceresi dışında mı (sunucu 409 = ders bitti)? */
export function dersBittiMi(hata: unknown): boolean {
  return (hata as { response?: { status?: number } } | null)?.response?.status === 409;
}
