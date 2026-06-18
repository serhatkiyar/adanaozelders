import { apiClient } from "@/api/axios";
import type {
  ConversationOut,
  MessageOut,
  MessageReactionOut,
  MessageSearchResults,
  MessagesUnreadCounts,
} from "@/types";

export async function listConversations(
  archived = false
): Promise<ConversationOut[]> {
  const { data } = await apiClient.get<ConversationOut[]>(
    "/messages/conversations",
    { params: archived ? { archived: true } : undefined }
  );
  return data;
}

export async function searchMessages(
  q: string
): Promise<MessageSearchResults> {
  const { data } = await apiClient.get<MessageSearchResults>(
    "/messages/search",
    { params: { q } }
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
  body: string,
  replyToId?: number | null
): Promise<MessageOut> {
  const { data } = await apiClient.post<MessageOut>(
    `/messages/${counterpartyId}`,
    { body, reply_to_id: replyToId ?? null }
  );
  return data;
}

export async function toggleReaction(
  messageId: number,
  emoji: string
): Promise<MessageReactionOut[]> {
  const { data } = await apiClient.post<MessageReactionOut[]>(
    `/messages/items/${messageId}/reactions`,
    { emoji }
  );
  return data;
}

export async function setConversationArchived(
  conversationId: number,
  archived: boolean
): Promise<void> {
  await apiClient.post(
    `/messages/conversations/${conversationId}/${
      archived ? "archive" : "unarchive"
    }`
  );
}

export async function unreadCount(): Promise<MessagesUnreadCounts> {
  const { data } = await apiClient.get<MessagesUnreadCounts>(
    "/messages/unread-count"
  );
  return data;
}

export async function markConversationRead(
  conversationId: number
): Promise<void> {
  await apiClient.post(`/messages/conversations/${conversationId}/read`);
}
