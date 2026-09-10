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
// ADANA_DISTRICTS'ten (onboarding/adres formları) bağımsız: daha fazla ilçe
// "Diğer ilçeleri görüntüle" ile açılır.
// Onboarding dropdown'ı henüz bu genişletilmiş listeyi sunmuyor — yalnız arama tarafı.
//
// "Merkez" 8 Eyl 2026'da KALDIRILDI: gerçek bir Adana ilçesi değildi, hiçbir
// eğitmen/kütüphane kaydında böyle bir değer yazılı olamazdı ve filtre birebir
// ilçe adına baktığı için seçildiğinde GARANTİLİ 0 sonuç veriyordu — hata
// vermeden, sessizce. Kullanıcının "merkez" dediği yer Seyhan/Çukurova/
// Yüreğir/Sarıçam'dır; onlar zaten listenin başında.
// SIRA ÜRÜN KARARIDIR (kullanıcı, 10 Eyl 2026): Çukurova başa alındı. Liste
// nüfusa göre değil, PLATFORMUN ARZINA göre sıralı — arz ve talebin yoğun
// olduğu ilçe önce görünmeli, çünkü arama yüzeyi yalnız ilk üçünü gösteriyor
// ve altı katlamanın altında kalıyor.
export const SEARCH_PRIMARY_DISTRICTS = [
  "Çukurova",
  "Seyhan",
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
