import { apiClient } from "@/api/axios";
import type { ReviewCreate, ReviewOut } from "@/types";

export async function createReview(
  payload: ReviewCreate
): Promise<ReviewOut> {
  const { data } = await apiClient.post<ReviewOut>("/reviews", payload);
  return data;
}

export interface ListReviewsParams {
  tutor_id?: number;
  limit?: number;
  offset?: number;
}

export async function listReviews(
  params: ListReviewsParams
): Promise<ReviewOut[]> {
  const { data } = await apiClient.get<ReviewOut[]>("/reviews", { params });
  return data;
}

export async function reviewByBooking(
  bookingId: number
): Promise<ReviewOut | null> {
  const { data } = await apiClient.get<ReviewOut | null>(
    `/reviews/booking/${bookingId}`
  );
  return data;
}

export async function replyToReview(
  reviewId: number,
  reply: string
): Promise<ReviewOut> {
  const { data } = await apiClient.post<ReviewOut>(
    `/reviews/${reviewId}/reply`,
    { reply }
  );
  return data;
}
