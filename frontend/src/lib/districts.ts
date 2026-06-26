// Adana ilçeleri — eğitmen onboarding'inde ve aramadaki "İlçe" filtresinde
// kullanılır. Yalnız nüfusu yüksek/ders talebi anlamlı ilçeler (nüfusa göre sıralı);
// kırsal/düşük nüfuslu ilçeler hariç. Tek doğruluk kaynağı: hem TutorSettings
// dropdown'ı hem arama çubukları bu listeyi tüketir.
export const ADANA_DISTRICTS = [
  "Seyhan", // ~807.420
  "Çukurova", // ~456.918
  "Yüreğir", // ~425.600
  "Sarıçam", // ~197.384
] as const;

export type AdanaDistrict = (typeof ADANA_DISTRICTS)[number];
