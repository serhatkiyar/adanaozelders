import { apiClient } from "@/api/axios";
import type {
  TimeOff,
  TimeOffCreate,
  TimeOffCreated,
  TimeOffPreview,
  TimeOffRange,
} from "@/types";

/** Eğitmenin izinleri — aralık en fazla 62 gün (sunucu sınırı). */
export async function listTimeOff(start: string, end: string): Promise<TimeOff[]> {
  const { data } = await apiClient.get<TimeOff[]>("/tutors/me/time-off", {
    params: { start, end },
  });
  return data;
}

/** Salt okunur: izne düşen dersler ve iznin engellenip engellenmediği. */
export async function previewTimeOff(range: TimeOffRange): Promise<TimeOffPreview> {
  const { data } = await apiClient.post<TimeOffPreview>("/tutors/me/time-off/preview", range);
  return data;
}

export async function createTimeOff(payload: TimeOffCreate): Promise<TimeOffCreated> {
  const { data } = await apiClient.post<TimeOffCreated>("/tutors/me/time-off", payload);
  return data;
}

export async function deleteTimeOff(id: number): Promise<void> {
  await apiClient.delete(`/tutors/me/time-off/${id}`);
}
