import { apiClient } from "@/api/axios";

/** Centrifugo bağlantı bilgisi — kanal adı SUNUCUDAN gelir, burada türetilmez. */
export interface RealtimeToken {
  token: string;
  channel: string;
  /** Saniye. SDK süre dolmadan yeni token ister. */
  ttl: number;
}

export async function getCentrifugoToken(): Promise<RealtimeToken> {
  const { data } = await apiClient.post<RealtimeToken>("/realtime/token");
  return data;
}

/** Karşı tarafa "yazıyor…" ipucu. Best-effort — hata çağıranda yutulur. */
export async function sendTyping(conversationId: number): Promise<void> {
  await apiClient.post("/realtime/typing", { conversation_id: conversationId });
}
