import { apiClient } from "@/api/axios";
import type { LibrarySearchOut } from "@/types";

export async function listLibraryBookmarks(): Promise<LibrarySearchOut[]> {
  const { data } = await apiClient.get<LibrarySearchOut[]>("/library-bookmarks");
  return data;
}

export async function addLibraryBookmark(libraryId: number): Promise<void> {
  await apiClient.put(`/library-bookmarks/${libraryId}`);
}

export async function removeLibraryBookmark(libraryId: number): Promise<void> {
  await apiClient.delete(`/library-bookmarks/${libraryId}`);
}
