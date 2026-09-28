import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPayout,
  fetchPayoutHistory,
  fetchPendingPayouts,
  type PayoutCreate,
} from "@/api/payouts";

/** Ödenmemiş bakiyeler — ödeme günü açılacak liste. */
export function usePendingPayouts(onlyOwed = true, enabled = true) {
  return useQuery({
    queryKey: ["payouts", "pending", onlyOwed],
    queryFn: () => fetchPendingPayouts(onlyOwed),
    enabled,
    // Para verisi: bayat gösterim yanlış ödemeye yol açar.
    staleTime: 0,
  });
}

/** `offset` sunucu sayfalamasıdır; varsayılanlı olduğu için eski çağıran aynen çalışır. */
export function usePayoutHistory(limit = 100, enabled = true, offset = 0) {
  return useQuery({
    queryKey: ["payouts", "history", limit, offset],
    queryFn: () => fetchPayoutHistory(limit, offset),
    enabled,
    staleTime: 30_000,
  });
}

export function useCreatePayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PayoutCreate) => createPayout(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payouts"] });
    },
  });
}
