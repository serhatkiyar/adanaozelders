import { apiClient } from "@/api/axios";
import type { NotificationOut } from "@/types";

export async function fetchNotifications(): Promise<NotificationOut[]> {
  const { data } = await apiClient.get<NotificationOut[]>("/notifications", {
    params: { limit: 30 },
  });
  return data;
}

export async function fetchUnreadCount(): Promise<number> {
  const { data } = await apiClient.get<{ count: number }>(
    "/notifications/unread-count"
  );
  return data.count;
}

export async function markNotificationRead(id: number): Promise<void> {
  await apiClient.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post("/notifications/read-all");
}
