import { apiClient } from "@/api/axios";
import type {
  TahtaTokenOut,
  BookingCreate,
  BookingIssueReason,
  BookingOut,
  BookingStatus,
  ZoomDersTokenOut,
} from "@/types";

/**
 * FormData gövdesi için Content-Type ELLE YAZILMAZ — sentinel `false` şart.
 * Gerekçe (boundary'siz sabit → sunucu ayrıştıramaz; `undefined` axios'un
 * post/put/patch url-encoded düşüşüyle ÜZERİNE YAZILIYOR; header'ı tamamen
 * silmek bu instance'ın `application/json` varsayılanına düşüp FormData'yı
 * JSON'a çeviriyor) ayrıntısıyla `api/store.ts`'teki aynı isimli sabitte.
 */
const MULTIPART = { headers: { "Content-Type": false as const } };

export async function createBooking(
  payload: BookingCreate
): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>("/bookings", payload);
  return data;
}

export interface ListBookingsParams {
  status?: BookingStatus;
  limit?: number;
  offset?: number;
  /** Takvim penceresi (ISO, tz'li). İkisi birlikte verilir; aralık ≤ 8 gün. */
  start_from?: string;
  start_to?: string;
  /** Eğitmenin Öğrenciler panelinde tek öğrencinin dersleri (yalnız TUTOR). */
  client_id?: number;
}

export async function listBookings(
  params: ListBookingsParams
): Promise<BookingOut[]> {
  const { data } = await apiClient.get<BookingOut[]>("/bookings", { params });
  return data;
}

export async function fetchBooking(id: number): Promise<BookingOut> {
  const { data } = await apiClient.get<BookingOut>(`/bookings/${id}`);
  return data;
}

/** Canlı ders (Zoom) giriş bileti; kapılar sunucuda (taraf, ödeme, saat). */
export async function getZoomToken(id: number): Promise<ZoomDersTokenOut> {
  const { data } = await apiClient.get<ZoomDersTokenOut>(`/bookings/${id}/zoom-token`);
  return data;
}

/** Ders tahtası kanalının abonelik token'ı (ortak canlı ders kapıları). */
export async function getTahtaToken(id: number): Promise<TahtaTokenOut> {
  const { data } = await apiClient.get<TahtaTokenOut>(`/bookings/${id}/tahta-token`);
  return data;
}

/** Tahtayı açar/kapatır — yalnız dersin eğitmeni (sunucu 403 döner). */
export async function setTahtaDurumu(id: number, acik: boolean): Promise<{ acik: boolean }> {
  const { data } = await apiClient.put<{ acik: boolean }>(`/bookings/${id}/tahta`, { acik });
  return data;
}

export async function setBookingLocation(
  id: number,
  location: string,
  lat: number | null,
  lng: number | null
): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/location`, {
    location,
    location_lat: lat,
    location_lng: lng,
  });
  return data;
}

export async function acceptBooking(id: number): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/accept`);
  return data;
}

export async function rejectBooking(id: number): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/reject`);
  return data;
}

export async function completeBooking(id: number): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/complete`);
  return data;
}

export async function confirmBooking(id: number): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/confirm`);
  return data;
}

export async function reportBookingIssue(
  id: number,
  reason: BookingIssueReason,
  note?: string
): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/report-issue`, {
    reason,
    note: note?.trim() ? note.trim() : null,
  });
  return data;
}

export async function cancelBooking(
  id: number,
  reason?: string
): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/cancel`, {
    reason: reason ?? null,
  });
  return data;
}

export async function rescheduleBooking(
  id: number,
  startAt: string,
  endAt: string
): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(
    `/bookings/${id}/reschedule`,
    { start_at: startAt, end_at: endAt }
  );
  return data;
}

/** Öğretmen onaylı dersi başka zamana alır; süre ve ücret aynı kalır. */
export async function tutorRescheduleBooking(id: number, startAt: string): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/tutor-reschedule`, {
    start_at: startAt,
  });
  return data;
}

/** Öğrenci öğretmenin önerdiği yeni saati kabul eder. */
export async function acceptTutorReschedule(id: number): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/tutor-reschedule/accept`);
  return data;
}

/** Öğrenci yeni saati kabul etmez: ders iptal edilir, ücret iade edilir. */
export async function declineTutorReschedule(id: number): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/tutor-reschedule/decline`);
  return data;
}

/** Öğretmen öğrenciye "dersi onayla" hatırlatması gönderir. */
export async function remindConfirm(id: number): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/remind-confirm`);
  return data;
}

export async function addBookingResource(
  id: number,
  title: string,
  url: string
): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/resources`, {
    title,
    url,
  });
  return data;
}

export async function deleteBookingResource(
  id: number,
  resourceId: number
): Promise<BookingOut> {
  const { data } = await apiClient.delete<BookingOut>(
    `/bookings/${id}/resources/${resourceId}`
  );
  return data;
}

export async function uploadBookingResource(
  id: number,
  file: File
): Promise<BookingOut> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<BookingOut>(
    `/bookings/${id}/resources/upload`,
    form,
    MULTIPART
  );
  return data;
}

export async function addBookingComment(
  id: number,
  body: string
): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/comments`, {
    body,
  });
  return data;
}

export async function deleteBookingComment(
  id: number,
  commentId: number
): Promise<BookingOut> {
  const { data } = await apiClient.delete<BookingOut>(
    `/bookings/${id}/comments/${commentId}`
  );
  return data;
}

export async function addBookingPrivateNote(
  id: number,
  body: string
): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(`/bookings/${id}/private-notes`, {
    body,
  });
  return data;
}

export async function deleteBookingPrivateNote(
  id: number,
  noteId: number
): Promise<BookingOut> {
  const { data } = await apiClient.delete<BookingOut>(
    `/bookings/${id}/private-notes/${noteId}`
  );
  return data;
}
