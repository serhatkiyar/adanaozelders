import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createSeries,
  endSeries,
  getSeries,
  listMyStudents,
  offerLesson,
  previewSeries,
  withdrawOffer,
} from "@/api/dersTeklifi";
import { TUTOR_DASHBOARD_KEY } from "@/hooks/useTutorDashboard";
import type { BookingOfferCreate, LessonSeriesCreate } from "@/types";

export const TUTOR_STUDENTS_KEY = ["tutor", "students"] as const;
export const SERI_KEY = ["lesson-series"] as const;

/** Öğrenci listesi teklif penceresi açılınca çekilir; sık değişmez. */
export function useMyStudents(enabled: boolean) {
  return useQuery({
    queryKey: TUTOR_STUDENTS_KEY,
    queryFn: listMyStudents,
    enabled,
    staleTime: 5 * 60_000,
  });
}

// Teklif yazan her işlem ders listelerini ve panoyu birlikte tazeler.
function dersVerisiniYenile(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["bookings"] });
  qc.invalidateQueries({ queryKey: TUTOR_DASHBOARD_KEY });
  // Öğrenciler sayfasındaki "sonraki ders" kolonu bayat kalmasın.
  qc.invalidateQueries({ queryKey: TUTOR_STUDENTS_KEY });
}

export function useOfferLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BookingOfferCreate) => offerLesson(payload),
    onSuccess: () => dersVerisiniYenile(qc),
  });
}

/** Seri önizlemesi — salt okunur, bu yüzden hiçbir önbelleği tazelemez. */
export function useSeriOnizleme() {
  return useMutation({
    mutationFn: (payload: LessonSeriesCreate) => previewSeries(payload),
  });
}

export function useSeriOlustur() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: LessonSeriesCreate) => createSeries(payload),
    onSettled: () => dersVerisiniYenile(qc),
  });
}

export function useSeri(id: number | null | undefined) {
  return useQuery({
    queryKey: [...SERI_KEY, id],
    queryFn: () => getSeries(id!),
    enabled: typeof id === "number" && id > 0,
  });
}

export function useSeriBitir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => endSeries(id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: SERI_KEY });
      dersVerisiniYenile(qc);
    },
  });
}

export function useTeklifiGeriCek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: number) => withdrawOffer(bookingId),
    onSettled: () => dersVerisiniYenile(qc),
  });
}
