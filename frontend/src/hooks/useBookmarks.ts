import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addBookmark, listBookmarks, removeBookmark } from "@/api/bookmarks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROLE_IDS } from "@/types";

export function useBookmarks() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: ["bookmarks"],
    queryFn: listBookmarks,
    enabled: user?.role_id === ROLE_IDS.CLIENT,
  });
}

export function useToggleBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tutorId, bookmarked }: { tutorId: number; bookmarked: boolean }) =>
      bookmarked ? removeBookmark(tutorId) : addBookmark(tutorId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["bookmarks"] }),
  });
}
