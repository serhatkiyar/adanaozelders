import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReview,
  listReviews,
  reviewByBooking,
  tutorRatingDistribution,
  updateReview,
} from "@/api/reviews";
import type { ReviewCreate, ReviewUpdate } from "@/types";

export function useCreateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReviewCreate) => createReview(payload),
    onSuccess: () => {
      // Yeni değerlendirme + tutor rating + booking.reviewed bayrağı tazelenmeli.
      qc.invalidateQueries({ queryKey: ["reviews"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["tutors"] });
    },
  });
}

export function useReviewByBooking(bookingId: number) {
  return useQuery({
    queryKey: ["reviews", "booking", bookingId],
    queryFn: () => reviewByBooking(bookingId),
    enabled: Number.isFinite(bookingId) && bookingId > 0,
  });
}

export function useReviewsByTutor(tutorId: number) {
  return useQuery({
    queryKey: ["reviews", "tutor", tutorId],
    queryFn: () => listReviews({ tutor_id: tutorId, limit: 50 }),
    enabled: Number.isFinite(tutorId) && tutorId > 0,
  });
}

export function useTutorRatingDistribution(tutorId: number) {
  return useQuery({
    queryKey: ["reviews", "distribution", "tutor", tutorId],
    queryFn: () => tutorRatingDistribution(tutorId),
    enabled: Number.isFinite(tutorId) && tutorId > 0,
  });
}

export function useUpdateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewId, payload }: { reviewId: number; payload: ReviewUpdate }) =>
      updateReview(reviewId, payload),
    onSuccess: () => {
      // Profil listesi, özet ortalamaları ve tutor rating'i tazelenmeli.
      qc.invalidateQueries({ queryKey: ["reviews"] });
      qc.invalidateQueries({ queryKey: ["tutors"] });
    },
  });
}
