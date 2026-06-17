import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMyPayout, submitMyPayout } from "@/api/payout";
import { useAuthStore } from "@/store/authStore";
import type { PayoutSubmit } from "@/types";

const PAYOUT_KEY = ["payout", "me"] as const;

export function useMyPayout(enabled = true) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: PAYOUT_KEY,
    queryFn: fetchMyPayout,
    enabled: !!token && enabled,
  });
}

export function useSubmitPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PayoutSubmit) => submitMyPayout(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PAYOUT_KEY });
      // Profil "Kimliği Doğrulanmış" rozeti payout durumundan türer.
      qc.invalidateQueries({ queryKey: ["tutors", "detail"] });
    },
  });
}
