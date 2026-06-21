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
