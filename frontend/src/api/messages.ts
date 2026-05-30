import { apiClient } from "@/api/axios";
import type { ConversationOut, MessageOut } from "@/types";

export async function listConversations(): Promise<ConversationOut[]> {
  const { data } = await apiClient.get<ConversationOut[]>(
    "/messages/conversations"
  );
  return data;
}

export async function listMessages(
  conversationId: number
): Promise<MessageOut[]> {
  const { data } = await apiClient.get<MessageOut[]>(
    `/messages/conversations/${conversationId}`,
    { params: { limit: 200 } }
  );
  return data;
}

export async function sendMessage(
  counterpartyId: number,
  body: string
): Promise<MessageOut> {
  const { data } = await apiClient.post<MessageOut>(
    `/messages/${counterpartyId}`,
    { body }
  );
  return data;
}

export async function unreadCount(): Promise<number> {
  const { data } = await apiClient.get<number>("/messages/unread-count");
  return data;
}

export async function markConversationRead(
  conversationId: number
): Promise<void> {
  await apiClient.post(`/messages/conversations/${conversationId}/read`);
}
