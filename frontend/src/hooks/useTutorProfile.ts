import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateMyListing,
  fetchMyTutorProfile,
  submitMyTutorProfile,
  suspendMyListing,
  updateMyTutorProfile,
} from "@/api/tutors";
import type { TutorOut, TutorProfileUpdate } from "@/types";

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
    onSuccess: (tutor) => queryClient.setQueryData(["tutors", "me"], tutor),
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
