import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createLibrary,
  createLibraryReview,
  deleteLibrary,
  deleteLibraryReview,
  fetchLibrary,
  fetchLibraryReviews,
  listLibrariesAdmin,
  searchLibraries,
  updateLibrary,
  type LibrarySearchParams,
} from "@/api/libraries";
import type { LibraryReviewCreate, LibraryWrite } from "@/types";

export function useLibrarySearch(params: LibrarySearchParams) {
  return useQuery({
    queryKey: ["libraries", "search", params],
    queryFn: () => searchLibraries(params),
    placeholderData: keepPreviousData,
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

export function useCreateLibraryReview(libraryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: LibraryReviewCreate) =>
      createLibraryReview(libraryId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["libraries", "reviews", libraryId] });
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
