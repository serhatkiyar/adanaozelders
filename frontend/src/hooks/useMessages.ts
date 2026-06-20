import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  listConversations,
  listMessages,
  markConversationRead,
  searchMessages,
  sendMessage,
  setConversationArchived,
  toggleReaction,
  unreadCount,
} from "@/api/messages";
import { useAuthStore } from "@/store/authStore";

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
