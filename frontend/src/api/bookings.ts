import { apiClient } from "@/api/axios";
import type { BookingCreate, BookingOut, BookingStatus } from "@/types";

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
