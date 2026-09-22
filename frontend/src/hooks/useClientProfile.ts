import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchClient, fetchMyTutors, searchClients, type ClientSearchParams } from "@/api/clients";

export function useClientDetail(id: number) {
  return useQuery({
    queryKey: ["clients", "detail", id],
    queryFn: () => fetchClient(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

/** Öğrencinin ders aldığı öğretmenler; "Derslerim → Öğretmenlerim" sekmesi. */
export function useMyTutors(enabled = true) {
  return useQuery({
    queryKey: ["clients", "me", "tutors"],
    queryFn: fetchMyTutors,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useClientSearch(params: ClientSearchParams) {
  return useQuery({
    queryKey: ["clients", "search", params],
    queryFn: () => searchClients(params),
    placeholderData: keepPreviousData,
  });
}
