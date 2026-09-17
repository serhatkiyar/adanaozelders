import { apiClient } from "@/api/axios";
import type { BookingOfferCreate, BookingOut, TutorStudent } from "@/types";

/** Eğitmenin ders ilişkisi olan öğrencileri (teklif ekranı için). */
export async function listMyStudents(): Promise<TutorStudent[]> {
  const { data } = await apiClient.get<TutorStudent[]>("/tutors/me/students");
  return data;
}

/** Ders teklifi gönderir; yanıtı öğrenci verir (kabul → ödeme). */
export async function offerLesson(payload: BookingOfferCreate): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>("/bookings/offer", payload);
  return data;
}
