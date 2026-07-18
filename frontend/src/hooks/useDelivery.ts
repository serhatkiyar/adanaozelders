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

/** İstisna kuyruğu — deneme hakkı dolmuş, karar bekleyen siparişler (ADMIN). */
export function useAttentionOrders(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "attention"],
    queryFn: deliveryApi.fetchAttentionOrders,
    enabled,
  });
}

/** Deneme hakkı dolmuş siparişe bir tur daha hak tanı. */
export function useRetryExhausted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) => deliveryApi.retryExhaustedOrder(orderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Hazırlama istasyonu kuyruğu — henüz hazırlanmamış siparişler (ADMIN). */
export function usePrepQueue(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "prep-queue"],
    queryFn: deliveryApi.fetchPrepQueue,
    enabled,
  });
}

/** Sipariş hazır/hazır-değil işaretle. eligible + prep-queue + kapasite tazelenir. */
export function useMarkPrepared() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, prepared }: { orderId: number; prepared: boolean }) =>
      prepared
        ? deliveryApi.markOrderPrepared(orderId)
        : deliveryApi.unmarkOrderPrepared(orderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/* ── Kurye workspace + hesap yaşam döngüsü ── */

/** Kurye açılış ekranı — güncel tur değişebilir, 20 sn'de bir tazele. */
export function useCourierWorkspace(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "me"],
    queryFn: deliveryApi.fetchCourierWorkspace,
    enabled,
    refetchInterval: 20_000,
  });
}

export function useCourierAccount(courierId: number | null) {
  return useQuery({
    queryKey: [...KEY, "account", courierId],
    queryFn: () => deliveryApi.fetchCourierAccount(courierId!),
    enabled: courierId != null,
  });
}

export function useCreateCourierAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      courierId,
      ...payload
    }: {
      courierId: number;
      email: string;
      password: string;
      first_name: string;
      last_name: string;
    }) => deliveryApi.createCourierAccount(courierId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCloseCourierAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) => deliveryApi.closeCourierAccount(accountId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useResetCourierPassword() {
  return useMutation({
    mutationFn: ({ accountId, newPassword }: { accountId: number; newPassword: string }) =>
      deliveryApi.resetCourierPassword(accountId, newPassword),
  });
}

/* ── Teslimat takvimi (kapalı günler) ── */

export function useClosedDays(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "calendar"],
    queryFn: deliveryApi.fetchClosedDays,
    enabled,
  });
}

function useInvalidateCalendar() {
  const qc = useQueryClient();
  // Takvim değişince kapasite şeridi/söz de tazelenmeli (kapalı gün söze etki eder).
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useAddClosedDay() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ day, label }: { day: string; label?: string }) =>
      deliveryApi.addClosedDay(day, label),
    onSuccess: invalidate,
  });
}

export function useRemoveClosedDay() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (id: number) => deliveryApi.removeClosedDay(id),
    onSuccess: invalidate,
  });
}

export function useSeedHolidays() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (year: number) => deliveryApi.seedHolidays(year),
    onSuccess: invalidate,
  });
}

/** Teslimat KPI özeti — söz tutma / ilk denemede teslim / neden dağılımı (ADMIN). */
export function useDeliveryKpi(days = 30) {
  return useQuery({
    queryKey: [...KEY, "kpi", days],
    queryFn: () => deliveryApi.fetchDeliveryKpi(days),
    staleTime: 60_000,
  });
}

export function useRecentDeliveryFeedback(limit = 50) {
  return useQuery({
    queryKey: [...KEY, "feedback", limit],
    queryFn: () => deliveryApi.fetchRecentDeliveryFeedback(limit),
  });
}

/** Admin kapasite şeridi — önümüzdeki günlerin söz doluluğu. Dakikada bir tazelenir. */
export function useCapacityOverview(days = 14) {
  return useQuery({
    queryKey: [...KEY, "capacity", days],
    queryFn: () => deliveryApi.fetchCapacityOverview(days),
    staleTime: 60_000,
    refetchInterval: 60_000,
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

export function useDispatchDay() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: (runDate: string) => deliveryApi.dispatchDay(runDate),
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
    mutationFn: ({
      stopId,
      reason,
      reasonCode,
    }: {
      stopId: number;
      reason: string;
      reasonCode: string;
    }) => deliveryApi.failDeliveryStop(stopId, reason, reasonCode),
    onSuccess: invalidate,
  });
}

export function useDeliverDrop() {
  const invalidate = useInvalidateDelivery();
  return useMutation({
    mutationFn: (stopId: number) => deliveryApi.deliverDrop(stopId),
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

export function useDeliveryFeedback(orderId: number | null) {
  return useQuery({
    queryKey: ["deliveryFeedback", orderId],
    queryFn: () => deliveryApi.fetchDeliveryFeedback(orderId!),
    enabled: orderId != null,
  });
}

type FeedbackTarget =
  | { mode: "order"; orderId: number }
  | { mode: "token"; token: string };

export function useSubmitDeliveryFeedback(target: FeedbackTarget) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: deliveryApi.DeliveryFeedbackPayload) =>
      target.mode === "order"
        ? deliveryApi.submitDeliveryFeedback(target.orderId, payload)
        : deliveryApi.submitPublicDeliveryFeedback(target.token, payload),
    onSuccess: (feedback) => {
      qc.invalidateQueries({ queryKey: ["orderTracking"] });
      qc.invalidateQueries({ queryKey: ["publicOrderTracking"] });
      qc.invalidateQueries({ queryKey: ["deliveryFeedback", feedback.order_id] });
      qc.invalidateQueries({ queryKey: [...KEY, "feedback"] });
      qc.invalidateQueries({ queryKey: [...KEY, "kpi"] });
    },
  });
}

/* ── Teslimat self-servisi (tercih / erteleme / adres) ── */

function useInvalidateOrders() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["store", "orders"] });
    qc.invalidateQueries({ queryKey: ["orderTracking"] });
    qc.invalidateQueries({ queryKey: ["publicOrderTracking"] });
  };
}

export function useChangeShipAddress() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({
      orderId,
      addressId,
      force,
    }: {
      orderId: number;
      addressId: number;
      force?: boolean;
    }) => deliveryApi.changeShipAddress(orderId, addressId, force),
    onSuccess: invalidate,
  });
}

export function usePublicSetDeliveryPref() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({
      token,
      pref,
      note,
    }: {
      token: string;
      pref: import("@/types").DeliveryPref;
      note?: string | null;
    }) => deliveryApi.publicSetDeliveryPref(token, pref, note),
    onSuccess: invalidate,
  });
}

export function usePublicPostpone() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: (token: string) => deliveryApi.publicPostpone(token),
    onSuccess: invalidate,
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
