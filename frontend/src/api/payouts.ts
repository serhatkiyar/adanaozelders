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

export async function fetchPayoutHistory(limit = 100): Promise<PayoutRecord[]> {
  const { data } = await apiClient.get<PayoutRecord[]>("/payouts", {
    params: { limit },
  });
  return data;
}

/** Yapılan havaleyi deftere işler (ödeme bankadan elle yapılır). */
export async function createPayout(payload: PayoutCreate): Promise<PayoutRecord> {
  const { data } = await apiClient.post<PayoutRecord>("/payouts", payload);
  return data;
}
