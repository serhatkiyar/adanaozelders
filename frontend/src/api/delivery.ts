import { apiClient } from "@/api/axios";
import type {
  DeliveryEligibleOrder,
  DeliveryRun,
  DeliveryScanResult,
  DeliveryStop,
  DeliveryVehicle,
} from "@/types";

export async function fetchEligibleOrders(): Promise<DeliveryEligibleOrder[]> {
  const { data } = await apiClient.get<DeliveryEligibleOrder[]>(
    "/delivery/eligible-orders"
  );
  return data;
}

export async function fetchDeliveryRuns(runDate?: string): Promise<DeliveryRun[]> {
  const { data } = await apiClient.get<DeliveryRun[]>("/delivery/runs", {
    params: runDate ? { run_date: runDate } : undefined,
  });
  return data;
}

export async function fetchDeliveryRun(runId: number): Promise<DeliveryRun> {
  const { data } = await apiClient.get<DeliveryRun>(`/delivery/runs/${runId}`);
  return data;
}

export async function createDeliveryRun(payload: {
  run_date: string;
  vehicle: DeliveryVehicle;
  notes?: string | null;
}): Promise<DeliveryRun> {
  const { data } = await apiClient.post<DeliveryRun>("/delivery/runs", payload);
  return data;
}

export async function addDeliveryStops(
  runId: number,
  orderIds: number[]
): Promise<DeliveryRun> {
  const { data } = await apiClient.post<DeliveryRun>(`/delivery/runs/${runId}/stops`, {
    order_ids: orderIds,
  });
  return data;
}

export async function reorderDeliveryStops(
  runId: number,
  stopIds: number[]
): Promise<DeliveryRun> {
  const { data } = await apiClient.put<DeliveryRun>(`/delivery/runs/${runId}/reorder`, {
    stop_ids: stopIds,
  });
  return data;
}

export async function optimizeDeliveryRun(runId: number): Promise<DeliveryRun> {
  const { data } = await apiClient.post<DeliveryRun>(`/delivery/runs/${runId}/optimize`);
  return data;
}

export async function startDeliveryRun(runId: number): Promise<DeliveryRun> {
  const { data } = await apiClient.post<DeliveryRun>(`/delivery/runs/${runId}/start`);
  return data;
}

export async function completeDeliveryRun(runId: number): Promise<DeliveryRun> {
  const { data } = await apiClient.post<DeliveryRun>(`/delivery/runs/${runId}/complete`);
  return data;
}

export async function cancelDeliveryRun(runId: number): Promise<DeliveryRun> {
  const { data } = await apiClient.post<DeliveryRun>(`/delivery/runs/${runId}/cancel`);
  return data;
}

export async function removeDeliveryStop(stopId: number): Promise<DeliveryRun> {
  const { data } = await apiClient.delete<DeliveryRun>(`/delivery/stops/${stopId}`);
  return data;
}

export async function scanDeliveryLabel(payload: string): Promise<DeliveryScanResult> {
  const { data } = await apiClient.post<DeliveryScanResult>("/delivery/scan", {
    payload,
  });
  return data;
}

export async function sendDeliveryOtp(
  stopId: number
): Promise<{ masked_phone: string; sent: boolean }> {
  const { data } = await apiClient.post<{ masked_phone: string; sent: boolean }>(
    `/delivery/stops/${stopId}/send-otp`
  );
  return data;
}

export async function verifyDelivery(
  stopId: number,
  code: string,
  coords?: { lat: number; lng: number }
): Promise<DeliveryStop> {
  const { data } = await apiClient.post<DeliveryStop>(
    `/delivery/stops/${stopId}/verify`,
    { code, lat: coords?.lat ?? null, lng: coords?.lng ?? null }
  );
  return data;
}

export async function overrideDeliver(
  stopId: number,
  note: string
): Promise<DeliveryStop> {
  const { data } = await apiClient.post<DeliveryStop>(
    `/delivery/stops/${stopId}/override-deliver`,
    { note }
  );
  return data;
}

export async function failDeliveryStop(
  stopId: number,
  reason: string
): Promise<DeliveryStop> {
  const { data } = await apiClient.post<DeliveryStop>(`/delivery/stops/${stopId}/fail`, {
    reason,
  });
  return data;
}
