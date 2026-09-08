import {
  SEARCH_MORE_DISTRICTS,
  SEARCH_PRIMARY_DISTRICTS,
} from "@/lib/districts";

/** Sihirbazın tuttuğu tüm form değerleri (dosyalar dâhil). */
export interface FormDurumu {
  // Adım 1 — başvurunun zorunlu çekirdeği
  ad: string;
  telefon: string;
  dersler: string;
  kvkk: boolean;
  // Adım 2 — seni tanıtalım
  foto: Blob | null;
  fotoOnizleme: string | null;
  baslik: string;
  tanitim: string;
  deneyim: string;
  eposta: string;
  // Adım 3 — dersin nasıl işliyor
  bicim: string;
  ilce: string;
  ucret: string;
  musaitlik: string;
  video: string;
  // Adım 4 — eğitimin ve belgelerin
  egitim: string;
  belgeler: File[];
  not: string;
}

export const BOS_FORM: FormDurumu = {
  ad: "",
  telefon: "",
  dersler: "",
  kvkk: false,
  foto: null,
  fotoOnizleme: null,
  baslik: "",
  tanitim: "",
  deneyim: "",
  eposta: "",
  bicim: "",
  ilce: "",
  ucret: "",
  musaitlik: "",
  video: "",
  egitim: "",
  belgeler: [],
  not: "",
};

/** Backend `EXPERIENCE_CHOICES` ile birebir aynı değerler. */
export const DENEYIM_SECENEKLERI = [
  { deger: "universite-ogrencisi", etiket: "Üniversite öğrencisiyim" },
  { deger: "0-2", etiket: "0–2 yıl" },
  { deger: "3-5", etiket: "3–5 yıl" },
  { deger: "5+", etiket: "5 yıldan fazla" },
] as const;

/** Backend `TEACHING_MODE_CHOICES` ile birebir aynı değerler. */
export const BICIM_SECENEKLERI = [
  { deger: "ONLINE", etiket: "Online" },
  { deger: "IN_PERSON", etiket: "Yüz yüze" },
  { deger: "BOTH", etiket: "İkisi de olur" },
] as const;

// Not: burada bir zamanlar `.filter((d) => d !== "Merkez")` vardı — arama
// listesinde gerçek olmayan bir "Merkez" kısayolu bulunduğu için. O kısayol
// 8 Eyl 2026'da kaynağından kaldırıldı (bkz. lib/districts.ts), süzgeç de
// gereksiz kaldı.
export const ILCELER = [
  ...SEARCH_PRIMARY_DISTRICTS,
  ...SEARCH_MORE_DISTRICTS,
].map((d) => ({ deger: d, etiket: d }));

/** Belge ekleri — backend sınırlarının aynası (MAX_DOCUMENTS / 10 MB). */
export const MAX_BELGE = 3;
export const MAX_BELGE_BAYT = 10 * 1024 * 1024;
export const BELGE_KABUL =
  ".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf";
/** Fotoğraf — backend `MAX_AVATAR_SIZE_BYTES` aynası. */
export const MAX_FOTO_BAYT = 5 * 1024 * 1024;
