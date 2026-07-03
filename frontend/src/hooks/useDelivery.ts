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

export function useScanDeliveryLabel() {
  return useMutation({
    mutationFn: (payload: string) => deliveryApi.scanDeliveryLabel(payload),
  });
}
