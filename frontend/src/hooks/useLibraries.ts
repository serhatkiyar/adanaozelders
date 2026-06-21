import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  approveLibrary,
  createLibrary,
  createLibraryReview,
  deleteLibrary,
  deleteLibraryImage,
  deleteLibraryReview,
  fetchLibrary,
  fetchLibraryAdmin,
  fetchLibraryDistricts,
  fetchLibraryEarnings,
  fetchLibraryEarningsTransactions,
  fetchLibraryRatingDistribution,
  fetchLibraryReviews,
  listLibrariesAdmin,
  rejectLibrary,
  reorderLibraryImages,
  resubmitLibrary,
  searchLibraries,
  updateLibrary,
  uploadLibraryCover,
  uploadLibraryImages,
  uploadLibraryLogo,
  type LibrarySearchParams,
} from "@/api/libraries";
import type { LibraryDetailOut, LibraryReviewCreate, LibraryWrite } from "@/types";

export function useLibrarySearch(params: LibrarySearchParams) {
  return useQuery({
    queryKey: ["libraries", "search", params],
    queryFn: () => searchLibraries(params),
    placeholderData: keepPreviousData,
  });
}

/** İlçe filtresi dropdown'ı için ilçe listesi (nadiren değişir → uzun staleTime). */
export function useLibraryDistricts() {
  return useQuery({
    queryKey: ["libraries", "districts"],
    queryFn: fetchLibraryDistricts,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLibraryDetail(idOrSlug: string | number | undefined) {
  return useQuery({
    queryKey: ["libraries", "detail", idOrSlug],
    queryFn: () => fetchLibrary(idOrSlug!),
    enabled: idOrSlug !== undefined && idOrSlug !== "",
  });
}

export function useLibraryReviews(libraryId: number | undefined) {
  return useQuery({
    queryKey: ["libraries", "reviews", libraryId],
    queryFn: () => fetchLibraryReviews(libraryId!),
    enabled: Number.isFinite(libraryId) && (libraryId ?? 0) > 0,
  });
}

export function useLibraryRatingDistribution(libraryId: number | undefined) {
  return useQuery({
    queryKey: ["libraries", "reviews", "distribution", libraryId],
    queryFn: () => fetchLibraryRatingDistribution(libraryId!),
    enabled: Number.isFinite(libraryId) && (libraryId ?? 0) > 0,
  });
}

export function useCreateLibraryReview(libraryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: LibraryReviewCreate) =>
      createLibraryReview(libraryId, payload),
    onSuccess: () => {
      // ["libraries","reviews"] öneki hem liste hem dağılım sorgularını kapsar.
      qc.invalidateQueries({ queryKey: ["libraries", "reviews"] });
      qc.invalidateQueries({ queryKey: ["libraries", "detail"] });
      qc.invalidateQueries({ queryKey: ["libraries", "search"] });
    },
  });
}

export function useDeleteLibraryReview(libraryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: number) => deleteLibraryReview(reviewId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["libraries", "reviews", libraryId] });
      qc.invalidateQueries({
        queryKey: ["libraries", "reviews", "distribution", libraryId],
      });
      qc.invalidateQueries({ queryKey: ["libraries", "detail"] });
    },
  });
}

/* ── Admin ── */

export function useAdminLibraries() {
  return useQuery({
    queryKey: ["libraries", "admin"],
    queryFn: listLibrariesAdmin,
  });
}

/** Kütüphane escrow kazanç özeti (operatör/admin). */
export function useLibraryEarnings(libraryId: number | undefined) {
  return useQuery({
    queryKey: ["libraries", "earnings", libraryId],
    queryFn: () => fetchLibraryEarnings(libraryId!),
    enabled: Number.isFinite(libraryId) && (libraryId ?? 0) > 0,
  });
}

export function useLibraryEarningsTransactions(libraryId: number | undefined) {
  return useQuery({
    queryKey: ["libraries", "earnings", "transactions", libraryId],
    queryFn: () => fetchLibraryEarningsTransactions(libraryId!),
    enabled: Number.isFinite(libraryId) && (libraryId ?? 0) > 0,
  });
}

/** Admin düzenleme detayı — GİZLİ kütüphaneleri de getirir. */
export function useLibraryAdminDetail(id: number | undefined) {
  return useQuery({
    queryKey: ["libraries", "adminDetail", id],
    queryFn: () => fetchLibraryAdmin(id!),
    enabled: Number.isFinite(id) && (id ?? 0) > 0,
  });
}

export function useCreateLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: LibraryWrite) => createLibrary(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["libraries"] });
    },
  });
}

export function useUpdateLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: LibraryWrite }) =>
      updateLibrary(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["libraries"] });
    },
  });
}

export function useDeleteLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteLibrary(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["libraries"] });
    },
  });
}

/** Admin: self-servis başvuruyu onayla (→ ACTIVE). */
export function useApproveLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => approveLibrary(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["libraries"] }),
  });
}

/** Admin: self-servis başvuruyu reddet (→ REJECTED + gerekçe). */
export function useRejectLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string | null }) =>
      rejectLibrary(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["libraries"] }),
  });
}

/** Operatör: reddedilen başvuruyu düzeltip tekrar gönder (→ PENDING). */
export function useResubmitLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => resubmitLibrary(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["libraries"] }),
  });
}

/* ── Admin görsel yönetimi (logo / banner / galeri) ── */

export function useLibraryMedia(libraryId: number) {
  const qc = useQueryClient();
  const onSuccess = (fresh: LibraryDetailOut) => {
    // Editör (admin detay) anında güncel görselleri görsün + liste/public detay tazelensin.
    qc.setQueryData(["libraries", "adminDetail", libraryId], fresh);
    qc.setQueryData(["libraries", "detail", libraryId], fresh);
    qc.invalidateQueries({ queryKey: ["libraries"] });
  };

  const uploadLogo = useMutation({
    mutationFn: (file: File) => uploadLibraryLogo(libraryId, file),
    onSuccess,
  });
  const uploadCover = useMutation({
    mutationFn: (file: File) => uploadLibraryCover(libraryId, file),
    onSuccess,
  });
  const uploadImages = useMutation({
    mutationFn: (files: File[]) => uploadLibraryImages(libraryId, files),
    onSuccess,
  });
  const removeImage = useMutation({
    mutationFn: (imageId: number) => deleteLibraryImage(libraryId, imageId),
    onSuccess,
  });
  const reorder = useMutation({
    mutationFn: (imageIds: number[]) => reorderLibraryImages(libraryId, imageIds),
    onSuccess,
  });

  return { uploadLogo, uploadCover, uploadImages, removeImage, reorder };
}
