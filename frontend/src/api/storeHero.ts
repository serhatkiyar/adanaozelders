import { apiClient } from "@/api/axios";
import type {
  StoreHeroSlide,
  StoreHeroSlidePublic,
  StoreHeroSlideUpdate,
} from "@/types";

export interface StoreHeroSlideCreateInput {
  image: File;
  mobileImage?: File | null;
  altText?: string;
  linkUrl?: string | null;
  isActive?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
}

export async function fetchStoreHeroSlides(): Promise<StoreHeroSlidePublic[]> {
  const { data } = await apiClient.get<StoreHeroSlidePublic[]>("/store/hero-slides");
  return data;
}

export async function fetchAdminStoreHeroSlides(): Promise<StoreHeroSlide[]> {
  const { data } = await apiClient.get<StoreHeroSlide[]>("/admin/store-hero-slides");
  return data;
}

export async function createStoreHeroSlide(
  input: StoreHeroSlideCreateInput
): Promise<StoreHeroSlide> {
  const form = new FormData();
  form.append("image", input.image);
  if (input.mobileImage) form.append("mobile_image", input.mobileImage);
  form.append("alt_text", input.altText ?? "");
  if (input.linkUrl) form.append("link_url", input.linkUrl);
  form.append("is_active", String(input.isActive ?? false));
  if (input.startsAt) form.append("starts_at", input.startsAt);
  if (input.endsAt) form.append("ends_at", input.endsAt);
  form.append("sort_order", String(input.sortOrder ?? 0));
  const { data } = await apiClient.post<StoreHeroSlide>(
    "/admin/store-hero-slides",
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return data;
}

export async function updateStoreHeroSlide(
  id: number,
  payload: StoreHeroSlideUpdate
): Promise<StoreHeroSlide> {
  const { data } = await apiClient.patch<StoreHeroSlide>(
    `/admin/store-hero-slides/${id}`,
    payload
  );
  return data;
}

export async function replaceStoreHeroSlideImage(
  id: number,
  slot: "desktop" | "mobile",
  file: File
): Promise<StoreHeroSlide> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<StoreHeroSlide>(
    `/admin/store-hero-slides/${id}/image`,
    form,
    { params: { slot }, headers: { "Content-Type": "multipart/form-data" } }
  );
  return data;
}

export async function clearStoreHeroMobileImage(id: number): Promise<StoreHeroSlide> {
  const { data } = await apiClient.delete<StoreHeroSlide>(
    `/admin/store-hero-slides/${id}/mobile-image`
  );
  return data;
}

export async function reorderStoreHeroSlides(orderedIds: number[]): Promise<StoreHeroSlide[]> {
  const { data } = await apiClient.patch<StoreHeroSlide[]>(
    "/admin/store-hero-slides/reorder",
    { ordered_ids: orderedIds }
  );
  return data;
}

export async function deleteStoreHeroSlide(id: number): Promise<void> {
  await apiClient.delete(`/admin/store-hero-slides/${id}`);
}
