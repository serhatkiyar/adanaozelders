import { apiClient } from "@/api/axios";
import type { PaymentAvailability, BranchStatus } from "@/lib/paymentAvailability";

export interface FeatureFlagOut {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  /** Katalog varsayılanı — "fabrika ayarı neydi". */
  default: boolean;
  /** Kod bu bayrağı fiilen uyguluyor mu (false ise panelde "henüz uygulanmıyor"). */
  enforced: boolean;
  updated_at?: string | null;
  updated_by_admin_id?: number | null;
  note?: string | null;
  /** Doluysa bayrak bu ortamda değiştirilemez; metin sebebi söyler. */
  locked_reason?: string | null;
}

/**
 * Hangi ödeme kolları açık — **public** uç. Teşhis alanları dönmez.
 *
 * Anonim ziyaretçi de ürün sayfasında doğru metni görmeli, bu yüzden
 * kimlik doğrulaması gerektirmiyor.
 */
export async function fetchPaymentAvailability(): Promise<PaymentAvailability> {
  const { data } = await apiClient.get<PaymentAvailability>("/payments/availability");
  return data;
}

// ── Admin ──

export async function fetchFeatureFlags(): Promise<FeatureFlagOut[]> {
  const { data } = await apiClient.get<FeatureFlagOut[]>("/admin/feature-flags");
  return data;
}

export async function updateFeatureFlag(
  key: string,
  payload: { enabled: boolean; note?: string | null },
): Promise<FeatureFlagOut> {
  const { data } = await apiClient.put<FeatureFlagOut>(`/admin/feature-flags/${key}`, payload);
  return data;
}

/** Kol bazlı durum + engelleyiciler (yalnız admin yüzeyi). */
export async function fetchPaymentBranches(): Promise<BranchStatus[]> {
  const { data } = await apiClient.get<BranchStatus[]>("/admin/payment-branches");
  return data;
}
