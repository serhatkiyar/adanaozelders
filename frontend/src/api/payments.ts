import { apiClient } from "@/api/axios";
import type { EarningsSummary, Payment } from "@/types";

export async function getBookingPayment(
  bookingId: number
): Promise<Payment | null> {
  const { data } = await apiClient.get<Payment | null>(
    `/payments/booking/${bookingId}`
  );
  return data;
}

export async function payBooking(bookingId: number): Promise<Payment> {
  const { data } = await apiClient.post<Payment>(
    `/payments/booking/${bookingId}/pay`
  );
  return data;
}

export async function fetchEarnings(): Promise<EarningsSummary> {
  const { data } = await apiClient.get<EarningsSummary>("/payments/earnings");
  return data;
}
