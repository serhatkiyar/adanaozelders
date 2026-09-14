import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createBlogPost,
  deleteBlogPost,
  fetchAdminBlogPosts,
  fetchBlogPost,
  fetchBlogPosts,
  publishBlogPost,
  unpublishBlogPost,
  updateBlogPost,
} from "@/api/blog";
import type { BlogPostInput } from "@/types";

const PUBLIC_KEY = ["blog"] as const;
const ADMIN_KEY = ["admin", "blog"] as const;

export function useBlogPosts(params: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: [...PUBLIC_KEY, "list", params],
    queryFn: () => fetchBlogPosts(params),
  });
}

export function useBlogPost(slug: string | undefined) {
  return useQuery({
    queryKey: [...PUBLIC_KEY, "post", slug],
    queryFn: () => fetchBlogPost(slug as string),
    enabled: Boolean(slug),
    retry: false,
  });
}

export function useAdminBlogPosts(enabled = true) {
  return useQuery({ queryKey: [...ADMIN_KEY, "posts"], queryFn: fetchAdminBlogPosts, enabled });
}

function useInvalidateBlog() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ADMIN_KEY });
    void qc.invalidateQueries({ queryKey: PUBLIC_KEY });
  };
}

export function useCreateBlogPost() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: (payload: BlogPostInput) => createBlogPost(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateBlogPost() {
  const invalidate = useInvalidateBlog();
  return useMutation({
    mutationFn: ({ postId, payload }: { postId: number; payload: BlogPostInput }) =>
      updateBlogPost(postId, payload),
    onSuccess: invalidate,
  });
}

export function usePublishBlogPost() {
  const invalidate = useInvalidateBlog();
  return useMutation({ mutationFn: publishBlogPost, onSuccess: invalidate });
}

export function useUnpublishBlogPost() {
  const invalidate = useInvalidateBlog();
  return useMutation({ mutationFn: unpublishBlogPost, onSuccess: invalidate });
}

export function useDeleteBlogPost() {
  const invalidate = useInvalidateBlog();
  return useMutation({ mutationFn: deleteBlogPost, onSuccess: invalidate });
}
