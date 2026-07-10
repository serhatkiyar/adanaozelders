import { apiClient } from "@/api/axios";
import type {
  Courier,
  CourierCreate,
  CourierPosition,
  CourierUpdate,
  DeliveryEligibleOrder,
  DeliveryInfo,
  DeliveryPref,
  DeliveryRun,
  DeliveryScanResult,
  DeliveryStop,
  DeliveryVehicle,
  OrderOut,
  OrderTracking,
} from "@/types";

export async function fetchEligibleOrders(): Promise<DeliveryEligibleOrder[]> {
  const { data } = await apiClient.get<DeliveryEligibleOrder[]>(
    "/delivery/eligible-orders"
  );
  return data;
}

/** Bölge dışı ödenmiş fiziksel siparişler — "dış kargo bekliyor" kuyruğu (ADMIN). */
export async function fetchOutsourcedOrders(): Promise<DeliveryEligibleOrder[]> {
  const { data } = await apiClient.get<DeliveryEligibleOrder[]>(
    "/delivery/outsourced-orders"
  );
  return data;
}

/** Public teslimat sözü ("şimdi sipariş verirsen ne zaman gelir") — sunucu saati esas. */
export async function fetchDeliveryInfo(): Promise<DeliveryInfo> {
  const { data } = await apiClient.get<DeliveryInfo>("/store/delivery-info");
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
  courier_id?: number | null;
}): Promise<DeliveryRun> {
  const { data } = await apiClient.post<DeliveryRun>("/delivery/runs", payload);
  return data;
}

/** Tur meta güncellemesi (kurye ataması). */
export async function updateDeliveryRun(
  runId: number,
  payload: { courier_id?: number | null }
): Promise<DeliveryRun> {
  const { data } = await apiClient.patch<DeliveryRun>(`/delivery/runs/${runId}`, payload);
  return data;
}

/* ── Kurye profilleri (ADMIN) ── */

export async function fetchCouriers(): Promise<Courier[]> {
  const { data } = await apiClient.get<Courier[]>("/delivery/couriers");
  return data;
}

export async function createCourier(payload: CourierCreate): Promise<Courier> {
  const { data } = await apiClient.post<Courier>("/delivery/couriers", payload);
  return data;
}

export async function updateCourier(
  courierId: number,
  payload: CourierUpdate
): Promise<Courier> {
  const { data } = await apiClient.patch<Courier>(
    `/delivery/couriers/${courierId}`,
    payload
  );
  return data;
}

export async function deleteCourier(courierId: number): Promise<void> {
  await apiClient.delete(`/delivery/couriers/${courierId}`);
}

export async function uploadCourierPhoto(
  courierId: number,
  file: File
): Promise<Courier> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<Courier>(
    `/delivery/couriers/${courierId}/photo`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
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

/** Dağıtıcı telefonunun konum ping'i (sessiz — takip akışı UI'ı bozmasın). */
export async function trackDeliveryRun(
  runId: number,
  lat: number,
  lng: number
): Promise<void> {
  await apiClient.post(`/delivery/runs/${runId}/track`, { lat, lng });
}

export async function fetchRunPosition(runId: number): Promise<CourierPosition> {
  const { data } = await apiClient.get<CourierPosition>(
    `/delivery/runs/${runId}/position`
  );
  return data;
}

/** Müşteri: sipariş canlı takibi. */
export async function fetchOrderTracking(orderId: number): Promise<OrderTracking> {
  const { data } = await apiClient.get<OrderTracking>(
    `/store/orders/${orderId}/tracking`
  );
  return data;
}

/** Oturumsuz kargo takibi (SMS'le paylaşılan token). JWT gerektirmez. */
export async function fetchPublicOrderTracking(token: string): Promise<OrderTracking> {
  const { data } = await apiClient.get<OrderTracking>(
    `/store/orders/track/${token}`
  );
  return data;
}

/* ── Teslimat self-servisi (tercih / erteleme / adres) ── */

export async function setDeliveryPref(
  orderId: number,
  pref: DeliveryPref,
  note?: string | null
): Promise<OrderOut> {
  const { data } = await apiClient.post<OrderOut>(
    `/store/orders/${orderId}/delivery-pref`,
    { pref, note: note ?? null }
  );
  return data;
}

export async function postponeOrder(orderId: number): Promise<OrderOut> {
  const { data } = await apiClient.post<OrderOut>(`/store/orders/${orderId}/postpone`);
  return data;
}

export async function changeShipAddress(
  orderId: number,
  addressId: number,
  force = false
): Promise<OrderOut> {
  const { data } = await apiClient.post<OrderOut>(
    `/store/orders/${orderId}/ship-address`,
    { address_id: addressId, force }
  );
  return data;
}

/** Oturumsuz (token'lı) tercih — takip sayfasından; adres değişikliği YOK. */
export async function publicSetDeliveryPref(
  token: string,
  pref: DeliveryPref,
  note?: string | null
): Promise<void> {
  await apiClient.post(`/store/orders/track/${token}/delivery-pref`, {
    pref,
    note: note ?? null,
  });
}

export async function publicPostpone(token: string): Promise<void> {
  await apiClient.post(`/store/orders/track/${token}/postpone`);
}

/** Teslim kanıtı fotoğrafı (PoD) — yeniden çekimde eskisinin yerine geçer. */
export async function uploadStopPhoto(
  stopId: number,
  file: File
): Promise<DeliveryStop> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<DeliveryStop>(
    `/delivery/stops/${stopId}/photo`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return data;
}

/** Kapıya/komşuya bırakma teslimi — müşteri talimatlıysa, foto kanıt zorunlu. */
export async function deliverDrop(stopId: number): Promise<DeliveryStop> {
  const { data } = await apiClient.post<DeliveryStop>(
    `/delivery/stops/${stopId}/deliver-drop`
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
