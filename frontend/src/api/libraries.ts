import { apiClient } from "@/api/axios";
import type {
  LibraryDetailOut,
  LibraryReviewCreate,
  LibraryReviewOut,
  LibrarySearchOut,
  LibraryWrite,
} from "@/types";

export interface LibrarySearchParams {
  q?: string;
  amenities?: string[];
  lat?: number;
  lng?: number;
  radius_km?: number;
  sort?: "rating" | "distance";
  limit?: number;
  offset?: number;
}

export async function searchLibraries(
  params: LibrarySearchParams
): Promise<LibrarySearchOut[]> {
  const { data } = await apiClient.get<LibrarySearchOut[]>("/libraries", {
    params,
    // Dizi paramlar FastAPI'nin beklediği gibi tekrarlansın: amenities=wifi&amenities=...
    paramsSerializer: { indexes: null },
  });
  return data;
}

export async function fetchLibrary(idOrSlug: string | number): Promise<LibraryDetailOut> {
  const { data } = await apiClient.get<LibraryDetailOut>(`/libraries/${idOrSlug}`);
  return data;
}

/** Admin detay — GİZLİ kütüphaneleri de döndürür (public uç yalnız ACTIVE gösterir). */
export async function fetchLibraryAdmin(id: number): Promise<LibraryDetailOut> {
  const { data } = await apiClient.get<LibraryDetailOut>(`/libraries/admin/${id}`);
  return data;
}

export async function fetchLibraryReviews(
  libraryId: number
): Promise<LibraryReviewOut[]> {
  const { data } = await apiClient.get<LibraryReviewOut[]>(
    `/libraries/${libraryId}/reviews`
  );
  return data;
}

export async function createLibraryReview(
  libraryId: number,
  payload: LibraryReviewCreate
): Promise<LibraryReviewOut> {
  const { data } = await apiClient.post<LibraryReviewOut>(
    `/libraries/${libraryId}/reviews`,
    payload
  );
  return data;
}

export async function deleteLibraryReview(reviewId: number): Promise<void> {
  await apiClient.delete(`/libraries/reviews/${reviewId}`);
}

/* ── Admin küratör ── */

export async function listLibrariesAdmin(): Promise<LibrarySearchOut[]> {
  const { data } = await apiClient.get<LibrarySearchOut[]>("/libraries/admin");
  return data;
}

export async function createLibrary(payload: LibraryWrite): Promise<LibraryDetailOut> {
  const { data } = await apiClient.post<LibraryDetailOut>("/libraries", payload);
  return data;
}

export async function updateLibrary(
  id: number,
  payload: LibraryWrite
): Promise<LibraryDetailOut> {
  const { data } = await apiClient.patch<LibraryDetailOut>(`/libraries/${id}`, payload);
  return data;
}

export async function deleteLibrary(id: number): Promise<void> {
  await apiClient.delete(`/libraries/${id}`);
}

/* ── Admin görsel yönetimi (logo / banner / galeri) ── */

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

export async function uploadLibraryLogo(
  id: number,
  file: File
): Promise<LibraryDetailOut> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<LibraryDetailOut>(
    `/libraries/${id}/logo`,
    form,
    MULTIPART
  );
  return data;
}

export async function uploadLibraryCover(
  id: number,
  file: File
): Promise<LibraryDetailOut> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<LibraryDetailOut>(
    `/libraries/${id}/cover`,
    form,
    MULTIPART
  );
  return data;
}

export async function uploadLibraryImages(
  id: number,
  files: File[]
): Promise<LibraryDetailOut> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const { data } = await apiClient.post<LibraryDetailOut>(
    `/libraries/${id}/images`,
    form,
    MULTIPART
  );
  return data;
}

export async function deleteLibraryImage(
  id: number,
  imageId: number
): Promise<LibraryDetailOut> {
  const { data } = await apiClient.delete<LibraryDetailOut>(
    `/libraries/${id}/images/${imageId}`
  );
  return data;
}

export async function reorderLibraryImages(
  id: number,
  imageIds: number[]
): Promise<LibraryDetailOut> {
  const { data } = await apiClient.patch<LibraryDetailOut>(
    `/libraries/${id}/images/reorder`,
    { image_ids: imageIds }
  );
  return data;
}
