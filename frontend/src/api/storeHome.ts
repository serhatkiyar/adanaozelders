import { apiClient } from "@/api/axios";
import type {
  StoreHomeFeed,
  StoreHomeImageSectionInput,
  StoreHomeSection,
  StoreHomeProductSectionInput,
} from "@/types";

export async function fetchStoreHome(): Promise<StoreHomeFeed> {
  const { data } = await apiClient.get<StoreHomeFeed>("/store/home-sections");
  return data;
}

export async function fetchAdminStoreHome(): Promise<StoreHomeSection[]> {
  const { data } = await apiClient.get<StoreHomeSection[]>("/admin/store-home-sections");
  return data;
}

export async function createProductSection(
  payload: StoreHomeProductSectionInput,
): Promise<StoreHomeSection> {
  const { data } = await apiClient.post<StoreHomeSection>(
    "/admin/store-home-sections/products",
    payload,
  );
  return data;
}

export async function updateProductSection(
  id: number,
  payload: StoreHomeProductSectionInput,
): Promise<StoreHomeSection> {
  const { data } = await apiClient.put<StoreHomeSection>(
    `/admin/store-home-sections/${id}/products`,
    payload,
  );
  return data;
}

function imageSectionForm(payload: StoreHomeImageSectionInput, editing: boolean): FormData {
  const form = new FormData();
  const tileMeta = payload.tiles.map(({ file, existing_index, ...tile }) => {
    if (!editing) {
      if (file) form.append("images", file);
      return tile;
    }
    if (file) {
      const file_index = Array.from(form.getAll("images")).length;
      form.append("images", file);
      return { ...tile, existing_index: null, file_index };
    }
    return { ...tile, existing_index, file_index: null };
  });
  form.append("tiles_json", JSON.stringify(tileMeta));
  form.append("title", payload.title);
  form.append("description", payload.description);
  form.append("link_url", payload.link_url ?? "");
  form.append("link_label", payload.link_label);
  form.append("is_active", String(payload.is_active));
  form.append("sort_order", String(payload.sort_order));
  return form;
}

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

export async function createImageSection(
  payload: StoreHomeImageSectionInput,
): Promise<StoreHomeSection> {
  const { data } = await apiClient.post<StoreHomeSection>(
    "/admin/store-home-sections/images",
    imageSectionForm(payload, false),
    MULTIPART,
  );
  return data;
}

export async function updateImageSection(
  id: number,
  payload: StoreHomeImageSectionInput,
): Promise<StoreHomeSection> {
  const { data } = await apiClient.put<StoreHomeSection>(
    `/admin/store-home-sections/${id}/images`,
    imageSectionForm(payload, true),
    MULTIPART,
  );
  return data;
}

export async function reorderSections(orderedIds: number[]): Promise<StoreHomeSection[]> {
  const { data } = await apiClient.patch<StoreHomeSection[]>(
    "/admin/store-home-sections/reorder",
    { ordered_ids: orderedIds },
  );
  return data;
}

export async function updateRecentlyViewedSection(
  id: number,
  isActive: boolean,
): Promise<StoreHomeSection> {
  const { data } = await apiClient.patch<StoreHomeSection>(
    `/admin/store-home-sections/${id}/recently-viewed`,
    { is_active: isActive },
  );
  return data;
}

export async function deleteSection(id: number): Promise<void> {
  await apiClient.delete(`/admin/store-home-sections/${id}`);
}
