import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
  unreadCount,
} from "@/api/messages";
import { useAuthStore } from "@/store/authStore";

export function useConversations() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
    enabled: !!token,
    refetchInterval: 30_000,
  });
}

export function useMessages(conversationId: number | null) {
  return useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => listMessages(conversationId as number),
    enabled: conversationId !== null,
    refetchInterval: 15_000,
  });
}

export function useMessagesUnreadCount() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["messages", "unread"],
    queryFn: unreadCount,
    enabled: !!token,
    refetchInterval: 30_000,
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
    }: {
      counterpartyId: number;
      body: string;
    }) => sendMessage(counterpartyId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
