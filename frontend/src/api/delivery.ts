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
  CapacityDay,
  ClosedDay,
  DeliveryFeedback,
  DeliveryKpi,
  OrderOut,
  OrderTracking,
} from "@/types";

export interface DeliveryFeedbackPayload {
  thumbs_up: boolean;
  problem_codes: string[];
  comment?: string | null;
}

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

/** Hazırlama istasyonu kuyruğu — henüz toplanmamış/etiketlenmemiş siparişler (ADMIN). */
export async function fetchPrepQueue(): Promise<DeliveryEligibleOrder[]> {
  const { data } = await apiClient.get<DeliveryEligibleOrder[]>("/delivery/prep-queue");
  return data;
}

/** İstisna kuyruğu — deneme hakkı dolmuş, operatör kararı bekleyen siparişler (ADMIN). */
export async function fetchAttentionOrders(): Promise<DeliveryEligibleOrder[]> {
  const { data } = await apiClient.get<DeliveryEligibleOrder[]>(
    "/delivery/attention-orders"
  );
  return data;
}

/** Deneme hakkı dolmuş siparişe bir tur daha hak tanı (müşteriyle görüşüldü). */
export async function retryExhaustedOrder(
  orderId: number
): Promise<DeliveryEligibleOrder> {
  const { data } = await apiClient.post<DeliveryEligibleOrder>(
    `/delivery/orders/${orderId}/retry`
  );
  return data;
}

/*
 * KALDIRILDI (F30 commit 5): `markOrderPrepared` / `unmarkOrderPrepared`.
 *
 * `POST /delivery/orders/{id}/prepare` ve `/unprepare` uçları backend'den
 * silindi (sözleşme §3.5, boşluk G1): elle "Hazır" butonu, kalem kalem
 * doğrulanmamış bir paketi dağıtım kuyruğuna sokabiliyordu. Hazırlama artık
 * yalnız paketleme istasyonundan geçer (paket aç → tara → tamamla):
 * `/yonetim/paketleme` — istemci katmanı `src/api/packing.ts`. İstemcide çağrı
 * bırakmak, uç yokken 404 üreten ölü bir buton demekti.
 */

/* ── Kurye workspace (rol 5) ── */

export interface CourierWorkspace {
  account: {
    id: number;
    email: string;
    username: string;
    first_name: string;
    last_name: string;
    is_active: boolean;
    courier_id: number;
    created_at: string;
  };
  courier: { id: number; name: string; photo_url?: string | null; vehicle_plate?: string | null } | null;
  run: DeliveryRun | null;
}

/** Kurye açılış ekranı: hesabım + profilim + güncel turum (yoksa null). */
export async function fetchCourierWorkspace(): Promise<CourierWorkspace> {
  const { data } = await apiClient.get<CourierWorkspace>("/delivery/me");
  return data;
}

/* ── Kurye hesabı yaşam döngüsü (ADMIN) ── */

export interface CourierAccountInfo {
  id: number;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  courier_id: number;
  created_at: string;
}

export async function fetchCourierAccount(
  courierId: number
): Promise<CourierAccountInfo | null> {
  const { data } = await apiClient.get<CourierAccountInfo | null>(
    `/delivery/couriers/${courierId}/account`
  );
  return data;
}

export async function createCourierAccount(
  courierId: number,
  payload: { email: string; password: string; first_name: string; last_name: string }
): Promise<CourierAccountInfo> {
  const { data } = await apiClient.post<CourierAccountInfo>(
    `/delivery/couriers/${courierId}/account`,
    payload
  );
  return data;
}

export async function closeCourierAccount(accountId: number): Promise<void> {
  await apiClient.post(`/delivery/accounts/${accountId}/close`);
}

export async function resetCourierPassword(
  accountId: number,
  newPassword: string
): Promise<void> {
  await apiClient.post(`/delivery/accounts/${accountId}/reset-password`, {
    new_password: newPassword,
  });
}

/* ── Teslimat takvimi (kapalı günler) ── */

export async function fetchClosedDays(): Promise<ClosedDay[]> {
  const { data } = await apiClient.get<ClosedDay[]>("/delivery/calendar");
  return data;
}

export async function addClosedDay(day: string, label?: string): Promise<ClosedDay> {
  const { data } = await apiClient.post<ClosedDay>("/delivery/calendar", { day, label });
  return data;
}

export async function removeClosedDay(id: number): Promise<void> {
  await apiClient.delete(`/delivery/calendar/${id}`);
}

export async function seedHolidays(year = 2026): Promise<ClosedDay[]> {
  const { data } = await apiClient.post<ClosedDay[]>(
    "/delivery/calendar/seed-holidays",
    null,
    { params: { year } }
  );
  return data;
}

