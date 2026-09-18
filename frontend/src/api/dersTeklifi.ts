import { apiClient } from "@/api/axios";
import type {
  BookingOfferCreate,
  BookingOut,
  LessonSeries,
  LessonSeriesCreate,
  LessonSeriesCreated,
  LessonSeriesPreview,
  TutorStudent,
} from "@/types";

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

/** Salt okunur: serinin hangi haftaları şimdi, hangileri sonra teklif edilir, hangileri çakışır. */
export async function previewSeries(payload: LessonSeriesCreate): Promise<LessonSeriesPreview> {
  const { data } = await apiClient.post<LessonSeriesPreview>("/bookings/series/preview", payload);
  return data;
}

/** Haftalık seri kurar; pencere içindeki haftalar hemen teklif olur. */
export async function createSeries(payload: LessonSeriesCreate): Promise<LessonSeriesCreated> {
  const { data } = await apiClient.post<LessonSeriesCreated>("/bookings/series", payload);
  return data;
}

export async function getSeries(id: number): Promise<LessonSeries> {
  const { data } = await apiClient.get<LessonSeries>(`/bookings/series/${id}`);
  return data;
}

/** Seriyi bitirir: bekleyen teklifler geri çekilir, kabul edilmiş dersler kalır. */
export async function endSeries(id: number): Promise<LessonSeries> {
  const { data } = await apiClient.post<LessonSeries>(`/bookings/series/${id}/end`);
  return data;
}

/** Eğitmen, yanıt bekleyen (ödemesiz) teklifini geri çeker. */
export async function withdrawOffer(bookingId: number): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${bookingId}/withdraw`);
  return data;
}
