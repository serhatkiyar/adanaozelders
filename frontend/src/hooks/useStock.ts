import { useQuery } from "@tanstack/react-query";

import {
  fetchLedgerAudit,
  fetchProductStockMovements,
  fetchProductStockVerify,
  fetchStockMovements,
  type MovementFilters,
} from "@/api/stock";

/** Ürün bazlı defter geçmişi. `enabled` ile pencere açılmadan istek atılmaz. */
export function useProductStockMovements(
  productId: number | null,
  filters: MovementFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["stock-movements", "product", productId, filters],
    queryFn: () => fetchProductStockMovements(productId as number, filters),
    enabled: enabled && productId != null,
  });
}

/** Genel envanter hareketleri (filtreli, sayfalı). */
export function useStockMovements(filters: MovementFilters = {}) {
  return useQuery({
    queryKey: ["stock-movements", "all", filters],
    queryFn: () => fetchStockMovements(filters),
  });
}

/** Tek ürünün defter doğrulaması (teşhis; hiçbir şeyi düzeltmez). */
export function useProductStockVerify(productId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["stock-verify", productId],
    queryFn: () => fetchProductStockVerify(productId as number),
    enabled: enabled && productId != null,
  });
}

/** Defterin sayfalı genel doğrulaması. */
export function useLedgerAudit(
  params: { limit?: number; offset?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: ["stock-audit", params],
    queryFn: () => fetchLedgerAudit(params),
    enabled,
  });
}
