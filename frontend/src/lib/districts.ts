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

// Arama ekranındaki "ders mekanı" (ilçe) seçici için genişletilmiş liste.
// ADANA_DISTRICTS'ten (onboarding/adres formları) bağımsız: burada başta bir
// "Merkez" kısayolu var + daha fazla ilçe "Diğer ilçeleri görüntüle" ile açılır.
// Onboarding dropdown'ı henüz bu genişletilmiş listeyi sunmuyor — yalnız arama tarafı.
export const SEARCH_PRIMARY_DISTRICTS = [
  "Merkez",
  "Seyhan",
  "Çukurova",
  "Yüreğir",
  "Sarıçam",
  "Ceyhan",
  "Kozan",
];

// "Diğer ilçeleri görüntüle" ile açılan, daha az nüfuslu geri kalan ilçeler.
export const SEARCH_MORE_DISTRICTS = [
  "Karaisalı",
  "Karataş",
  "Yumurtalık",
  "İmamoğlu",
  "Pozantı",
  "Aladağ",
  "Feke",
  "Saimbeyli",
  "Tufanbeyli",
];
