import { apiClient } from "@/api/axios";
import type {
  LandingPage,
  LandingPageCreate,
  LandingPagePublication,
  LandingPageRevision,
  LandingPageRevisionInput,
  LandingPageSummary,
  ProductAttributeDefinition,
  ProductSet,
  ProductSetInput,
  StoreMediaAsset,
  StorePageMetric,
} from "@/types";

export async function fetchLandingPage(slug: string): Promise<LandingPage> {
  const { data } = await apiClient.get<LandingPage>(`/store/pages/${slug}`);
  return data;
}

export async function fetchStoreHomePage(): Promise<LandingPage> {
  const { data } = await apiClient.get<LandingPage>("/store/home");
  return data;
}

export async function fetchStoreAttributes(admin = false): Promise<ProductAttributeDefinition[]> {
  const path = admin ? "/admin/store-merchandising/attributes" : "/store/attributes";
  const { data } = await apiClient.get<ProductAttributeDefinition[]>(path);
  return data;
}

export async function createStoreAttribute(payload: { name: string; sort_order: number; is_active: boolean }) {
  const { data } = await apiClient.post<ProductAttributeDefinition>("/admin/store-merchandising/attributes", payload);
  return data;
}

export async function createStoreAttributeValue(definitionId: number, payload: { label: string; sort_order: number; is_active: boolean }) {
  const { data } = await apiClient.post(`/admin/store-merchandising/attributes/${definitionId}/values`, payload);
  return data;
}

export async function setProductAttributes(productId: number, valueIds: number[]): Promise<void> {
  await apiClient.put(`/admin/store-merchandising/products/${productId}/attributes`, { value_ids: valueIds });
}

export async function fetchProductAttributeValueIds(productId: number): Promise<number[]> {
  const { data } = await apiClient.get<{ value_ids: number[] }>(`/admin/store-merchandising/products/${productId}/attributes`);
  return data.value_ids;
}

export async function fetchProductSets(): Promise<ProductSet[]> {
  const { data } = await apiClient.get<ProductSet[]>("/admin/store-merchandising/product-sets");
  return data;
}

export async function saveProductSet(payload: ProductSetInput, id?: number): Promise<ProductSet> {
  const { data } = id
    ? await apiClient.put<ProductSet>(`/admin/store-merchandising/product-sets/${id}`, payload)
    : await apiClient.post<ProductSet>("/admin/store-merchandising/product-sets", payload);
  return data;
}

export async function publishProductSet(id: number): Promise<ProductSet> {
  const { data } = await apiClient.post<ProductSet>(
    `/admin/store-merchandising/product-sets/${id}/publish`,
  );
  return data;
}

export async function fetchLandingPages(): Promise<LandingPageSummary[]> {
  const { data } = await apiClient.get<LandingPageSummary[]>("/admin/store-merchandising/pages");
  return data;
}

export async function createLandingPage(payload: LandingPageCreate): Promise<LandingPageSummary> {
  const { data } = await apiClient.post<LandingPageSummary>("/admin/store-merchandising/pages", payload);
  return data;
}

export async function saveLandingPageDraft(pageId: number, payload: LandingPageRevisionInput): Promise<LandingPageRevision> {
  const { data } = await apiClient.put<LandingPageRevision>(`/admin/store-merchandising/pages/${pageId}/draft`, payload);
  return data;
}

export async function previewLandingPage(pageId: number, revisionId: number): Promise<LandingPage> {
  const { data } = await apiClient.get<LandingPage>(`/admin/store-merchandising/pages/${pageId}/preview/${revisionId}`);
  return data;
}

export async function fetchLandingPageRevisions(pageId: number): Promise<LandingPageRevision[]> {
  const { data } = await apiClient.get<LandingPageRevision[]>(`/admin/store-merchandising/pages/${pageId}/revisions`);
  return data;
}

export async function publishLandingPage(pageId: number, startsAt: string, endsAt?: string | null): Promise<LandingPageSummary> {
  const { data } = await apiClient.post<LandingPageSummary>(
    `/admin/store-merchandising/pages/${pageId}/publish`,
    { starts_at: startsAt, ends_at: endsAt || null },
  );
  return data;
}

export async function duplicateLandingPage(
  pageId: number,
  payload: { internal_name: string; slug: string },
): Promise<LandingPageSummary> {
  const { data } = await apiClient.post<LandingPageSummary>(
    `/admin/store-merchandising/pages/${pageId}/duplicate`,
    payload,
  );
  return data;
}

export async function previewLatestLandingPage(pageId: number): Promise<LandingPage> {
  const { data } = await apiClient.get<LandingPage>(
    `/admin/store-merchandising/pages/${pageId}/preview`,
  );
  return data;
}

export async function fetchLandingPagePublications(
  pageId: number,
): Promise<LandingPagePublication[]> {
  const { data } = await apiClient.get<LandingPagePublication[]>(
    `/admin/store-merchandising/pages/${pageId}/publications`,
  );
  return data;
}

export async function rescheduleLandingPagePublication(
  pageId: number,
  publicationId: number,
  payload: { starts_at: string; ends_at?: string | null },
): Promise<LandingPagePublication> {
  const { data } = await apiClient.patch<LandingPagePublication>(
    `/admin/store-merchandising/pages/${pageId}/publications/${publicationId}`,
    payload,
  );
  return data;
}

export async function cancelLandingPagePublication(
  pageId: number,
  publicationId: number,
): Promise<void> {
  await apiClient.delete(
    `/admin/store-merchandising/pages/${pageId}/publications/${publicationId}`,
  );
}

export async function updateLandingPageIdentity(
  pageId: number,
  payload: { internal_name?: string; slug?: string; is_archived?: boolean },
): Promise<LandingPageSummary> {
  const { data } = await apiClient.patch<LandingPageSummary>(`/admin/store-merchandising/pages/${pageId}`, payload);
  return data;
}

export async function fetchStorePageMetrics(): Promise<StorePageMetric[]> {
  const { data } = await apiClient.get<StorePageMetric[]>("/admin/store-merchandising/metrics");
  return data;
}

export async function fetchStoreMedia(): Promise<StoreMediaAsset[]> {
  const { data } = await apiClient.get<StoreMediaAsset[]>("/admin/store-merchandising/media");
  return data;
}

export async function uploadStoreMedia(image: File, altText: string): Promise<StoreMediaAsset> {
  const form = new FormData();
  form.append("image", image);
  form.append("alt_text", altText);
  const { data } = await apiClient.post<StoreMediaAsset>(
    "/admin/store-merchandising/media",
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function recordStorePageEvent(
  revisionId: number,
  event: { event_type: "PAGE_VIEW" | "BLOCK_CLICK" | "PRODUCT_CLICK"; block_key?: string; product_id?: number },
): Promise<void> {
  const { data } = await apiClient.post<{ attribution_token?: string | null }>(
    `/store/page-revisions/${revisionId}/events`,
    event,
  );
  if (data.attribution_token) {
    sessionStorage.setItem("store-attribution", data.attribution_token);
  }
}

export function currentStoreAttribution(): string | null {
  return sessionStorage.getItem("store-attribution");
}
