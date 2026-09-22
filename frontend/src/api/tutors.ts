import { apiClient } from "@/api/axios";
import type {
  Gender,
  TutorOut,
  TutorProfileUpdate,
  TutorSearchOut,
  TutorDashboardOut,
  TutorSort,
  SlotsOut,
} from "@/types";

export interface TutorSearchParams {
  q?: string;
  min_rate?: number;
  max_rate?: number;
  mode?: string[];
  gender?: Gender;
  min_age?: number;
  max_age?: number;
  subject?: string[];
  district?: string[];
  // Seviye — YALNIZ tek bir `subject` seçiliyken anlamlı: kanonik derse
  // (`TutorSubjectLevel.subject_id`) bağlı sunucu tarafı filtre.
  level_id?: number;
  // Sınav bağlamı (TYT/AYT/KPSS…): sert filtre değil, sıralama boost'u.
  exam?: string;
  sort?: TutorSort;
  lat?: number;
  lng?: number;
  radius_km?: number;
  limit?: number;
  offset?: number;
}

export async function searchTutors(
  params: TutorSearchParams
): Promise<TutorSearchOut[]> {
  const { data } = await apiClient.get<TutorSearchOut[]>("/tutors/search", {
    params,
    // Dizi paramları FastAPI'nin beklediği gibi tekrarla: mode=ONLINE&mode=IN_PERSON
    paramsSerializer: { indexes: null },
  });
  return data;
}

// Fiyat aralığı histogramı: eşleşen eğitmenlerin saatlik ücret dağılımı
// (fiyat filtresi hariç aynı sert filtreler). min_rate/max_rate gönderilmez.
export type PriceHistogramParams = Omit<
  TutorSearchParams,
  "min_rate" | "max_rate" | "sort" | "limit" | "offset" | "exam"
>;

export async function fetchPriceHistogram(
  params: PriceHistogramParams
): Promise<number[]> {
  const { data } = await apiClient.get<number[]>("/tutors/price-histogram", {
    params,
    paramsSerializer: { indexes: null },
  });
  return data;
}

/**
 * Cinsiyet fasetleri — seçenek başına kaç eğitmen.
 *
 * `gender` BİLEREK dışarıda: faset kendi eksenini saymaz. Sayarsaydı kullanıcı
 * "Kadın"ı seçtiği anda "Erkek 0" görünürdü. Aynı desen `price-histogram`da da
 * var (o da fiyat filtresini atlar).
 */
export type GenderFacetParams = Omit<PriceHistogramParams, "gender">;

/** Anahtarlar: `MALE` · `FEMALE` · `UNSPECIFIED` · `belirtilmemis` · `gorunmeyen`. */
export type GenderFacets = Record<string, number>;

export async function fetchGenderFacets(
  params: GenderFacetParams
): Promise<GenderFacets> {
  const { data } = await apiClient.get<GenderFacets>("/tutors/gender-facets", {
    params,
    paramsSerializer: { indexes: null },
  });
  return data;
}

// Öne çıkarma bloğu: arama ile AYNI sert filtreler, en fazla 3 sonuç.
// `sort` ve `exam` bilinçli olarak YOK — bu blokta sıralama satın alınmaz.
export type FeaturedTutorParams = Omit<
  TutorSearchParams,
  "sort" | "exam" | "limit" | "offset"
>;

export async function fetchFeaturedTutors(
  params: FeaturedTutorParams
): Promise<TutorSearchOut[]> {
  const { data } = await apiClient.get<TutorSearchOut[]>("/tutors/featured", {
    params,
    paramsSerializer: { indexes: null },
  });
  return data;
}

export interface PromotionPackage {
  days: number;
  price: string;
  label: string;
}

export interface TutorPromotion {
  id: number;
  package_days: number;
  price: string;
  currency: string;
  payment_status: string;
  starts_at: string | null;
  ends_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export async function fetchPromotionPackages(): Promise<PromotionPackage[]> {
  const { data } = await apiClient.get<PromotionPackage[]>(
    "/tutors/promotion-packages"
  );
  return data;
}

export async function fetchMyPromotions(): Promise<TutorPromotion[]> {
  const { data } = await apiClient.get<TutorPromotion[]>("/tutors/me/promotions");
  return data;
}

export interface PromotionPurchaseResult {
  promotion: TutorPromotion;
  redirect_url: string | null;
}

export async function buyPromotion(payload: {
  days: number;
  terms_accepted: boolean;
}): Promise<PromotionPurchaseResult> {
  // Tutar GÖNDERİLMEZ: fiyatın tek kaynağı sunucudaki katalogdur.
  const { data } = await apiClient.post<PromotionPurchaseResult>(
    "/tutors/me/promotions",
    payload
  );
  return data;
}

export async function fetchTutor(id: number): Promise<TutorSearchOut> {
  const { data } = await apiClient.get<TutorSearchOut>(`/tutors/${id}`);
  return data;
}

export interface TutorSlotsParams {
  /** "YYYY-MM-DD" (İstanbul). */
  from: string;
  days?: number;
  /** Ders süresi (dk): 30 | 60 | 90 | 120. */
  duration: number;
}

// Ders ayırtma saatleri: boş ve dolu slotlar, kural ve ücret sunucuda hesaplanır.
export async function getTutorSlots(
  tutorId: number,
  { from, days = 7, duration }: TutorSlotsParams
): Promise<SlotsOut> {
  const { data } = await apiClient.get<SlotsOut>(`/tutors/${tutorId}/slots`, {
    params: { from, days, duration },
  });
  return data;
}

// Giriş yapmış eğitmenin kendi ilan profili (status + headline/bio/hourly_rate).
export async function fetchMyTutorProfile(): Promise<TutorOut> {
  const { data } = await apiClient.get<TutorOut>("/tutors/me");
  return data;
}

// Eğitmen panosu özeti (sayılar, sıradaki/yaklaşan dersler, görünürlük nedenleri).
export async function fetchMyTutorDashboard(): Promise<TutorDashboardOut> {
  const { data } = await apiClient.get<TutorDashboardOut>("/tutors/me/dashboard");
  return data;
}

export async function updateMyTutorProfile(
  payload: TutorProfileUpdate
): Promise<TutorOut> {
  const { data } = await apiClient.patch<TutorOut>("/tutors/me", payload);
  return data;
}

export async function submitMyTutorProfile(): Promise<TutorOut> {
  const { data } = await apiClient.post<TutorOut>("/tutors/me/submit");
  return data;
}

export async function suspendMyListing(): Promise<TutorOut> {
  const { data } = await apiClient.post<TutorOut>("/tutors/me/suspend");
  return data;
}

export async function activateMyListing(): Promise<TutorOut> {
  const { data } = await apiClient.post<TutorOut>("/tutors/me/activate");
  return data;
}
