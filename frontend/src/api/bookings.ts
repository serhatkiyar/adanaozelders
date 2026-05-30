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
  location: string
): Promise<BookingOut> {
  const { data } = await apiClient.post<BookingOut>(
    `/bookings/${id}/location`,
    { location }
  );
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
