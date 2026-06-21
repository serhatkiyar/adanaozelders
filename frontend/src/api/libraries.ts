import { apiClient } from "@/api/axios";
import type {
  EarningTransaction,
  LibraryDetailOut,
  LibraryDistrictOut,
  LibraryEarningsOut,
  LibraryRegisterPayload,
  LibraryReviewCreate,
  LibraryReviewOut,
  LibrarySearchOut,
  LibraryWrite,
  PayoutOut,
  RatingDistribution,
  Token,
} from "@/types";

export interface LibraryPayoutSubmit {
  iban: string;
  tckn: string;
  gsm?: string | null;
  contact_name: string;
  contact_email: string;
}

export async function fetchLibraryPayout(id: number): Promise<PayoutOut> {
  const { data } = await apiClient.get<PayoutOut>(`/libraries/admin/${id}/payout`);
  return data;
}

export async function submitLibraryPayout(
  id: number,
  payload: LibraryPayoutSubmit
): Promise<PayoutOut> {
  const { data } = await apiClient.post<PayoutOut>(
    `/libraries/admin/${id}/payout`,
    payload
  );
  return data;
}

/** Self-servis kayıt: operatör hesabı + PENDING kütüphane oluşturur, token döner. */
export async function registerLibrary(payload: LibraryRegisterPayload): Promise<Token> {
  const { data } = await apiClient.post<Token>("/libraries/register", payload);
  return data;
}

/** Admin: bekleyen başvuruyu onayla (→ ACTIVE). */
export async function approveLibrary(id: number): Promise<LibraryDetailOut> {
  const { data } = await apiClient.post<LibraryDetailOut>(`/libraries/${id}/approve`);
  return data;
}

/** Admin: bekleyen başvuruyu reddet (→ REJECTED + gerekçe). */
export async function rejectLibrary(
  id: number,
  reason?: string | null
): Promise<LibraryDetailOut> {
  const { data } = await apiClient.post<LibraryDetailOut>(`/libraries/${id}/reject`, {
    reason: reason ?? null,
  });
  return data;
}

/** Operatör: reddedilen başvuruyu düzeltip tekrar gönder (→ PENDING). */
export async function resubmitLibrary(id: number): Promise<LibraryDetailOut> {
  const { data } = await apiClient.post<LibraryDetailOut>(`/libraries/${id}/resubmit`);
  return data;
}

export interface LibrarySearchParams {
  q?: string;
  amenities?: string[];
  district?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  sort?: "rating" | "distance";
  limit?: number;
  offset?: number;
}

/** İlçe filtresi dropdown'ı için: aktif kütüphanesi olan ilçeler + sayıları. */
export async function fetchLibraryDistricts(): Promise<LibraryDistrictOut[]> {
  const { data } = await apiClient.get<LibraryDistrictOut[]>("/libraries/districts");
  return data;
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

export async function fetchLibraryRatingDistribution(
  libraryId: number
): Promise<RatingDistribution> {
  const { data } = await apiClient.get<RatingDistribution>(
    `/libraries/${libraryId}/reviews/distribution`
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

export async function fetchLibraryEarnings(
  libraryId: number
): Promise<LibraryEarningsOut> {
  const { data } = await apiClient.get<LibraryEarningsOut>(
    `/libraries/${libraryId}/earnings`
  );
  return data;
}

export async function fetchLibraryEarningsTransactions(
  libraryId: number
): Promise<EarningTransaction[]> {
  const { data } = await apiClient.get<EarningTransaction[]>(
    `/libraries/${libraryId}/earnings/transactions`
  );
  return data;
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
