import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listMyStudents, offerLesson } from "@/api/dersTeklifi";
import { TUTOR_DASHBOARD_KEY } from "@/hooks/useTutorDashboard";
import type { BookingOfferCreate } from "@/types";

export const TUTOR_STUDENTS_KEY = ["tutor", "students"] as const;

/** Öğrenci listesi teklif penceresi açılınca çekilir; sık değişmez. */
export function useMyStudents(enabled: boolean) {
  return useQuery({
    queryKey: TUTOR_STUDENTS_KEY,
    queryFn: listMyStudents,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useOfferLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BookingOfferCreate) => offerLesson(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: TUTOR_DASHBOARD_KEY });
    },
  });
}
