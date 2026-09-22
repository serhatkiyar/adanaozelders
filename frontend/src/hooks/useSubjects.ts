import { useQuery } from "@tanstack/react-query";

import {
  fetchLevelScales,
  fetchSubjects,
  type Ders,
  type DersKapsami,
  type SeviyeMerdiveni,
} from "@/api/subjects";
import { dersinSeviyeleri } from "@/lib/dersArama";

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

/**
 * SEVİYE seçenekleri — yalnız TEK ders seçiliyken anlamlı (bkz.
 * `EgitmenAramasi.seviye` / `duzelt`). Katalog `HeroSearch`'teki ders arama
 * kutusuyla AYNI kaynak (`useSubjects("secim")`) — aksi halde filtre
 * çubuğu/penceresi farklı ders adı kümesine bakardı.
 *
 * Filtre çubuğundaki "Seviye" çipi VE filtre penceresi bu hook'u ORTAK
 * kullanır ki iki yüzey ayrışmasın.
 */
export function useSeviyeSecenekleri(ders: string[]): SeviyeMerdiveni[] {
  const { data: katalog } = useSubjects("secim");
  const { data: merdivenlerKatalogu } = useLevelScales();
  const secilenDers =
    ders.length === 1 ? katalog?.find((d) => d.name === ders[0]) : undefined;
  return dersinSeviyeleri(secilenDers, merdivenlerKatalogu);
}
