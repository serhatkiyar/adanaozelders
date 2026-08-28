import { apiClient } from "@/api/axios";
import type {
  BlogPostAdmin,
  BlogPostInput,
  BlogPostList,
  BlogPostPublic,
} from "@/types";

// ── Public ──

export async function fetchBlogPosts(params: { limit?: number; offset?: number } = {}): Promise<BlogPostList> {
  const { data } = await apiClient.get<BlogPostList>("/blog/posts", { params });
  return data;
}

export async function fetchBlogPost(slug: string): Promise<BlogPostPublic> {
  const { data } = await apiClient.get<BlogPostPublic>(`/blog/posts/${slug}`);
  return data;
}

// ── Admin (content.*) ──

export async function fetchAdminBlogPosts(): Promise<BlogPostAdmin[]> {
  const { data } = await apiClient.get<BlogPostAdmin[]>("/admin/blog/posts");
  return data;
}

export async function createBlogPost(payload: BlogPostInput): Promise<BlogPostAdmin> {
  const { data } = await apiClient.post<BlogPostAdmin>("/admin/blog/posts", payload);
  return data;
}

export async function updateBlogPost(postId: number, payload: BlogPostInput): Promise<BlogPostAdmin> {
  const { data } = await apiClient.put<BlogPostAdmin>(`/admin/blog/posts/${postId}`, payload);
  return data;
}

export async function publishBlogPost(postId: number): Promise<BlogPostAdmin> {
  const { data } = await apiClient.post<BlogPostAdmin>(`/admin/blog/posts/${postId}/publish`);
  return data;
}

export async function unpublishBlogPost(postId: number): Promise<BlogPostAdmin> {
  const { data } = await apiClient.post<BlogPostAdmin>(`/admin/blog/posts/${postId}/unpublish`);
  return data;
}

export async function deleteBlogPost(postId: number): Promise<void> {
  await apiClient.delete(`/admin/blog/posts/${postId}`);
}
