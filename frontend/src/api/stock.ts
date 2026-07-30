import { apiClient } from "@/api/axios";

import type { StockMovementType } from "@/lib/stockMovements";

/** Defter satırının admin görünümü.
 *
 * `idempotency_key` bilinçli olarak YOK: operatöre bir şey anlatmıyor ve
 * içinde sipariş/iade kimlikleri taşıyor. */
export interface StockMovementOut {
  id: number;
  product_id: number;
  sku: string;
  product_title: string;
  qty_delta: number;
  qty_after: number;
  movement_type: StockMovementType;
  reason_code: string;
  ref_type: string | null;
  ref_id: number | null;
  ref_line_id: number | null;
  actor_type: string;
  actor_id: number | null;
  note: string | null;
  created_at: string;
}

export interface StockMovementPageOut {
  rows: StockMovementOut[];
  total: number;
  limit: number;
  offset: number;
}

export interface LedgerProblemOut {
  code: string;
  message: string;
  product_id: number;
  sku: string | null;
  movement_id: number | null;
  expected: number | null;
  actual: number | null;
}

export interface LedgerVerificationOut {
  consistent: boolean;
  product_id: number;
  sku: string | null;
  product_title: string | null;
  current_stock: number | null;
  ledger_stock: number | null;
  movement_count: number;
  first_divergent_id: number | null;
  problems: LedgerProblemOut[];
  /** `false` → dijital ürün; stok defteri TUTULMAZ ("sorun yok" ile karıştırma). */
  tracked: boolean;
}

export interface LedgerAuditOut {
  checked: number;
  inconsistent: number;
  problems: LedgerProblemOut[];
  /** `null` ise defterin sonuna gelindi. */
  next_offset: number | null;
  limit: number;
  offset: number;
}

export interface MovementFilters {
  limit?: number;
  offset?: number;
  product_id?: number;
  sku?: string;
  movement_type?: string;
  reason_code?: string;
  actor_type?: string;
  actor_id?: number;
  ref_type?: string;
  ref_id?: number;
  date_from?: string;
  date_to?: string;
}

function temizle(f: MovementFilters): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && v !== null),
  );
}

export async function fetchProductStockMovements(
  productId: number,
  filters: MovementFilters = {},
): Promise<StockMovementPageOut> {
  const { data } = await apiClient.get<StockMovementPageOut>(
    `/store/admin/products/${productId}/stock-movements`,
    { params: temizle(filters) },
  );
  return data;
}

export async function fetchStockMovements(
  filters: MovementFilters = {},
): Promise<StockMovementPageOut> {
  const { data } = await apiClient.get<StockMovementPageOut>(
    "/store/admin/stock-movements",
    { params: temizle(filters) },
  );
  return data;
}

export async function fetchProductStockVerify(
  productId: number,
): Promise<LedgerVerificationOut> {
  const { data } = await apiClient.get<LedgerVerificationOut>(
    `/store/admin/products/${productId}/stock-verify`,
  );
  return data;
}

export async function fetchLedgerAudit(
  params: { limit?: number; offset?: number } = {},
): Promise<LedgerAuditOut> {
  const { data } = await apiClient.get<LedgerAuditOut>("/store/admin/stock-verify", {
    params: temizle(params),
  });
  return data;
}
