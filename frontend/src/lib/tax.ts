/**
 * KDV oranı — yüzde ↔ oran dönüşümü (saf, Vitest'li).
 *
 * ## Neden iki birim var
 *
 * Sunucu ve veritabanı ORAN ile çalışır: `products.tax_rate` `Numeric(5,4)`,
 * `services/tax.py` `0 ≤ oran < 1` bekler, `0.20` = %20. İnsanlar ise yüzde
 * konuşur ("KDV yirmi"). Formda oran istemek, `0.20` yerine `20` yazan bir
 * yöneticinin ürünü **%2000 KDV** ile kaydetmesine açık kapı bırakırdı.
 *
 * Bu yüzden form YÜZDE alır, istek ORAN taşır ve dönüşüm tek yerde yapılır.
 * Sunucu yine de kendi sınırını uygular (422) — bu modül kolaylıktır, güvenlik
 * sınırı değildir.
 *
 * ## Oranlar veridir
 *
 * Burada hiçbir varsayılan oran, hiçbir "şu ürün muaftır" kuralı YOKTUR.
 * Hangi ürüne hangi oranın uygulanacağı bir mevzuat kararıdır ve ürün ürün
 * girilir (bkz. `docs/ip5-kdv-fatura-sozlesme.md` §2, S-5).
 */

/** Oranın ondalık basamak sayısı — `Numeric(5,4)` ile birebir. */
const ORAN_BASAMAK = 4;

export interface OranSonucu {
  ok: boolean;
  /** Sunucuya gönderilecek oran, ör. "0.2000". Yalnız `ok` iken anlamlıdır. */
  oran: string;
  /** Kullanıcıya gösterilecek hata; yalnız `ok=false` iken doludur. */
  hata: string | null;
}

/**
 * Formdaki yüzde metnini sunucunun beklediği orana çevirir.
 *
 * Boş girdi geçersizdir: "oran girilmedi" ile "%0" farklı şeylerdir ve
 * ikincisi ancak açıkça yazılarak seçilebilir.
 */
export function yuzdedenOran(yuzde: string): OranSonucu {
  const ham = (yuzde ?? "").trim().replace(",", ".").replace("%", "");
  if (!ham) {
    return { ok: false, oran: "", hata: "KDV oranı zorunlu" };
  }
  const sayi = Number(ham);
  if (!Number.isFinite(sayi)) {
    return { ok: false, oran: "", hata: "KDV oranı sayı olmalı" };
  }
  if (sayi < 0 || sayi >= 100) {
    return { ok: false, oran: "", hata: "KDV oranı 0 ile 100 arasında olmalı" };
  }
  // toFixed kayan nokta artığını kapatır (18/100 = 0.18000000000000002 değil).
  return { ok: true, oran: (sayi / 100).toFixed(ORAN_BASAMAK), hata: null };
}

/**
 * Sunucudan gelen oranı forma yazılacak yüzdeye çevirir.
 *
 * Oran yoksa BOŞ döner — `0` yazmak, oranı hiç girilmemiş bir ürünü "%0'a
 * karar verilmiş" gibi gösterirdi ve kaydeden yönetici farkında olmadan o
 * kararı onaylardı.
 */
export function orandanYuzde(oran: string | number | null | undefined): string {
  if (oran === null || oran === undefined || oran === "") return "";
  const sayi = Number(oran);
  if (!Number.isFinite(sayi)) return "";
  const yuzde = sayi * 100;
  // Tam sayıysa "20", değilse anlamlı basamakla "1.5" — sondaki sıfırlar yok.
  return Number(yuzde.toFixed(2)).toString();
}
