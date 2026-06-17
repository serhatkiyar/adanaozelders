import { apiClient } from "@/api/axios";
import type { PayoutOut, PayoutSubmit } from "@/types";

export async function fetchMyPayout(): Promise<PayoutOut> {
  const { data } = await apiClient.get<PayoutOut>("/me/payout");
  return data;
}

export async function submitMyPayout(payload: PayoutSubmit): Promise<PayoutOut> {
  const { data } = await apiClient.post<PayoutOut>("/me/payout", payload);
  return data;
}
