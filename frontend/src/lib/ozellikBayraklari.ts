/**
 * Lansmana yetişmeyen bölümlerin AÇMA/KAPAMA anahtarları.
 *
 * ## Neden bayrak, neden silme değil
 *
 * "Kütüphaneler" ve "Denemeler" ürün olarak bitmiş değil; kod olarak bitmiş.
 * Sayfaları, uçları, testleri ve verisi yerinde duruyor — eksik olan tek şey
 * lansmana yetişecek zaman. Bu yüzden bölümler SİLİNMEZ, DONDURULUR: menüde
 * görünür kalır ("Yakında" rozetiyle), tıklanamaz olur ve rotası gerçek sayfa
 * yerine "Yakında" ekranını açar.
 *
 * Bayrağı `true` yapmak tek başına yeterlidir; başka hiçbir dosyaya
 * dokunulmadan eski davranışın tamamı geri gelir. Bu sözleşme
 * `__guards__/bolumDondurmaBayrakAcik.test.tsx` tarafından korunur — dondurma
 * ile kalıcı silmeyi ayıran şey odur.
 *
 * ## Sınır
 *
 * Bu YALNIZ arayüz dondurmasıdır. Backend uçları, veritabanı ve operatör
 * (LIBRARY_OPERATOR) tarafı BİLEREK dokunulmadan bırakıldı: donmuş bölümün
 * verisi lansman sırasında da toplanmaya devam ediyor ve bayrak açıldığında
 * boş bir katalogla karşılaşılmıyor.
 */

/** Kütüphane/etüt merkezi kataloğu, profili ve self-servis kaydı.
 *  29 Ağu 2026: kullanıcı kararıyla AÇILDI. */
export const KUTUPHANELER_ACIK = true;

/**
 * "Denemeler" — İKİ yüzeyi birden kapsar:
 *  1. Kütüphanelerin ücretli deneme oturumları (bilet/QR) — keşif sekmesi,
 *  2. `/denemeler` öğrencinin kendi deneme net takibi (Öğren hub'ı kartı).
 */
export const DENEMELER_ACIK = false;
