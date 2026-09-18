import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  blockClient,
  getMessagingEligibility,
  listConversations,
  listMessages,
  markConversationRead,
  searchMessages,
  sendMessage,
  setConversationArchived,
  toggleReaction,
  unblockClient,
  unreadCount,
} from "@/api/messages";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS, type BlockCreate } from "@/types";

export function useConversations(archived = false) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["conversations", archived],
    queryFn: () => listConversations(archived),
    enabled: !!token,
  });
}

export function useMessageSearch(q: string) {
  const token = useAuthStore((s) => s.token);
  const term = q.trim();
  return useQuery({
    queryKey: ["message-search", term],
    queryFn: () => searchMessages(term),
    enabled: !!token && term.length > 0,
    // Yazarken eski sonuçlar ekranda kalsın (her tuşta skeleton titremesin).
    placeholderData: keepPreviousData,
  });
}

export function useMessages(conversationId: number | null) {
  return useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => listMessages(conversationId as number),
    enabled: conversationId !== null,
  });
}

export function useMessagesUnreadCount() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["messages", "unread"],
    queryFn: unreadCount,
    enabled: !!token,
  });
}

export function useMarkConversationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => markConversationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["messages", "unread"] });
    },
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      counterpartyId,
      body,
      replyToId,
      counterpartyRole,
    }: {
      counterpartyId: number;
      body: string;
      replyToId?: number | null;
      counterpartyRole?: string | null;
    }) => sendMessage(counterpartyId, body, replyToId, counterpartyRole),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["message-search"] });
    },
  });
}

export function useToggleReaction(conversationId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: number; emoji: string }) =>
      toggleReaction(messageId, emoji),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
  });
}

export function useArchiveConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      setConversationArchived(id, archived),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

/**
 * Öğrencinin bir eğitmene yazma uygunluğu (engel, ders öncesi kalan haklar).
 * Anahtar `["messages", ...]` altında: `useSendMessage` başarıda `["messages"]`
 * tazelediği için kalan hak sayısı her gönderimden sonra kendiliğinden güncellenir.
 */
export function useMessagingEligibility(tutorId: number | null) {
  const token = useAuthStore((s) => s.token);
  const roleId = useAuthStore((s) => s.user?.role_id);
  return useQuery({
    queryKey: ["messages", "eligibility", tutorId],
    queryFn: () => getMessagingEligibility(tutorId as number),
    enabled: !!token && roleId === ROLE_IDS.CLIENT && tutorId !== null,
    retry: false,
    // Engel/engel kaldırma öğrenciye WS ile gelmez; sekmeye dönünce tazelensin.
    refetchOnWindowFocus: true,
  });
}

export function useBlockClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BlockCreate) => blockClient(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["messages"] });
    },
  });
}

export function useUnblockClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: number) => unblockClient(clientId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["messages"] });
    },
  });
}
