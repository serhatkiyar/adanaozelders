import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchTutor, searchTutors, type TutorSearchParams } from "@/api/tutors";

export function useTutorSearch(params: TutorSearchParams) {
  return useQuery({
    queryKey: ["tutors", "search", params],
    queryFn: () => searchTutors(params),
    placeholderData: keepPreviousData,
  });
}

export function useTutorDetail(id: number) {
  return useQuery({
    queryKey: ["tutors", "detail", id],
    queryFn: () => fetchTutor(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}
