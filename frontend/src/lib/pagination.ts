/**
 * Liste sayfalarında sayfa durumu — URL'de taşınır (saf; Vitest'li).
 *
 * Neden URL: filtreler (`q`, `district`, `subject`) zaten query string'de
 * tutuluyordu ama kaçıncı sayfada olunduğu bileşen state'indeydi. Sonuç:
 * "daha fazla göster"e üç kez basıp bir eğitmeni paylaşan kişinin bağlantısı
 * karşı tarafta ilk 20 sonuca dönüyor, geri tuşu da tüm listeyi sıfırlıyordu.
 *
 * Arama motoru tarafı ayrıca `sitemap.xml` ile çözülür: derin envanter
 * (her eğitmen/kütüphane/ürün profili) oradan taranır — liste sayfalarının
 * kaçıncı sayfası olduğu crawler için ikincildir.
 */

/** URL'deki `sayfa` parametresinin adı (Türkçe public yüzey). */
export const PAGE_PARAM = "sayfa";

/**
 * `?sayfa=` değerini 1-tabanlı sayfa numarasına çevirir.
 * Geçersiz/eksik/negatif değerlerde 1 döner — kullanıcıya hata göstermek
 * yerine ilk sayfayı vermek doğru davranış.
 */
export function pageFromParam(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  // Aşırı büyük sayfa numarası sunucuya devasa limit göndermesin.
  return Math.min(Math.floor(n), MAX_PAGE);
}

/** Makul üst sınır: bunun ötesi bot/kazara oluşmuş bağlantıdır. */
export const MAX_PAGE = 500;

/**
 * Sayfa numarasından "kaç kayıt yüklensin" değeri.
 *
 * Liste uçları offset değil kümülatif limit kullanıyor (sonsuz kaydırma
 * hissi korunuyor): 2. sayfa = ilk 2 sayfalık kayıt.
 */
export function limitForPage(page: number, perPage: number): number {
  return Math.max(1, page) * perPage;
}

/** Bir sonraki sayfanın URL'i (mevcut filtreleri korur). */
export function nextPageSearch(
  params: URLSearchParams,
  currentPage: number
): string {
  const next = new URLSearchParams(params);
  next.set(PAGE_PARAM, String(currentPage + 1));
  return `?${next.toString()}`;
}

/** `sayfa=1` URL'i kirletmesin: ilk sayfada parametre tamamen kaldırılır. */
export function withPage(params: URLSearchParams, page: number): URLSearchParams {
  const next = new URLSearchParams(params);
  if (page <= 1) {
    next.delete(PAGE_PARAM);
  } else {
    next.set(PAGE_PARAM, String(page));
  }
  return next;
}
