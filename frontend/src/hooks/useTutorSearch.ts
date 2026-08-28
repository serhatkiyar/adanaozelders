import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchFeaturedTutors,
  fetchPriceHistogram,
  fetchTutor,
  searchTutors,
  type FeaturedTutorParams,
  type PriceHistogramParams,
  type TutorSearchParams,
} from "@/api/tutors";

export function useTutorSearch(params: TutorSearchParams) {
  return useQuery({
    queryKey: ["tutors", "search", params],
    queryFn: () => searchTutors(params),
    placeholderData: keepPreviousData,
  });
}

/** Öne çıkarma bloğu. `enabled=false` ile 2. sayfada hiç istenmez. */
export function useFeaturedTutors(params: FeaturedTutorParams, enabled = true) {
  return useQuery({
    queryKey: ["tutors", "featured", params],
    queryFn: () => fetchFeaturedTutors(params),
    placeholderData: keepPreviousData,
    enabled,
    // Rotasyon rastgeledir; her tuş vuruşunda kart değiştirmemek için kısa
    // bir tazelik penceresi bırakılır.
    staleTime: 60 * 1000,
  });
}

export function useTutorPriceHistogram(
  params: PriceHistogramParams,
  enabled = true
) {
  return useQuery({
    queryKey: ["tutors", "price-histogram", params],
    queryFn: () => fetchPriceHistogram(params),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTutorDetail(id: number) {
  return useQuery({
    queryKey: ["tutors", "detail", id],
    queryFn: () => fetchTutor(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}
