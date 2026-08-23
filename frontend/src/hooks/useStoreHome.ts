import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/api/storeHome";
import type { StoreHomeImageSectionInput, StoreHomeProductSectionInput } from "@/types";

const PUBLIC_KEY = ["store", "home-sections"] as const;
const ADMIN_KEY = ["admin", "store", "home-sections"] as const;

export function useStoreHome() {
  return useQuery({
    queryKey: PUBLIC_KEY,
    queryFn: api.fetchStoreHome,
    staleTime: 60_000,
    retry: false,
    meta: { silentError: true },
  });
}

export function useAdminStoreHome() {
  return useQuery({ queryKey: ADMIN_KEY, queryFn: api.fetchAdminStoreHome });
}

function useInvalidateStoreHome() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: PUBLIC_KEY });
    queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
  };
}

export function useCreateStoreHomeProductSection() {
  const invalidate = useInvalidateStoreHome();
  return useMutation({ mutationFn: api.createProductSection, onSuccess: invalidate });
}

export function useUpdateStoreHomeProductSection() {
  const invalidate = useInvalidateStoreHome();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: StoreHomeProductSectionInput }) =>
      api.updateProductSection(id, payload),
    onSuccess: invalidate,
  });
}

export function useCreateStoreHomeImageSection() {
  const invalidate = useInvalidateStoreHome();
  return useMutation({ mutationFn: api.createImageSection, onSuccess: invalidate });
}

export function useUpdateStoreHomeImageSection() {
  const invalidate = useInvalidateStoreHome();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: StoreHomeImageSectionInput }) =>
      api.updateImageSection(id, payload),
    onSuccess: invalidate,
  });
}

export function useReorderStoreHomeSections() {
  const invalidate = useInvalidateStoreHome();
  return useMutation({ mutationFn: api.reorderSections, onSuccess: invalidate });
}

export function useUpdateStoreHomeRecentlyViewedSection() {
  const invalidate = useInvalidateStoreHome();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.updateRecentlyViewedSection(id, isActive),
    onSuccess: invalidate,
  });
}

export function useDeleteStoreHomeSection() {
  const invalidate = useInvalidateStoreHome();
  return useMutation({ mutationFn: api.deleteSection, onSuccess: invalidate });
}
