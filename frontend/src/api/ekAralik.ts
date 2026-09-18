import { apiClient } from "@/api/axios";
import type { ExtraAvailability, ExtraAvailabilityCreated, TimeOffRange } from "@/types";

/** Eğitmenin ek zaman aralıkları — aralık en fazla 62 gün (sunucu sınırı). */
export async function listExtra(start: string, end: string): Promise<ExtraAvailability[]> {
  const { data } = await apiClient.get<ExtraAvailability[]>("/tutors/me/extra-availability", {
    params: { start, end },
  });
  return data;
}

/** Haftalık şablonu değiştirmeden tek seferlik müsait aralık açar. Kurallar sunucudadır. */
export async function createExtra(range: TimeOffRange): Promise<ExtraAvailabilityCreated> {
  const { data } = await apiClient.post<ExtraAvailabilityCreated>(
    "/tutors/me/extra-availability",
    range
  );
  return data;
}

/** Ek aralığı siler; aralıktaki mevcut dersler etkilenmez. */
export async function deleteExtra(id: number): Promise<void> {
  await apiClient.delete(`/tutors/me/extra-availability/${id}`);
}
