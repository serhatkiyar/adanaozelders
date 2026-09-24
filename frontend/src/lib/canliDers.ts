/**
 * Canlı ders (Zoom) sayfasının saf kuralları — sayaç, cihaz ve tarayıcı
 * tespiti, karşı taraf notu. Bileşenden ayrı tutulur ki testle sabitlensin.
 */

/** Son kaç dakikada "Ders X dk sonra bitiyor" gösterilir. */
export const SON_DAKIKA_UYARISI = 5;

export type DersSayaci =
  | { tur: "normal" }
  | { tur: "son"; dakika: number }
  | { tur: "doldu" };

/**
 * Ders bitişine göre sayaç durumu. Süre dolunca oturum KAPANMAZ (Preply gibi);
 * yalnız bilgi verilir. Kalan süre yukarı yuvarlanır: 4 dk 10 sn → "5 dk".
 */
export function dersSayaci(bitisIso: string, simdi: number = Date.now()): DersSayaci {
  const kalanMs = new Date(bitisIso).getTime() - simdi;
  if (!Number.isFinite(kalanMs)) return { tur: "normal" };
  if (kalanMs <= 0) return { tur: "doldu" };
  const dakika = Math.ceil(kalanMs / 60_000);
  if (dakika <= SON_DAKIKA_UYARISI) return { tur: "son", dakika };
  return { tur: "normal" };
}

export function sayacMetni(sayac: DersSayaci): string | null {
  if (sayac.tur === "son") return `Ders ${sayac.dakika} dk sonra bitiyor`;
  if (sayac.tur === "doldu") return "Ders süresi doldu";
  return null;
}

export interface CihazOrtami {
  ua: string;
  /** Dokunmatik birincil işaretçi (`pointer: coarse`) ya da dokunma noktası. */
  dokunmatik: boolean;
  /** Ekranın kısa kenarı (CSS px) — pencere değil, cihaz ekranı. */
  kisaKenar: number;
}

const TELEFON_UA = /iPhone|iPod|Android.+Mobile|Windows Phone|Mobi/i;

/**
 * Telefon düzeni mi? Preply gibi pencere GENİŞLİĞİNE değil cihaza bakılır:
 * masaüstünde pencereyi daraltmak telefon düzenine geçirmez. Telefon UA'sı
 * yeterlidir; UA'sı masaüstü gibi görünen dokunmatik cihazda (ör. "masaüstü
 * sitesi iste") ekranın kısa kenarı karar verir. Tablet (kısa kenar ≥ 600)
 * masaüstü düzenini alır.
 */
export function telefonMu({ ua, dokunmatik, kisaKenar }: CihazOrtami): boolean {
  if (TELEFON_UA.test(ua)) return true;
  return dokunmatik && kisaKenar > 0 && kisaKenar < 600;
}

/** Firefox (masaüstü/Android; iOS'taki FxiOS WebKit'tir, sayılmaz). */
export function firefoxMu(ua: string): boolean {
  return /Firefox\//.test(ua) && !/Seamonkey\//i.test(ua);
}

export function tarayiciOrtami(): CihazOrtami {
  if (typeof window === "undefined") return { ua: "", dokunmatik: false, kisaKenar: 0 };
  const dokunmatik =
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches) ||
    (navigator.maxTouchPoints ?? 0) > 0;
  const kisaKenar = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0);
  return { ua: navigator.userAgent, dokunmatik, kisaKenar };
}

/** Karşı tarafın odadaki durumu (kendimiz hariç katılımcı var mı). */
export type KarsiTarafDurumu = "bekleniyor" | "odada" | "ayrildi";

/**
 * Kalan tarafa gösterilecek not. `rol` KENDİ rolümüzdür: host öğretmendir,
 * karşı taraf öğrencidir (ve tersi). Odadayken not yok.
 */
export function karsiTarafNotu(
  durum: KarsiTarafDurumu,
  rol: "host" | "katilimci"
): string | null {
  const kim = rol === "host" ? "Öğrencin" : "Öğretmenin";
  if (durum === "ayrildi") return `${kim} dersten ayrıldı, geri dönmesi bekleniyor.`;
  if (durum === "bekleniyor") return `${kim} henüz derse katılmadı.`;
  return null;
}

/**
 * Giriş bileti (`/zoom-token`) hatasının kullanıcıya söylenecek hâli.
 * 409'ların nedeni birden fazladır (onaysız ders, oda yok, ders saati dışı,
 * sunucu Zoom kullanmıyor) ve sunucu metni zaten sade Türkçe: o korunur.
 */
export function biletHataMetni(durum: number | undefined, detay: unknown): string {
  const sunucuMetni = typeof detay === "string" && detay.trim() ? detay : null;
  switch (durum) {
    case 402:
      return "Ders ücreti ödenmeden canlı derse katılınamaz.";
    case 403:
      return "Bu derse katılma yetkin yok.";
    case 404:
      return "Ders bulunamadı.";
    case 409:
      return sunucuMetni ?? "Canlı ders şu an açık değil.";
    case 429:
      return "Çok sık denendi. Biraz bekleyip yeniden dene.";
    case 503:
      return "Canlı ders altyapısı şu an kullanılamıyor. Biraz sonra yeniden dene.";
    case undefined:
      return "Sunucuya ulaşılamıyor. İnternet bağlantını kontrol edip yeniden dene.";
    default:
      return "Canlı derse girilemedi. Biraz sonra yeniden dene.";
  }
}

/**
 * Zoom'un "tek kişi kalınca oturumu kapatma" süresi (dk). Varsayılan 40 dk,
 * karşı taraf ayrılınca dersi erken bitirebilirdi; ders bitişi + katılım
 * penceresinin kapanışına (30 dk) kadar açık kalsın. Zoom yalnız host'un
 * değerini kullanır.
 */
export function bostaKalmaSuresiDk(bitisIso: string, simdi: number = Date.now()): number {
  const kalanDk = Math.ceil((new Date(bitisIso).getTime() - simdi) / 60_000);
  if (!Number.isFinite(kalanDk)) return 40;
  return Math.max(40, kalanDk + 30);
}
