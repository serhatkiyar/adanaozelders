import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateMyListing,
  fetchMyTutorProfile,
  submitMyTutorProfile,
  suspendMyListing,
  updateMyTutorProfile,
} from "@/api/tutors";
import type { TutorOut, TutorProfileUpdate } from "@/types";
import { freshenViewedTutor } from "@/lib/recentlyViewed";

export function useMyTutorProfile() {
  return useQuery({
    queryKey: ["tutors", "me"],
    queryFn: fetchMyTutorProfile,
    staleTime: 30_000,
  });
}

export function useUpdateTutorProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TutorProfileUpdate) => updateMyTutorProfile(payload),
    onSuccess: (tutor) => {
      queryClient.setQueryData(["tutors", "me"], tutor);
      // İlan güncellenince arama/detay önbelleği bayat kalmasın.
      queryClient.invalidateQueries({ queryKey: ["tutors", "search"] });
      queryClient.invalidateQueries({ queryKey: ["tutors", "detail", tutor.id] });
      // "Son görüntülenenler" localStorage anlık görüntüsünü de tazele.
      freshenViewedTutor(tutor.id, {
        full_name: tutor.full_name,
        avatar_url: tutor.avatar_url,
        headline: tutor.headline,
        bio: tutor.bio,
        lesson_info: tutor.lesson_info,
        hourly_rate: tutor.hourly_rate,
        teaching_mode: tutor.teaching_mode,
        first_lesson_free: tutor.first_lesson_free,
        subjects: tutor.subjects,
      });
    },
  });
}

export type ListingAction = "submit" | "suspend" | "activate";

const ACTIONS: Record<ListingAction, () => Promise<TutorOut>> = {
  submit: submitMyTutorProfile,
  suspend: suspendMyListing,
  activate: activateMyListing,
};

// FSM aksiyonları; başarıda kendi profilini günceller ve Marketplace listesini geçersiz kılar.
export function useTutorListingAction(action: ListingAction) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => ACTIONS[action](),
    onSuccess: (tutor) => {
      queryClient.setQueryData(["tutors", "me"], tutor);
      queryClient.invalidateQueries({ queryKey: ["tutors", "search"] });
    },
  });
}
