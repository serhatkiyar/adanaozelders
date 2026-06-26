// Trend aramalar — ders arama kutusu boş+odaklıyken öneri olarak gösterilir.
// Kaynak: Adana pazar araştırması (scripts/out/02_talep_analizi_armut.md,
// Armut.com birikmiş yorum = gerçekleşmiş iş sinyali). İnsanlar "sınav" değil
// "ders/seviye+ders" arıyor (Matematik 430, İngilizce 384, TYT 453, Ortaokul 259…),
// o yüzden öneriler ders/seviye eksenli. Şimdilik küratörlü sabit; ileride
// gerçek arama loglarından dinamikleştirilebilir.
export const TRENDING_SEARCHES = [
  "Matematik",
  "İngilizce",
  "TYT Matematik",
  "Ortaokul Matematik",
  "LGS Matematik",
  "Fizik",
  "Kimya",
  "Almanca",
  "İlkokul",
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
