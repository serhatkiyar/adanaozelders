// F29 envanter React Query hook'ları — ADMIN. `useStock.ts`/`useDelivery.ts` deseni.
//
// Cache sözleşmesi: bütün envanter anahtarları `["inventory", ...]` altında
// toplanır. Stok bakiyesini değiştiren her mutation **ayrıca** defter ve ürün
// anahtarlarını da düşürür — sayım uygulandıktan sonra "Stok hareketleri"
// ekranı eski defteri göstermeye devam ederse operatör iki farklı gerçek görür.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/api/inventory";

const KEY = ["inventory"] as const;

/** Bakiye değişti: envanter + defter + ürün listeleri birlikte tazelenir. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["stock-movements"] });
    qc.invalidateQueries({ queryKey: ["stock-verify"] });
    qc.invalidateQueries({ queryKey: ["stock-audit"] });
    qc.invalidateQueries({ queryKey: ["admin", "products"] });
    qc.invalidateQueries({ queryKey: ["store", "products"] });
  };
}

/* ── Sayım oturumları ── */

export function useCountSessions(params: api.SessionListParams, enabled = true) {
  return useQuery({
    queryKey: [...KEY, "sessions", params],
    queryFn: () => api.fetchCountSessions(params),
    enabled,
    // Sayfa değişince ekran boşalıp zıplamasın.
    placeholderData: (previous) => previous,
  });
}

export function useCountSession(id: number, enabled = true) {
  return useQuery({
    queryKey: [...KEY, "sessions", "detail", id],
    queryFn: () => api.fetchCountSession(id),
    enabled: enabled && Number.isInteger(id) && id > 0,
  });
}

export function useCreateCountSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createCountSession,
    // Oturum açmak stok bakiyesini değiştirmez; yalnız envanter listesi tazelenir.
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "sessions"] }),
  });
}

export function useAddCountProducts(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productIds: number[]) => api.addCountProducts(sessionId, productIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "sessions"] }),
  });
}

export function useSetLineCount(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, countedQty }: { lineId: number; countedQty: number }) =>
      api.setLineCount(sessionId, lineId, countedQty),
    // Yanıt YALNIZ satırı döner; oturum durumu da değişmiş olabilir
    // (REVIEW → IN_PROGRESS). Bu yüzden satırı elle yamamak yerine detay
    // yeniden çekilir — yarı güncel ekran yanlış eylem sunar.
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "sessions"] }),
  });
}

export function useResolveCountLine(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, note }: { lineId: number; note: string }) =>
      api.resolveCountLine(sessionId, lineId, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "sessions"] }),
  });
}

export function useCountSessionAction(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: api.SessionAction) => api.countSessionAction(sessionId, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "sessions"] }),
  });
}

export function useApplyCountSession(sessionId: number) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (idempotencyKey: string) => api.applyCountSession(sessionId, idempotencyKey),
    onSuccess: invalidate,
  });
}

export function useCancelCountSession(sessionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.cancelCountSession(sessionId, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "sessions"] }),
  });
}

/* ── Hasar olayları ── */

export function useDamageEvents(params: api.DamageListParams, enabled = true) {
  return useQuery({
    queryKey: [...KEY, "damage", params],
    queryFn: () => api.fetchDamageEvents(params),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useCreateDamageEvent() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: api.createDamageEvent,
    onSuccess: invalidate,
  });
}

export function useOnPremise(productId: number | null) {
  return useQuery({
    queryKey: [...KEY, "on-premise", productId],
    queryFn: () => api.fetchOnPremise(productId!),
    enabled: productId != null && Number.isInteger(productId) && productId > 0,
  });
}
