// F29 envanter uçları — ADMIN. `api/stock.ts` deseni.
//
// Backend sözleşmesi `backend/schemas/inventory.py`; alanlar birebir eşleşir.
// Parasal alan YOKTUR ve eklenmemelidir.
import { apiClient } from "@/api/axios";

import type {
  Bucket,
  CountLineStatus,
  CountScope,
  CountSessionStatus,
  DamageKind,
  DamageReason,
} from "@/lib/inventory";

export interface CountLineOut {
  id: number;
  /** Teknik kimlik — destekleyici bilgi, ana metin degil. */
  product_id: number;
  /** Urunun okunabilir adi. Eski sunucu surumunde gelmeyebilir. */
  product_name?: string | null;
  /** Stok kalemi kimligi. Eski sunucu surumunde gelmeyebilir. */
  product_sku?: string | null;
  bucket: Bucket;
  status: CountLineStatus;
  system_qty_snapshot: number;
  reserved_qty_snapshot: number | null;
  counted_qty: number | null;
  /** Sunucuda TÜRETİLİR; istemci de aynı formülü bilir (`lineDifference`). */
  difference: number | null;
  counted_at: string | null;
  counted_by_admin_id: number | null;
  stale_reason: string | null;
  resolved_by_admin_id: number | null;
  resolved_at: string | null;
  resolution_note: string | null;
  note: string | null;
  applied_movement_id: number | null;
}

export interface CountSessionOut {
  id: number;
  code: string;
  status: CountSessionStatus;
  scope: CountScope;
  category_id: number | null;
  note: string | null;
  created_by_admin_id: number;
  created_at: string;
  started_at: string | null;
  submitted_at: string | null;
  reviewed_by_admin_id: number | null;
  reviewed_at: string | null;
  applied_by_admin_id: number | null;
  applied_at: string | null;
  cancelled_by_admin_id: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  /** Turetilmis ozet — sunucuda toplu sorguyla hesaplanir. Eski sunucu
   *  surumunde YOK; istemci bu durumda sayi UYDURMAZ. */
  line_count?: number;
  uncounted_line_count?: number;
  has_stale?: boolean;
}

export interface CountSessionDetailOut extends CountSessionOut {
  lines: CountLineOut[];
}

export interface CountSessionPage {
  items: CountSessionOut[];
  total: number;
  limit: number;
  offset: number;
}

export interface DamageEventOut {
  id: number;
  product_id: number;
  kind: DamageKind;
  qty: number;
  source_bucket: Bucket;
  reason_code: string;
  note: string | null;
  actor_admin_id: number;
  created_at: string;
  idempotency_key: string | null;
}

export interface DamageEventPage {
  items: DamageEventOut[];
  total: number;
  limit: number;
  offset: number;
}

export interface OnPremiseOut {
  product_id: number;
  saleable: number;
  damaged: number;
  reserved: number;
  total: number;
}

export interface SessionListParams {
  status?: CountSessionStatus | "";
  limit: number;
  offset: number;
}

/** Boş filtre query'ye KONMAZ: `status=` sunucuda boş dizgi araması olurdu. */
function temizle(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== null)
  );
}

export async function fetchCountSessions(params: SessionListParams): Promise<CountSessionPage> {
  const { data } = await apiClient.get<CountSessionPage>("/inventory/count-sessions", {
    params: temizle(params as unknown as Record<string, unknown>),
  });
  return data;
}

export async function fetchCountSession(id: number): Promise<CountSessionDetailOut> {
  const { data } = await apiClient.get<CountSessionDetailOut>(`/inventory/count-sessions/${id}`);
  return data;
}

export interface CreateSessionPayload {
  scope: CountScope;
  product_ids?: number[];
  category_id?: number | null;
  note?: string | null;
}

export async function createCountSession(
  payload: CreateSessionPayload
): Promise<CountSessionDetailOut> {
  const { data } = await apiClient.post<CountSessionDetailOut>(
    "/inventory/count-sessions",
    temizle(payload as unknown as Record<string, unknown>)
  );
  return data;
}

export async function addCountProducts(
  id: number,
  productIds: number[]
): Promise<CountSessionDetailOut> {
  const { data } = await apiClient.post<CountSessionDetailOut>(
    `/inventory/count-sessions/${id}/products`,
    { product_ids: productIds }
  );
  return data;
}

/** `counted_at` GÖNDERİLMEZ — sunucu zamanı uzlaştırmanın güven kaynağıdır. */
export async function setLineCount(
  sessionId: number,
  lineId: number,
  countedQty: number
): Promise<CountLineOut> {
  const { data } = await apiClient.post<CountLineOut>(
    `/inventory/count-sessions/${sessionId}/lines/${lineId}/count`,
    { counted_qty: countedQty }
  );
  return data;
}

export async function resolveCountLine(
  sessionId: number,
  lineId: number,
  note: string
): Promise<CountLineOut> {
  const { data } = await apiClient.post<CountLineOut>(
    `/inventory/count-sessions/${sessionId}/lines/${lineId}/resolve`,
    { note }
  );
  return data;
}

export type SessionAction = "start" | "submit" | "reopen";

export async function countSessionAction(
  id: number,
  action: SessionAction
): Promise<CountSessionDetailOut> {
  const { data } = await apiClient.post<CountSessionDetailOut>(
    `/inventory/count-sessions/${id}/${action}`
  );
  return data;
}

export async function applyCountSession(
  id: number,
  idempotencyKey: string
): Promise<CountSessionDetailOut> {
  const { data } = await apiClient.post<CountSessionDetailOut>(
    `/inventory/count-sessions/${id}/apply`,
    { idempotency_key: idempotencyKey }
  );
  return data;
}

export async function cancelCountSession(
  id: number,
  reason: string
): Promise<CountSessionDetailOut> {
  const { data } = await apiClient.post<CountSessionDetailOut>(
    `/inventory/count-sessions/${id}/cancel`,
    { reason }
  );
  return data;
}

export interface DamageListParams {
  product_id?: number;
  limit: number;
  offset: number;
}

export async function fetchDamageEvents(params: DamageListParams): Promise<DamageEventPage> {
  const { data } = await apiClient.get<DamageEventPage>("/inventory/damage-events", {
    params: temizle(params as unknown as Record<string, unknown>),
  });
  return data;
}

export interface DamagePayload {
  product_id: number;
  kind: DamageKind;
  qty: number;
  reason_code: DamageReason;
  note: string | null;
  idempotency_key: string;
  bucket?: Bucket;
}

export interface DamageResult {
  event: DamageEventOut;
  /**
   * Sunucu 201 ile YENİ iş, 200 ile REPLAY bildirir. Arayüz ikisini aynı
   * "başarıyla oluşturuldu" mesajıyla gösterirse operatör olmayan bir işi
   * yapılmış sanır.
   */
  replayed: boolean;
}

export async function createDamageEvent(payload: DamagePayload): Promise<DamageResult> {
  const response = await apiClient.post<DamageEventOut>("/inventory/damage-events", payload);
  return { event: response.data, replayed: response.status === 200 };
}

export async function fetchOnPremise(productId: number): Promise<OnPremiseOut> {
  const { data } = await apiClient.get<OnPremiseOut>(
    `/inventory/products/${productId}/on-premise`
  );
  return data;
}
