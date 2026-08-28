/**
 * Mağaza yönetimi hook'larının KALAN kısmı (manuel vitrin kararı):
 * medya (blog kapak yüklemesi) + ürün öznitelikleri. Vitrin/landing/koleksiyon
 * hook'ları söküldü — vitrin kodda yaşar (pages/store/vitrin/).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createStoreAttribute,
  createStoreAttributeValue,
  fetchStoreAttributes,
  fetchStoreMedia,
  uploadStoreMedia,
} from "@/api/storeMerchandising";

const ADMIN_KEY = ["admin", "store", "merchandising"] as const;

export function useStoreAttributes(admin = false) {
  return useQuery({ queryKey: [admin ? "admin" : "store", "attributes"], queryFn: () => fetchStoreAttributes(admin) });
}

export function useStoreMedia() {
  return useQuery({ queryKey: [...ADMIN_KEY, "media"], queryFn: fetchStoreMedia });
}

/** Blog kapak yükleyicisi — kütüphane listesini tazeler. */
export function useUploadStoreMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ image, altText }: { image: File; altText: string }) =>
      uploadStoreMedia(image, altText),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...ADMIN_KEY, "media"] }),
  });
}

export function useMerchandisingMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
    void queryClient.invalidateQueries({ queryKey: ["admin", "attributes"] });
  };
  return {
    createAttribute: useMutation({ mutationFn: createStoreAttribute, onSuccess: refresh }),
    createAttributeValue: useMutation({
      mutationFn: ({ definitionId, ...payload }: { definitionId: number; label: string; sort_order: number; is_active: boolean }) =>
        createStoreAttributeValue(definitionId, payload),
      onSuccess: refresh,
    }),
  };
}
