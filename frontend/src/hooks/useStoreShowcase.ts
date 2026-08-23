import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/api/storeShowcase";
import type {
  StoreShowcaseCardInput,
  StoreShowcaseCustomCardInput,
} from "@/types";

const PUBLIC_KEY = ["store", "showcase-cards"] as const;
const ADMIN_KEY = ["admin", "store", "showcase-cards"] as const;

export function useStoreShowcase() {
  return useQuery({
    queryKey: PUBLIC_KEY,
    queryFn: api.fetchStoreShowcase,
    staleTime: 60_000,
    retry: false,
    meta: { silentError: true },
  });
}

export function useAdminStoreShowcase() {
  return useQuery({ queryKey: ADMIN_KEY, queryFn: api.fetchAdminStoreShowcase });
}

function useInvalidateShowcase() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: PUBLIC_KEY });
    queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
  };
}

export function useCreateStoreShowcaseCard() {
  const invalidate = useInvalidateShowcase();
  return useMutation({ mutationFn: api.createStoreShowcaseCard, onSuccess: invalidate });
}

export function useCreateCustomStoreShowcaseCard() {
  const invalidate = useInvalidateShowcase();
  return useMutation({ mutationFn: api.createCustomStoreShowcaseCard, onSuccess: invalidate });
}

export function useUpdateCustomStoreShowcaseCard() {
  const invalidate = useInvalidateShowcase();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: StoreShowcaseCustomCardInput }) =>
      api.updateCustomStoreShowcaseCard(id, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateStoreShowcaseCard() {
  const invalidate = useInvalidateShowcase();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<StoreShowcaseCardInput> }) =>
      api.updateStoreShowcaseCard(id, payload),
    onSuccess: invalidate,
  });
}

export function useReorderStoreShowcaseCards() {
  const invalidate = useInvalidateShowcase();
  return useMutation({ mutationFn: api.reorderStoreShowcaseCards, onSuccess: invalidate });
}

export function useDeleteStoreShowcaseCard() {
  const invalidate = useInvalidateShowcase();
  return useMutation({ mutationFn: api.deleteStoreShowcaseCard, onSuccess: invalidate });
}
