import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addLibraryBookmark,
  listLibraryBookmarks,
  removeLibraryBookmark,
} from "@/api/libraryBookmarks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROLE_IDS } from "@/types";

export function useLibraryBookmarks() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: ["library-bookmarks"],
    queryFn: listLibraryBookmarks,
    enabled: user?.role_id === ROLE_IDS.CLIENT,
  });
}

export function useToggleLibraryBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      libraryId,
      bookmarked,
    }: {
      libraryId: number;
      bookmarked: boolean;
    }) =>
      bookmarked ? removeLibraryBookmark(libraryId) : addLibraryBookmark(libraryId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["library-bookmarks"] }),
  });
}
