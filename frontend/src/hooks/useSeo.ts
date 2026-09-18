import { useQuery } from "@tanstack/react-query";

import { fetchPopulerDersler, fetchSeoSayfa } from "@/api/seo";

/**
 * Kök adres çözümü. 404 "sayfa yok" demektir, geçici hata değil: yeniden
 * denenmez, çağıran bunu doğrudan "bulunamadı" ekranına çevirir.
 */
export function useSeoSayfa(yol: string, enabled = true) {
  return useQuery({
    queryKey: ["seo", "sayfa", yol],
    queryFn: () => fetchSeoSayfa(yol),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** En çok öğretmeni olan dersler — sunucu 10 dk önbellekliyor. */
export function usePopulerDersler(limit = 8) {
  return useQuery({
    queryKey: ["seo", "populer-dersler", limit],
    queryFn: () => fetchPopulerDersler(limit),
    staleTime: 10 * 60_000,
    retry: false,
  });
}
