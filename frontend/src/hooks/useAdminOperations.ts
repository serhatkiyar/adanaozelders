import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchFailedOutbox,
  fetchStuckEscrow,
  retryOutboxEvent,
} from "@/api/adminOperations";

const KOK = ["admin", "operations"] as const;

export function useStuckEscrow(enabled = true) {
  return useQuery({
    queryKey: [...KOK, "escrow-stuck"],
    queryFn: fetchStuckEscrow,
    // Para teşhisi: bayat gösterim "sorun çözüldü" yanılgısı üretir.
    staleTime: 0,
    enabled,
  });
}

export function useFailedOutbox(enabled = true) {
  return useQuery({
    queryKey: [...KOK, "outbox-failed"],
    queryFn: fetchFailedOutbox,
    staleTime: 0,
    enabled,
  });
}

export function useRetryOutboxEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => retryOutboxEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KOK, "outbox-failed"] }),
  });
}
