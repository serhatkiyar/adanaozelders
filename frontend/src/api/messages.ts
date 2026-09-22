import { apiClient } from "@/api/axios";
import type {
  BlockCreate,
  BlockOut,
  ConversationOut,
  MessageOut,
  MessageReactionOut,
  MessageSearchResults,
  MessagesUnreadCounts,
  MessageTemplateCreate,
  MessageTemplateOut,
  MessagingEligibility,
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
  replyToId?: number | null,
  counterpartyRole?: string | null
): Promise<MessageOut> {
  const { data } = await apiClient.post<MessageOut>(
    `/messages/${counterpartyId}`,
    {
      body,
      reply_to_id: replyToId ?? null,
      counterparty_role: counterpartyRole ?? null,
    }
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

/** Öğrencinin bu eğitmene yazıp yazamayacağı ve kalan hakları (yalnız öğrenci). */
export async function getMessagingEligibility(
  tutorId: number
): Promise<MessagingEligibility> {
  const { data } = await apiClient.get<MessagingEligibility>(
    `/messages/tutors/${tutorId}/eligibility`
  );
  return data;
}

/** Eğitmen bir öğrenciyi gerekçeyle engeller (yalnız eğitmen). */
export async function blockClient(payload: BlockCreate): Promise<BlockOut> {
  const { data } = await apiClient.post<BlockOut>("/messages/blocks", payload);
  return data;
}

export async function unblockClient(clientId: number): Promise<void> {
  await apiClient.delete(`/messages/blocks/${clientId}`);
}

/** Eğitmenin kendi hazır mesaj şablonları (yalnız eğitmen). */
export async function listMessageTemplates(): Promise<MessageTemplateOut[]> {
  const { data } = await apiClient.get<MessageTemplateOut[]>(
    "/messages/templates"
  );
  return data;
}

export async function createMessageTemplate(
  payload: MessageTemplateCreate
): Promise<MessageTemplateOut> {
  const { data } = await apiClient.post<MessageTemplateOut>(
    "/messages/templates",
    payload
  );
  return data;
}

export async function deleteMessageTemplate(
  templateId: number
): Promise<void> {
  await apiClient.delete(`/messages/templates/${templateId}`);
}
