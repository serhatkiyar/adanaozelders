import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createTimeOff, deleteTimeOff, listTimeOff, previewTimeOff } from "@/api/timeOff";
import { TUTOR_DASHBOARD_KEY } from "@/hooks/useTutorDashboard";
import type { TimeOffCreate, TimeOffRange } from "@/types";

export const TIME_OFF_KEY = ["time-off"] as const;

/** Görünen pencerenin izinleri. `range` yoksa sorgu çalışmaz. */
export function useTimeOff(range: { start: string; end: string } | null) {
  return useQuery({
    queryKey: [...TIME_OFF_KEY, range?.start, range?.end],
    queryFn: () => listTimeOff(range!.start, range!.end),
    enabled: range !== null,
  });
}

export function usePreviewTimeOff() {
  return useMutation({
    mutationFn: (range: TimeOffRange) => previewTimeOff(range),
  });
}

// İzin dersleri iptal/ret edebilir: takvim, ders listeleri ve pano birlikte tazelenir.
function izinVerisiniYenile(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: TIME_OFF_KEY });
  qc.invalidateQueries({ queryKey: ["bookings"] });
  qc.invalidateQueries({ queryKey: TUTOR_DASHBOARD_KEY });
}

export function useCreateTimeOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: TimeOffCreate) => createTimeOff(payload),
    onSettled: () => izinVerisiniYenile(qc),
  });
}

export function useDeleteTimeOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteTimeOff(id),
    onSettled: () => izinVerisiniYenile(qc),
  });
}