/** Teslimat KPI özeti — söz tutma / ilk denemede teslim / başarısızlık nedenleri. */
export async function fetchDeliveryKpi(days = 30): Promise<DeliveryKpi> {
  const { data } = await apiClient.get<DeliveryKpi>("/delivery/kpi", {
    params: { days },
  });
  return data;
}

/** Admin: en yeni teslimat değerlendirmeleri. */
export async function fetchRecentDeliveryFeedback(limit = 50): Promise<DeliveryFeedback[]> {
  const { data } = await apiClient.get<DeliveryFeedback[]>("/delivery/feedback", {
    params: { limit },
  });
  return data;
}

/** Önümüzdeki günlerin söz doluluğu — admin kapasite şeridi (booked/capacity + söz borcu). */
export async function fetchCapacityOverview(days = 14): Promise<CapacityDay[]> {
  const { data } = await apiClient.get<CapacityDay[]>("/delivery/capacity", {
    params: { days },
  });
  return data;
}

/** Public teslimat sözü ("şimdi sipariş verirsen ne zaman gelir") — sunucu saati esas. */
export async function fetchDeliveryInfo(): Promise<DeliveryInfo> {
  const { data } = await apiClient.get<DeliveryInfo>("/store/delivery-info");
  return data;
}

export async function fetchDeliveryRuns(
  runDate?: string,
  opts?: { limit?: number; offset?: number }
): Promise<DeliveryRun[]> {
  const { data } = await apiClient.get<DeliveryRun[]>("/delivery/runs", {
    params: {
      ...(runDate ? { run_date: runDate } : {}),
      ...(opts?.limit != null ? { limit: opts.limit } : {}),
      ...(opts?.offset != null ? { offset: opts.offset } : {}),
    },
  });
  return data;
}

/** Rota altyapısı (VROOM+OSRM) sağlık durumu — /health kök uçtadır (/api/v1
 * DIŞINDA): baseURL'den API öneki soyulur. `degraded=true` iken optimize
 * "yaklaşık" modda çalışır; panel bunu amber şeritle gösterir. */
export interface RoutingHealth {
  provider: string;
  status: string;
  degraded: boolean;
  detail?: string;
}

export async function fetchRoutingHealth(): Promise<RoutingHealth> {
  const base = (apiClient.defaults.baseURL ?? "").replace(/\/api\/v1\/?$/, "");
  const { data } = await apiClient.get<{ routing?: RoutingHealth }>("/health", {
    baseURL: base,
  });
  return data.routing ?? { provider: "auto", status: "unknown", degraded: false };
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

/** Günü Optimize Et: uygun siparişleri araçlara bölüştürüp optimize turlar kurar. */
export async function dispatchDay(runDate: string): Promise<DeliveryRun[]> {
  const { data } = await apiClient.post<DeliveryRun[]>("/delivery/dispatch-day", {
    run_date: runDate,
  });
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

export async function submitDeliveryFeedback(
  orderId: number,
  payload: DeliveryFeedbackPayload,
): Promise<DeliveryFeedback> {
  const { data } = await apiClient.post<DeliveryFeedback>(
    `/store/orders/${orderId}/feedback`,
    payload,
  );
  return data;
}

export async function submitPublicDeliveryFeedback(
  token: string,
  payload: DeliveryFeedbackPayload,
): Promise<DeliveryFeedback> {
  const { data } = await apiClient.post<DeliveryFeedback>(
    `/store/orders/track/${token}/feedback`,
    payload,
  );
  return data;
}

export async function fetchDeliveryFeedback(orderId: number): Promise<DeliveryFeedback | null> {
  const { data } = await apiClient.get<DeliveryFeedback | null>(
    `/store/orders/${orderId}/feedback`,
  );
  return data;
}

/* ── Teslimat self-servisi (adres) ── */

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

/** Oturumlu (sipariş sahibi) teslimat tercihi — tüm pref değerleri serbest
 * (public token'da KAPIYA/KOMSUYA 403'tür; oturumda güven daha yüksek). */
export async function setOrderDeliveryPref(
  orderId: number,
  pref: DeliveryPref,
  note?: string | null
): Promise<void> {
  await apiClient.post(`/store/orders/${orderId}/delivery-pref`, {
    pref,
    note: note ?? null,
  });
}

/** Oturumlu erteleme — söz günü ertesi çalışma gününe kayar (limit 2). */
export async function postponeOrder(orderId: number): Promise<void> {
  await apiClient.post(`/store/orders/${orderId}/postpone`);
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
  reason: string,
  reasonCode: string
): Promise<DeliveryStop> {
  const { data } = await apiClient.post<DeliveryStop>(`/delivery/stops/${stopId}/fail`, {
    reason,
    reason_code: reasonCode,
  });
  return data;
}
