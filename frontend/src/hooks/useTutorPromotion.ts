import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buyPromotion,
  fetchMyPromotions,
  fetchPromotionPackages,
} from "@/api/tutors";

export function usePromotionPackages() {
  return useQuery({
    queryKey: ["tutors", "promotion-packages"],
    queryFn: fetchPromotionPackages,
    staleTime: 10 * 60 * 1000,
  });
}

export function useMyPromotions() {
  return useQuery({
    queryKey: ["tutors", "me", "promotions"],
    queryFn: fetchMyPromotions,
  });
}

export function useBuyPromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: buyPromotion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tutors", "me", "promotions"] });
    },
  });
}
