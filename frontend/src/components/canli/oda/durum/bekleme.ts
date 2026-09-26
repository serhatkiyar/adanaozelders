/**
 * Karşı tarafı bekleme — "Derse katıl"a ilk basan video sağlayıcısına
 * BAĞLANMAZ (kredi harcanmaz); karşı taraf ders sayfasına gelince bağlanır
 * (kullanıcı kararı, 25 Eyl 2026). Karşı tarafın sayfada olup olmadığı
 * Centrifugo `ders:{id}` kanalının varlık (presence) bilgisinden okunur
 * (`tahta/dersKanali.ts`); rol token'daki `chanInfo.rol`dan.
 *
 * Kanal yoksa ya da varlık okunamıyorsa BEKLENMEZ: bugünkü gibi doğrudan
 * bağlanılır (geri dönüş).
 */

/** Kanal token'ındaki rol (`chanInfo.rol`). */
export type KanalRolu = "ogretmen" | "ogrenci";

/**
 * Kanalın varlık bilgisi açısından durumu:
 * - `aciliyor`: henüz ilk kez abone olunmadı (token, bağlantı).
 * - `hazir`: abone ve varlık listesi okundu.
 * - `kopuk`: hazırdı, bağlantı gitti; yeniden abone olunuyor.
 * - `yok`: kullanılamaz (yetki, sunucu kapalı, varlık okunamadı) — beklenmez.
 */
export type KanalVarlikDurumu = "aciliyor" | "hazir" | "kopuk" | "yok";

export interface KanalVarligi {
  durum: KanalVarlikDurumu;
  /** Karşı rolden en az bir bağlantı kanalda mı (yalnız `hazir`da anlamlı). */
  karsiVar: boolean;
}

/** Hazır olmayan kanal için "Derse katıl"dan sonra en çok bu kadar beklenir. */
export const KANAL_HAZIRLIK_SURESI_MS = 4_000;

/**
 * Bekleme sürerken kanal bu kadar kesintisiz kopuk kalırsa bağlanılır:
 * uygulama değiştirmeyi (telefon) atlatır, gerçek kesintide sonsuz beklemez.
 */
export const KOPUK_BEKLEME_SURESI_MS = 90_000;

/** `chanInfo`dan rol; tanınmıyorsa `null`. */
export function rolOku(chanInfo: unknown): KanalRolu | null {
  const rol = (chanInfo as { rol?: unknown } | null | undefined)?.rol;
  return rol === "ogretmen" || rol === "ogrenci" ? rol : null;
}

/**
 * Kanaldaki bağlantıların rollerinden karşı tarafın varlığı. Kendi başka
 * sekmem aynı roldedir, karşı taraf sayılmaz; rolü okunamayan da sayılmaz.
 */
export function karsiVarMi(roller: Iterable<KanalRolu | null>, benimRolum: KanalRolu): boolean {
  for (const rol of roller) if (rol !== null && rol !== benimRolum) return true;
  return false;
}

export type KatilimKarari = "katil" | "bekle" | "hazirlaniyor";

export interface BeklemeZamani {
  /** Bu istekte kanal en az bir kez `hazir` görüldü (bekleme gerçekten başladı). */
  beklemeBasladi: boolean;
  /**
   * Geçerli süre doldu: hazırlanırken `KANAL_HAZIRLIK_SURESI_MS`, bekleme
   * sırasında kopukken `KOPUK_BEKLEME_SURESI_MS` (`beklemeSuresi`).
   */
  sureDoldu: boolean;
}

/**
 * "Derse katıl"a basıldıktan sonra ne yapılacağı.
 * - Kanal yok / varlık okunamadı → doğrudan bağlan (geri dönüş).
 * - Karşı taraf sayfada → bağlan.
 * - Kanal hazır, karşı taraf yok → bekle.
 * - Bekleme sırasında bağlantı koptu → uzun süre beklemeyi sürdür (telefonda
 *   uygulama değiştirmek soketi düşürür; dönünce tek başına odada olmasın),
 *   süre dolarsa bağlan.
 * - Basıldığında kanal açılmamış ya da kopuk → kısa süre hazırlan; süre
 *   dolarsa bağlan.
 */
export function katilimKarari(varlik: KanalVarligi, zaman: BeklemeZamani): KatilimKarari {
  switch (varlik.durum) {
    case "yok":
      return "katil";
    case "hazir":
      return varlik.karsiVar ? "katil" : "bekle";
    case "kopuk":
      if (zaman.sureDoldu) return "katil";
      return zaman.beklemeBasladi ? "bekle" : "hazirlaniyor";
    case "aciliyor":
      return zaman.sureDoldu ? "katil" : "hazirlaniyor";
  }
}

/** Kararın işlettiği süre (ms); süre işlemiyorsa `null`. */
export function beklemeSuresi(karar: KatilimKarari, durum: KanalVarlikDurumu): number | null {
  if (karar === "hazirlaniyor") return KANAL_HAZIRLIK_SURESI_MS;
  if (karar === "bekle" && durum === "kopuk") return KOPUK_BEKLEME_SURESI_MS;
  return null;
}
