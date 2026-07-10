// Kendi-filo teslimat (dağıtım turları) React Query hook'ları — ADMIN.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as deliveryApi from "@/api/delivery";

const KEY = ["delivery"] as const;

export function useEligibleOrders(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "eligible"],
    queryFn: deliveryApi.fetchEligibleOrders,
    enabled,
  });
}

/** "Dış kargo bekliyor" kuyruğu (bölge dışı ödenmiş fiziksel siparişler) — ADMIN. */
export function useOutsourcedOrders(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "outsourced"],
    queryFn: deliveryApi.fetchOutsourcedOrders,
    enabled,
  });
}

/** Public teslimat sözü rozeti. Sunucu verisi; geri sayımı istemci saniyeler
 * bazında kendisi eritir (staleTime ile gereksiz istek atılmaz). */
export function useDeliveryInfo(enabled = true) {
  return useQuery({
    queryKey: ["deliveryInfo"],
    queryFn: deliveryApi.fetchDeliveryInfo,
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useDeliveryRuns(runDate?: string) {
  return useQuery({
    queryKey: [...KEY, "runs", runDate ?? "all"],
    queryFn: () => deliveryApi.fetchDeliveryRuns(runDate),
  });
}

export function useDeliveryRun(runId: number | null, opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: [...KEY, "run", runId],
    queryFn: () => deliveryApi.fetchDeliveryRun(runId!),
    enabled: runId != null,
    // Saha ekranı: iki dağıtıcı telefonu aynı turu görüyor olabilir — tazele.
    refetchInterval: opts?.poll ? 15_000 : undefined,
  });
}

function useInvalidateDelivery() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useCreateDeliveryRun() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: deliveryApi.createDeliveryRun,
    onSuccess: invalidate,
  });
}

export function useUpdateDeliveryRun() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: ({
      runId,
      courierId,
    }: {
      runId: number;
      courierId: number | null;
    }) => deliveryApi.updateDeliveryRun(runId, { courier_id: courierId }),
    onSuccess: invalidate,
  });
}

/* ── Kurye profilleri (ADMIN) ── */

export function useCouriers(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "couriers"],
    queryFn: deliveryApi.fetchCouriers,
    enabled,
  });
}

export function useCreateCourier() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: deliveryApi.createCourier,
    onSuccess: invalidate,
  });
}

export function useUpdateCourier() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: ({
      courierId,
      payload,
    }: {
      courierId: number;
      payload: import("@/types").CourierUpdate;
    }) => deliveryApi.updateCourier(courierId, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteCourier() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: (courierId: number) => deliveryApi.deleteCourier(courierId),
    onSuccess: invalidate,
  });
}

export function useUploadCourierPhoto() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: ({ courierId, file }: { courierId: number; file: File }) =>
      deliveryApi.uploadCourierPhoto(courierId, file),
    onSuccess: invalidate,
  });
}

export function useRunAction() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: ({
      runId,
      action,
    }: {
      runId: number;
      action: "start" | "complete" | "cancel";
    }) =>
      action === "start"
        ? deliveryApi.startDeliveryRun(runId)
        : action === "complete"
          ? deliveryApi.completeDeliveryRun(runId)
          : deliveryApi.cancelDeliveryRun(runId),
    onSuccess: invalidate,
  });
}

export function useOptimizeRun() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: (runId: number) => deliveryApi.optimizeDeliveryRun(runId),
    onSuccess: invalidate,
  });
}

export function useAddStops() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: ({ runId, orderIds }: { runId: number; orderIds: number[] }) =>
      deliveryApi.addDeliveryStops(runId, orderIds),
    onSuccess: invalidate,
  });
}

export function useRemoveStop() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: (stopId: number) => deliveryApi.removeDeliveryStop(stopId),
    onSuccess: invalidate,
  });
}

export function useReorderStops() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: ({ runId, stopIds }: { runId: number; stopIds: number[] }) =>
      deliveryApi.reorderDeliveryStops(runId, stopIds),
    onSuccess: invalidate,
  });
}

export function useSendDeliveryOtp() {
  return useMutation({
    mutationFn: (stopId: number) => deliveryApi.sendDeliveryOtp(stopId),
  });
}

export function useVerifyDelivery() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: ({
      stopId,
      code,
      coords,
    }: {
      stopId: number;
      code: string;
      coords?: { lat: number; lng: number };
    }) => deliveryApi.verifyDelivery(stopId, code, coords),
    onSuccess: invalidate,
  });
}

export function useOverrideDeliver() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: ({ stopId, note }: { stopId: number; note: string }) =>
      deliveryApi.overrideDeliver(stopId, note),
    onSuccess: invalidate,
  });
}

export function useFailStop() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: ({ stopId, reason }: { stopId: number; reason: string }) =>
      deliveryApi.failDeliveryStop(stopId, reason),
    onSuccess: invalidate,
  });
}

export function useUploadStopPhoto() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: ({ stopId, file }: { stopId: number; file: File }) =>
      deliveryApi.uploadStopPhoto(stopId, file),
    onSuccess: invalidate,
  });
}

export function useScanDeliveryLabel() {
  return useMutation({
    mutationFn: (payload: string) => deliveryApi.scanDeliveryLabel(payload),
  });
}

/* ── Canlı takip (Faz C) ── */

/** Admin rota haritası: kuryenin son konumu (yalnız aktif turda poll'lanır). */
export function useRunPosition(runId: number | null, active: boolean) {
  return useQuery({
    queryKey: [...KEY, "position", runId],
    queryFn: () => deliveryApi.fetchRunPosition(runId!),
    enabled: runId != null && active,
    refetchInterval: 10_000,
  });
}

/** Müşteri: sipariş canlı takibi — dağıtımda 15 sn'de bir tazelenir. */
export function useOrderTracking(orderId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["orderTracking", orderId],
    queryFn: () => deliveryApi.fetchOrderTracking(orderId!),
    enabled: orderId != null && enabled,
    refetchInterval: (query) =>
      query.state.data?.status === "EN_ROUTE" ? 15_000 : false,
  });
}

/** Oturumsuz kargo takibi (SMS token'ı) — dağıtımda 15 sn'de bir tazelenir. */
export function usePublicOrderTracking(token: string | null) {
  return useQuery({
    queryKey: ["publicOrderTracking", token],
    queryFn: () => deliveryApi.fetchPublicOrderTracking(token!),
    enabled: !!token,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "EN_ROUTE" ? 15_000 : false,
  });
}
