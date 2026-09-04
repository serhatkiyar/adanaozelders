import { useQuery } from "@tanstack/react-query";

import {
  fetchLevelScales,
  fetchSubjects,
  type Ders,
  type DersKapsami,
} from "@/api/subjects";

/**
 * Ders kataloğu — oturum başına tek istek.
 *
 * Katalog admin küratörlüğüyle nadiren değişir; sunucu da bir saatlik
 * `Cache-Control` gönderiyor. `staleTime: Infinity` ile aynı oturumda tekrar
 * çekilmez: seçici her açıldığında 846 kalem indirmek anlamsız olurdu.
 *
 * Build-time anlık görüntü BİLEREK üretilmiyor — frontend sabiti ile sunucu
 * gerçeğinin ayrışması tam olarak sökmeye çalıştığımız hastalık.
 */
export function useSubjects(kapsam: DersKapsami = "vitrin") {
  return useQuery({
    queryKey: ["subjects", kapsam],
    queryFn: () => fetchSubjects(kapsam),
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

export function useLevelScales() {
  return useQuery({
    queryKey: ["subject-levels"],
    queryFn: fetchLevelScales,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

/** Ders adını id'den çözmek için hazır harita (etiket gösterimi). */
export function dersHaritasi(dersler: Ders[] | undefined): Map<number, Ders> {
  return new Map((dersler ?? []).map((d) => [d.id, d]));
}
