import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { yayinDinle, yayinDuyur } from "@/lib/storefrontBroadcast";

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
  updateLandingPageIdentity,
  uploadStoreMedia,
} from "@/api/storeMerchandising";
import type { ProductSetInput } from "@/types";

const ADMIN_KEY = ["admin", "store", "merchandising"] as const;

export function useLandingPage(slug: string) {
  return useQuery({ queryKey: ["store", "page", slug], queryFn: () => fetchLandingPage(slug), enabled: Boolean(slug) });
}

export function useStoreHomePage() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      yayinDinle(() => {
        void queryClient.invalidateQueries({ queryKey: ["store", "home"] });
      }),
    [queryClient],
  );
  return useQuery({
    queryKey: ["store", "home"],
    queryFn: fetchStoreHomePage,
    // HEDEFLENMİŞ ayar: global `refetchOnWindowFocus: false` DEĞİŞTİRİLMEDİ
    // (bir vitrin ihtiyacı için bütün uygulamanın ağ davranışı ölçülmemiş
    // biçimde değişmemeli). Yayınlanan içeriğin açık bir sekmede süresiz
    // eski kalmaması ise gerçek bir kusurdu.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
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
  /**
   * TASLAK tarafı: yalnız yönetim önbelleği tazelenir.
   *
   * Eskiden ortak bir `refresh()` her mutasyonda public `["store","home"]` ve
   * `["store","page"]` anahtarlarını da geçersiz kılıyordu — yani 900 ms'de
   * bir çalışabilen taslak kaydı mağaza vitrininin public önbelleğini
   * tazeliyordu. Hem boşuna istek hem kavramsal karışıklık: taslak canlıyı
   * DEĞİŞTİRMEZ.
   */
  const refreshDraft = () => {
    void queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
  };
  /** YAYIN tarafı: canlı vitrin gerçekten değişti; public önbellek de gider
   *  ve aynı tarayıcıdaki açık mağaza sekmelerine duyurulur. */
  const refreshPublished = () => {
    refreshDraft();
    void queryClient.invalidateQueries({ queryKey: ["store", "home"] });
    void queryClient.invalidateQueries({ queryKey: ["store", "page"] });
    yayinDuyur();
  };
  return {
    createAttribute: useMutation({ mutationFn: createStoreAttribute, onSuccess: refreshDraft }),
    createAttributeValue: useMutation({ mutationFn: ({ definitionId, ...payload }: { definitionId: number; label: string; sort_order: number; is_active: boolean }) => createStoreAttributeValue(definitionId, payload), onSuccess: refreshDraft }),
    saveProductSet: useMutation({ mutationFn: ({ payload, id }: { payload: ProductSetInput; id?: number }) => saveProductSet(payload, id), onSuccess: refreshDraft }),
    publishProductSet: useMutation({ mutationFn: publishProductSet, onSuccess: refreshPublished }),
    createPage: useMutation({ mutationFn: createLandingPage, onSuccess: refreshDraft }),
    // Kimlik (ad · adres · arşiv) PUBLIC yüzeyi değiştirir: slug değişince
    // sayfanın adresi, arşivlenince görünürlüğü değişir. Bu yüzden taslak
    // tarafına değil YAYIN tarafına bağlı.
    updatePageIdentity: useMutation({
      mutationFn: ({
        pageId,
        payload,
      }: {
        pageId: number;
        payload: { internal_name?: string; slug?: string; is_archived?: boolean };
      }) => updateLandingPageIdentity(pageId, payload),
      onSuccess: refreshPublished,
    }),
    duplicatePage: useMutation({
      mutationFn: ({ pageId, internalName, slug }: { pageId: number; internalName: string; slug: string }) =>
        duplicateLandingPage(pageId, { internal_name: internalName, slug }),
      onSuccess: refreshDraft,
    }),
    saveDraft: useMutation({ mutationFn: ({ pageId, payload }: { pageId: number; payload: Parameters<typeof saveLandingPageDraft>[1] }) => saveLandingPageDraft(pageId, payload), onSuccess: refreshDraft }),
    publishPage: useMutation({ mutationFn: ({ pageId, startsAt, endsAt }: { pageId: number; startsAt: string; endsAt?: string | null }) => publishLandingPage(pageId, startsAt, endsAt), onSuccess: refreshPublished }),
    reschedulePublication: useMutation({
      mutationFn: ({ pageId, publicationId, startsAt, endsAt }: { pageId: number; publicationId: number; startsAt: string; endsAt?: string | null }) =>
        rescheduleLandingPagePublication(pageId, publicationId, { starts_at: startsAt, ends_at: endsAt }),
      onSuccess: refreshPublished,
    }),
    cancelPublication: useMutation({
      mutationFn: ({ pageId, publicationId }: { pageId: number; publicationId: number }) =>
        cancelLandingPagePublication(pageId, publicationId),
      onSuccess: refreshPublished,
    }),
    uploadMedia: useMutation({ mutationFn: ({ image, altText }: { image: File; altText: string }) => uploadStoreMedia(image, altText), onSuccess: refreshDraft }),
  };
}
