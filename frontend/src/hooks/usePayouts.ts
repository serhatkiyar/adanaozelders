import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPayout,
  fetchPayoutHistory,
  fetchPendingPayouts,
  type PayoutCreate,
} from "@/api/payouts";

/** Ödenmemiş bakiyeler — ödeme günü açılacak liste. */
export function usePendingPayouts(onlyOwed = true) {
  return useQuery({
    queryKey: ["payouts", "pending", onlyOwed],
    queryFn: () => fetchPendingPayouts(onlyOwed),
    // Para verisi: bayat gösterim yanlış ödemeye yol açar.
    staleTime: 0,
  });
}

export function usePayoutHistory(limit = 100) {
  return useQuery({
    queryKey: ["payouts", "history", limit],
    queryFn: () => fetchPayoutHistory(limit),
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
