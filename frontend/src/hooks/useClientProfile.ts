import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchClient, searchClients, type ClientSearchParams } from "@/api/clients";

export function useClientDetail(id: number) {
  return useQuery({
    queryKey: ["clients", "detail", id],
    queryFn: () => fetchClient(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useClientSearch(params: ClientSearchParams) {
  return useQuery({
    queryKey: ["clients", "search", params],
    queryFn: () => searchClients(params),
    placeholderData: keepPreviousData,
  });
}
