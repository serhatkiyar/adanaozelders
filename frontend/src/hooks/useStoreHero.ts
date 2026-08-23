import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  clearStoreHeroMobileImage,
  createStoreHeroSlide,
  deleteStoreHeroSlide,
  fetchAdminStoreHeroSlides,
  fetchStoreHeroSlides,
  reorderStoreHeroSlides,
  replaceStoreHeroSlideImage,
  type StoreHeroSlideCreateInput,
  updateStoreHeroSlide,
} from "@/api/storeHero";
import type { StoreHeroSlideUpdate } from "@/types";

const PUBLIC_KEY = ["store", "hero-slides"] as const;
const ADMIN_KEY = ["admin", "store", "hero-slides"] as const;

export function useStoreHeroSlides() {
  return useQuery({
    queryKey: PUBLIC_KEY,
    queryFn: fetchStoreHeroSlides,
    staleTime: 60_000,
    retry: false,
    meta: { silentError: true },
  });
}

export function useAdminStoreHeroSlides() {
  return useQuery({ queryKey: ADMIN_KEY, queryFn: fetchAdminStoreHeroSlides });
}

function useInvalidateStoreHero() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: PUBLIC_KEY });
    queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
  };
}

export function useCreateStoreHeroSlide() {
  const invalidate = useInvalidateStoreHero();
  return useMutation({ mutationFn: (input: StoreHeroSlideCreateInput) => createStoreHeroSlide(input), onSuccess: invalidate });
}

export function useUpdateStoreHeroSlide() {
  const invalidate = useInvalidateStoreHero();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: StoreHeroSlideUpdate }) =>
      updateStoreHeroSlide(id, payload),
    onSuccess: invalidate,
  });
}

export function useReplaceStoreHeroSlideImage() {
  const invalidate = useInvalidateStoreHero();
  return useMutation({
    mutationFn: ({ id, slot, file }: { id: number; slot: "desktop" | "mobile"; file: File }) =>
      replaceStoreHeroSlideImage(id, slot, file),
    onSuccess: invalidate,
  });
}

export function useClearStoreHeroMobileImage() {
  const invalidate = useInvalidateStoreHero();
  return useMutation({ mutationFn: clearStoreHeroMobileImage, onSuccess: invalidate });
}

export function useReorderStoreHeroSlides() {
  const invalidate = useInvalidateStoreHero();
  return useMutation({ mutationFn: reorderStoreHeroSlides, onSuccess: invalidate });
}

export function useDeleteStoreHeroSlide() {
  const invalidate = useInvalidateStoreHero();
  return useMutation({ mutationFn: deleteStoreHeroSlide, onSuccess: invalidate });
}
