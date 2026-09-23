import { apiClient } from "@/api/axios";
import type {
  ReviewCreate,
  ReviewOut,
  ReviewUpdate,
  TutorRatingSummary,
} from "@/types";

export async function tutorRatingDistribution(
  tutorId: number
): Promise<TutorRatingSummary> {
  const { data } = await apiClient.get<TutorRatingSummary>(
    "/reviews/distribution",
    { params: { tutor_id: tutorId } }
  );
  return data;
}

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

export async function updateReview(
  reviewId: number,
  payload: ReviewUpdate
): Promise<ReviewOut> {
  const { data } = await apiClient.patch<ReviewOut>(
    `/reviews/${reviewId}`,
    payload
  );
  return data;
}
