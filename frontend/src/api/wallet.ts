import { apiClient } from "@/api/axios";
import type { Wallet } from "@/types";

/** Öğretmen cüzdanı — ödenebilir bakiye, emanetteki tutar, açık talep. */
export async function fetchWallet(): Promise<Wallet> {
  const { data } = await apiClient.get<Wallet>("/me/wallet");
  return data;
}

/** "Para çek": ödenebilir bakiyenin tamamı için talep (tutar sunucuda). */
export async function requestWithdrawal(): Promise<Wallet> {
  const { data } = await apiClient.post<Wallet>("/me/wallet/withdrawals");
  return data;
}

/** "Geçmişi dosya olarak ver": kazanç + para çekme geçmişi (CSV). */
export async function downloadWalletCsv(): Promise<Blob> {
  const { data } = await apiClient.get("/me/wallet/export", {
    responseType: "blob",
  });
  return data as Blob;
}
