import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  askQuestion,
  closeThread,
  fetchQaRights,
  listThreads,
  postQaMessage,
  type ListThreadsParams,
} from "@/api/qa";
import { useAuthStore } from "@/store/authStore";
import type { QAThreadCreate } from "@/types";

export function useThreads(params: ListThreadsParams = {}) {
  return useQuery({
    queryKey: ["qa", params],
    queryFn: () => listThreads(params),
  });
}

export function useQaRights() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["qaRights"],
    queryFn: fetchQaRights,
    enabled: !!token,
  });
}

export function useAskQuestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: QAThreadCreate) => askQuestion(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa"] });
      queryClient.invalidateQueries({ queryKey: ["qaRights"] });
    },
  });
}

export function usePostQaMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, body }: { threadId: number; body: string }) =>
      postQaMessage(threadId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa"] });
      queryClient.invalidateQueries({ queryKey: ["qaRights"] });
    },
  });
}

export function useCloseThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threadId: number) => closeThread(threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa"] });
    },
  });
}
