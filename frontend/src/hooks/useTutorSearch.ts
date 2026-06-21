import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchPriceHistogram,
  fetchTutor,
  searchTutors,
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
