import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/api/notifications";
import { useAuthStore } from "@/store/authStore";

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
