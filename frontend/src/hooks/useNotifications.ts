import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchNotifications,
  fetchNotificationsPaginated,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/api/notifications";
import { useAuthStore } from "@/store/authStore";

const PAGE_SIZE = 20;

export function useUnreadCount() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: fetchUnreadCount,
    enabled: !!token,
  });
}

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ["notifications", "list"],
    queryFn: fetchNotifications,
    enabled,
  });
}

export function useInfiniteNotifications() {
  const token = useAuthStore((s) => s.token);
  return useInfiniteQuery({
    queryKey: ["notifications", "infinite"],
    queryFn: ({ pageParam = 0 }) =>
      fetchNotificationsPaginated(PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE
        ? undefined
        : allPages.reduce((sum, p) => sum + p.length, 0),
    enabled: !!token,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
