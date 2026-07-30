import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchFeatureFlags,
  fetchPaymentAvailability,
  fetchPaymentBranches,
  updateFeatureFlag,
} from "@/api/featureFlags";

/**
 * Ödeme kolu uygunluğu (public).
 *
 * `retry: false` + `meta.silentError`: uç düşerse kullanıcıya hata toast'ı
 * göstermek yerine sessizce "bilgi yok" durumunda kalınır — istemci tarafı
 * fail-closed olduğu için bu, ödeme butonunun gizlenmesi anlamına gelir
 * (`lib/paymentAvailability`). Yanlış bir "ödeyebilirsin" vaadi vermekten
 * iyidir.
 */
export function usePaymentAvailability() {
  return useQuery({
    queryKey: ["payments", "availability"],
    queryFn: fetchPaymentAvailability,
    staleTime: 60_000,
    retry: false,
    meta: { silentError: true },
  });
}

export function useFeatureFlags() {
  return useQuery({ queryKey: ["admin", "feature-flags"], queryFn: fetchFeatureFlags });
}

export function usePaymentBranches() {
  return useQuery({ queryKey: ["admin", "payment-branches"], queryFn: fetchPaymentBranches });
}

export function useUpdateFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      key,
      enabled,
      note,
    }: {
      key: string;
      enabled: boolean;
      note?: string | null;
    }) => updateFeatureFlag(key, { enabled, note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "feature-flags"] });
      qc.invalidateQueries({ queryKey: ["admin", "payment-branches"] });
      // Müşteri yüzeyindeki uygunluk da anında tazelenmeli.
      qc.invalidateQueries({ queryKey: ["payments", "availability"] });
    },
  });
}
