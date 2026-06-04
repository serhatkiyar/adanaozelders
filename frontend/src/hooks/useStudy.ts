import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  cancelStudy,
  fetchManageStudyReservations,
  fetchMyStudyReservations,
  fetchStudyQuote,
  payStudy,
  reserveStudy,
} from "@/api/study";

export function useStudyQuote(
  libraryId: number,
  startsAt: string | null,
  endsAt: string | null
) {
  return useQuery({
    queryKey: ["study-quote", libraryId, startsAt, endsAt],
    queryFn: () => fetchStudyQuote(libraryId, startsAt!, endsAt!),
    enabled: !!startsAt && !!endsAt,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useMyStudyReservations() {
  return useQuery({
    queryKey: ["study-reservations", "mine"],
    queryFn: fetchMyStudyReservations,
  });
}

export function useReserveStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ libraryId, startsAt, endsAt }: { libraryId: number; startsAt: string; endsAt: string }) =>
      reserveStudy(libraryId, startsAt, endsAt),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["study-reservations"] }),
  });
}

export function usePayStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reservationId: number) => payStudy(reservationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["study-reservations"] });
      qc.invalidateQueries({ queryKey: ["study-quote"] });
    },
  });
}

export function useCancelStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reservationId: number) => cancelStudy(reservationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["study-reservations"] }),
  });
}

export function useManageStudyReservations(libraryId: number | undefined) {
  return useQuery({
    queryKey: ["study-reservations", "manage", libraryId],
    queryFn: () => fetchManageStudyReservations(libraryId!),
    enabled: Number.isFinite(libraryId) && (libraryId ?? 0) > 0,
  });
}
