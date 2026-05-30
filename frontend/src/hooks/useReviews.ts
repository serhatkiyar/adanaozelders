import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReview,
  listReviews,
  replyToReview,
  reviewByBooking,
} from "@/api/reviews";
import type { ReviewCreate } from "@/types";

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

export function useReplyToReview(tutorId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewId, reply }: { reviewId: number; reply: string }) =>
      replyToReview(reviewId, reply),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reviews", "tutor", tutorId] });
    },
  });
}
