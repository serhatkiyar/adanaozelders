import { apiClient } from "@/api/axios";

/** Bir alıcının (eğitmen/kütüphane) hakediş durumu. */
export interface PayeeBalance {
  payee_type: "TUTOR" | "LIBRARY";
  payee_id: number;
  name: string;
  iban?: string | null;
  /** Hak edilmiş net toplam (komisyon düşülmüş). */
  earned: string;
  /** Şimdiye dek ödenen. */
  paid: string;
  /** Ödenmemiş bakiye = earned − paid. */
  balance: string;
  /** Emanetteki (henüz hak edilmemiş) tutar — borç DEĞİL. */
  pending: string;
  /** Öğretmenin açık para çekme talebi (varsa). */
  requested_amount?: string | null;
  requested_at?: string | null;
}

/**
 * Öğretmene para yalnız kendisi "Para çek" dediyse gönderilir (kullanıcı
 * kararı, 23 Eyl 2026; sunucu da 409 ile korur). Kütüphane değişmedi.
 */
export function odemeYapilabilir(b: PayeeBalance): boolean {
  return b.payee_type !== "TUTOR" || b.requested_amount != null;
}

/** Bu kayda en fazla ödenebilecek tutar: öğretmende talep ile bakiyenin küçüğü. */
export function odenebilirTutar(b: PayeeBalance): string {
  if (b.payee_type !== "TUTOR" || b.requested_amount == null) return b.balance;
  return Number(b.requested_amount) < Number(b.balance) ? b.requested_amount : b.balance;
}

export interface PayoutRecord {
  id: number;
  payee_type: "TUTOR" | "LIBRARY";
  payee_id: number;
  amount: string;
  currency: string;
  iban_snapshot?: string | null;
  reference?: string | null;
  note?: string | null;
  paid_at: string;
}

export interface PayoutCreate {
  payee_type: "TUTOR" | "LIBRARY";
  payee_id: number;
  amount: string;
  reference?: string | null;
  note?: string | null;
}

/** Ödeme günü bakılacak liste: kime ne kadar borçluyuz. */
export async function fetchPendingPayouts(
  onlyOwed = true
): Promise<PayeeBalance[]> {
  const { data } = await apiClient.get<PayeeBalance[]>("/payouts/pending", {
    params: { only_owed: onlyOwed },
  });
  return data;
}

export async function fetchPayoutHistory(
  limit = 100,
  offset = 0
): Promise<PayoutRecord[]> {
  const { data } = await apiClient.get<PayoutRecord[]>("/payouts", {
    params: { limit, offset },
  });
  return data;
}

/** Yapılan havaleyi deftere işler (ödeme bankadan elle yapılır). */
export async function createPayout(payload: PayoutCreate): Promise<PayoutRecord> {
  const { data } = await apiClient.post<PayoutRecord>("/payouts", payload);
  return data;
}
