import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  browseDemands,
  closeDemand,
  createDemand,
  fetchDemandResponses,
  fetchMyDemands,
  respondToDemand,
} from "@/api/demands";
import type { DemandCreate } from "@/types";

/* ── Öğrenci ── */

export function useMyDemands() {
  return useQuery({
    queryKey: ["demands", "me"],
    queryFn: fetchMyDemands,
  });
}

export function useCreateDemand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: DemandCreate) => createDemand(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["demands", "me"] }),
  });
}

export function useCloseDemand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (demandId: number) => closeDemand(demandId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["demands", "me"] }),
  });
}

export function useDemandResponses(demandId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ["demands", "responses", demandId],
    queryFn: () => fetchDemandResponses(demandId!),
    enabled: enabled && Number.isFinite(demandId) && (demandId ?? 0) > 0,
  });
}

/* ── Eğitmen ── */

export function useBrowseDemands(mine: boolean) {
  return useQuery({
    queryKey: ["demands", "browse", { mine }],
    queryFn: () => browseDemands({ mine }),
  });
}

export function useRespondDemand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ demandId, body }: { demandId: number; body: string }) =>
      respondToDemand(demandId, body),
    onSuccess: () => {
      // "Yanıtladın" rozeti güncellensin + yeni sohbet listede çıksın.
      qc.invalidateQueries({ queryKey: ["demands", "browse"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
