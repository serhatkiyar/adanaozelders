import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getTutorSlots } from "@/api/tutors";

/** Slot anahtarının ön eki; ders talebi sonrası bu önekle tazelenir. */
export function tutorSlotsKey(tutorId: number) {
  return ["tutors", tutorId, "slots"] as const;
}

/**
 * Eğitmenin `from` gününden başlayan 7 günlük boş/dolu ders saatleri.
 * `oncekiniTut`: hafta/süre değişirken önceki yanıt yer tutucu kalır
 * (`isPlaceholderData`); bu sırada saatler seçtirilmemelidir.
 */
export function useTutorSlots(
  tutorId: number,
  from: string,
  duration: number,
  { oncekiniTut = false }: { oncekiniTut?: boolean } = {},
) {
  return useQuery({
    queryKey: [...tutorSlotsKey(tutorId), from, duration],
    queryFn: () => getTutorSlots(tutorId, { from, days: 7, duration }),
    enabled: Number.isFinite(tutorId) && tutorId > 0 && Boolean(from),
    placeholderData: oncekiniTut ? keepPreviousData : undefined,
  });
}
