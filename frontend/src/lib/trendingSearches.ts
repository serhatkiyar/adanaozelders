/*
 * Trend aramalar — ders arama kutusu boş+odaklıyken öneri olarak gösterilir.
 *
 * SIRALAMA RAKİBİN GERÇEK TALEP SAYILARINDAN (kullanıcı kararı, 10 Eyl 2026).
 * Kaynak: özeldersalani.com'un yayımladığı "İlk 20 Branş" tablosu
 * (Instagram, 28 Ağustos 2026) — branş başına gerçekleşen talep sayısı:
 *
 *     1 Matematik 11.620   ·  6 Okuma Yazma 3.629
 *     2 İngilizce  8.060   ·  7 Piyano      3.456
 *     3 İlköğretim Takviye 6.726 · 8 Fizik  2.923
 *     4 Yüzme      4.943   ·  9 İspanyolca  2.786
 *     5 Almanca    3.920   · 10 Tenis       2.195
 *
 * Önceki liste Armut.com yorum birikiminden türetilmişti ve sıralaması
 * tahminîydi ("TYT Matematik", "Ortaokul Matematik" gibi seviye kırılımları
 * öndeydi). Bu tablo doğrudan TALEP sayısı olduğu için daha güçlü bir sinyal.
 *
 * Sıra ANLAMLIDIR: yüzey yalnız ilk üçü gösteriyor, dolayısıyla listenin başı
 * ürün kararıdır — karıştırılmamalı.
 */
export const TRENDING_SEARCHES = [
  "Matematik",
  "İngilizce",
  "İlköğretim Takviye",
  "Yüzme",
  "Almanca",
  "Okuma Yazma",
  "Piyano",
  "Fizik",
  "İspanyolca",
  "Tenis",
] as const;

// Kütüphane/etüt merkezi arama kutusu için trend öneriler. İnsanlar mekânı
// adından çok semt/ilçe ve olanak ekseninde arar (sessiz alan, 24 saat açık…).
export const LIBRARY_TRENDING_SEARCHES = [
  "Sessiz çalışma alanı",
  "24 saat açık",
  "Etüt merkezi",
  "Seyhan",
  "Çukurova",
  "Ücretsiz wifi",
  "Kafeterya",
] as const;
