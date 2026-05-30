import { apiClient } from "@/api/axios";
import type { TutorSearchOut } from "@/types";

export async function listBookmarks(): Promise<TutorSearchOut[]> {
  const { data } = await apiClient.get<TutorSearchOut[]>("/bookmarks");
  return data;
}

export async function addBookmark(tutorId: number): Promise<void> {
  await apiClient.put(`/bookmarks/${tutorId}`);
}

export async function removeBookmark(tutorId: number): Promise<void> {
  await apiClient.delete(`/bookmarks/${tutorId}`);
}
