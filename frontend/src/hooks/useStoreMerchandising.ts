import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createLandingPage,
  createStoreAttribute,
  createStoreAttributeValue,
  cancelLandingPagePublication,
  duplicateLandingPage,
  fetchLandingPage,
  fetchLandingPagePublications,
  fetchLandingPages,
  fetchLandingPageRevisions,
  fetchProductSets,
  fetchStoreAttributes,
  fetchStoreHomePage,
  fetchStoreMedia,
  fetchStorePageMetrics,
  publishLandingPage,
  publishProductSet,
  rescheduleLandingPagePublication,
  saveLandingPageDraft,
  saveProductSet,
  uploadStoreMedia,
} from "@/api/storeMerchandising";
import type { ProductSetInput } from "@/types";

const ADMIN_KEY = ["admin", "store", "merchandising"] as const;

export function useLandingPage(slug: string) {
  return useQuery({ queryKey: ["store", "page", slug], queryFn: () => fetchLandingPage(slug), enabled: Boolean(slug) });
}

export function useStoreHomePage() {
  return useQuery({ queryKey: ["store", "home"], queryFn: fetchStoreHomePage });
}

export function useStoreAttributes(admin = false) {
  return useQuery({ queryKey: [admin ? "admin" : "store", "attributes"], queryFn: () => fetchStoreAttributes(admin) });
}

export function useProductSets() {
  return useQuery({ queryKey: [...ADMIN_KEY, "product-sets"], queryFn: fetchProductSets });
}

export function useLandingPages() {
  return useQuery({ queryKey: [...ADMIN_KEY, "pages"], queryFn: fetchLandingPages });
}

export function useLandingPageRevisions(pageId?: number) {
  return useQuery({ queryKey: [...ADMIN_KEY, "pages", pageId, "revisions"], queryFn: () => fetchLandingPageRevisions(pageId!), enabled: Boolean(pageId) });
}

export function useLandingPagePublications(pageId?: number) {
  return useQuery({
    queryKey: [...ADMIN_KEY, "pages", pageId, "publications"],
    queryFn: () => fetchLandingPagePublications(pageId!),
    enabled: Boolean(pageId),
  });
}

export function useStoreMedia() {
  return useQuery({ queryKey: [...ADMIN_KEY, "media"], queryFn: fetchStoreMedia });
}

export function useStorePageMetrics() {
  return useQuery({ queryKey: [...ADMIN_KEY, "metrics"], queryFn: fetchStorePageMetrics });
}

export function useMerchandisingMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
    void queryClient.invalidateQueries({ queryKey: ["store", "home"] });
    void queryClient.invalidateQueries({ queryKey: ["store", "page"] });
  };
  return {
    createAttribute: useMutation({ mutationFn: createStoreAttribute, onSuccess: refresh }),
    createAttributeValue: useMutation({ mutationFn: ({ definitionId, ...payload }: { definitionId: number; label: string; sort_order: number; is_active: boolean }) => createStoreAttributeValue(definitionId, payload), onSuccess: refresh }),
    saveProductSet: useMutation({ mutationFn: ({ payload, id }: { payload: ProductSetInput; id?: number }) => saveProductSet(payload, id), onSuccess: refresh }),
    publishProductSet: useMutation({ mutationFn: publishProductSet, onSuccess: refresh }),
    createPage: useMutation({ mutationFn: createLandingPage, onSuccess: refresh }),
    duplicatePage: useMutation({
      mutationFn: ({ pageId, internalName, slug }: { pageId: number; internalName: string; slug: string }) =>
        duplicateLandingPage(pageId, { internal_name: internalName, slug }),
      onSuccess: refresh,
    }),
    saveDraft: useMutation({ mutationFn: ({ pageId, payload }: { pageId: number; payload: Parameters<typeof saveLandingPageDraft>[1] }) => saveLandingPageDraft(pageId, payload), onSuccess: refresh }),
    publishPage: useMutation({ mutationFn: ({ pageId, startsAt, endsAt }: { pageId: number; startsAt: string; endsAt?: string | null }) => publishLandingPage(pageId, startsAt, endsAt), onSuccess: refresh }),
    reschedulePublication: useMutation({
      mutationFn: ({ pageId, publicationId, startsAt, endsAt }: { pageId: number; publicationId: number; startsAt: string; endsAt?: string | null }) =>
        rescheduleLandingPagePublication(pageId, publicationId, { starts_at: startsAt, ends_at: endsAt }),
      onSuccess: refresh,
    }),
    cancelPublication: useMutation({
      mutationFn: ({ pageId, publicationId }: { pageId: number; publicationId: number }) =>
        cancelLandingPagePublication(pageId, publicationId),
      onSuccess: refresh,
    }),
    uploadMedia: useMutation({ mutationFn: ({ image, altText }: { image: File; altText: string }) => uploadStoreMedia(image, altText), onSuccess: refresh }),
  };
}
