// Toplu ürün içe aktarma şablonu (admin mağaza paneli).
//
// Ayrı bir modülde: başlık ile örnek satırın hizası bir Vitest nöbetçisiyle
// korunur (`productCsvTemplate.test.ts`) — bileşenin içine gömülü iki string
// olarak dururken aralarındaki kayma fark edilmeden aylarca yaşadı.
//
// Kural: şablonda TIRNAKLI veya virgül içeren değer bulunmaz. Naif `split(",")`
// ile ayrıştırılabilir kalması hem nöbetçinin hem de kullanıcının Excel'inin
// aynı şeyi görmesini sağlar.

/** Backend `bulk_import_products`'ın okuduğu kolon adları (sıra serbesttir,
 *  eşleme başlık ADIYLA yapılır — ama örnek satır bu sırayı izler). */
export const CSV_COLUMNS =
  "title,kind,price,tax_rate,compare_at_price,stock,category_slug,status,cover_url,description,author,publisher,isbn,page_count,dimensions,publication_year,edition,language,cover_type";

/** Kullanıcının doldurmadan önce göreceği tek örnek satır.
 *
 *  `tax_rate` bir BİÇİM örneğidir (oran olarak yazılır: 0.20 = %20), oran
 *  TAVSİYESİ değildir — hangi ürüne hangi oranın uygulanacağı mali müşavir
 *  kararıdır ve üründe zorunlu veridir (sunucu varsayılan oran türetmez). */
export const CSV_SAMPLE_ROW =
  "AYT Matematik Soru Bankası,PHYSICAL,339,0.20,399,25,yks-kitaplari,ACTIVE,,Açıklama metni,Seyit Dönmez,Bilgi Sarmal Yayınları,9786258070187,416,19 x 27,2026,1. Basım,Türkçe,Karton Kapak";

/** İndirilen dosyanın içeriği (BOM çağıran tarafta eklenir). */
export function buildCsvTemplate(): string {
  return `${CSV_COLUMNS}\n${CSV_SAMPLE_ROW}`;
}
