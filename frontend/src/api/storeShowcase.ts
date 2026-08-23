import { apiClient } from "@/api/axios";
import type {
  StoreShowcaseCard,
  StoreShowcaseCardInput,
  StoreShowcaseCustomCardInput,
  StoreShowcaseFeed,
} from "@/types";

export async function fetchStoreShowcase(): Promise<StoreShowcaseFeed> {
  const { data } = await apiClient.get<StoreShowcaseFeed>("/store/showcase-cards");
  return data;
}

export async function fetchAdminStoreShowcase(): Promise<StoreShowcaseCard[]> {
  const { data } = await apiClient.get<StoreShowcaseCard[]>("/admin/store-showcase-cards");
  return data;
}

export async function createStoreShowcaseCard(payload: StoreShowcaseCardInput): Promise<StoreShowcaseCard> {
  const { data } = await apiClient.post<StoreShowcaseCard>("/admin/store-showcase-cards", payload);
  return data;
}

function customCardForm(payload: StoreShowcaseCustomCardInput, includeCardFields: boolean): FormData {
  const form = new FormData();
  const newTiles = payload.tiles.filter((tile) => tile.file);
  newTiles.forEach((tile) => form.append("images", tile.file as File));
  form.append("tiles_json", JSON.stringify(payload.tiles.map(({ file: _file, existing_index: _index, ...tile }) => tile)));
  if (includeCardFields) {
    form.append("title", payload.title);
    form.append("description", payload.description);
    form.append("link_url", payload.link_url);
    form.append("link_label", payload.link_label);
    form.append("is_active", String(payload.is_active));
    form.append("sort_order", String(payload.sort_order));
  }
  return form;
}

export async function createCustomStoreShowcaseCard(payload: StoreShowcaseCustomCardInput): Promise<StoreShowcaseCard> {
  const { data } = await apiClient.post<StoreShowcaseCard>(
    "/admin/store-showcase-cards/custom",
    customCardForm(payload, true),
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function updateCustomStoreShowcaseCard(
  id: number,
  payload: StoreShowcaseCustomCardInput,
): Promise<StoreShowcaseCard> {
  const form = new FormData();
  const tileMeta = payload.tiles.map(({ file, existing_index, ...tile }) => {
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
  form.append("link_url", payload.link_url);
  form.append("link_label", payload.link_label);
  form.append("is_active", String(payload.is_active));
  form.append("sort_order", String(payload.sort_order));
  const { data } = await apiClient.put<StoreShowcaseCard>(
    `/admin/store-showcase-cards/${id}/custom`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function updateStoreShowcaseCard(id: number, payload: Partial<StoreShowcaseCardInput>): Promise<StoreShowcaseCard> {
  const { data } = await apiClient.patch<StoreShowcaseCard>(`/admin/store-showcase-cards/${id}`, payload);
  return data;
}

export async function reorderStoreShowcaseCards(orderedIds: number[]): Promise<StoreShowcaseCard[]> {
  const { data } = await apiClient.patch<StoreShowcaseCard[]>("/admin/store-showcase-cards/reorder", { ordered_ids: orderedIds });
  return data;
}

export async function deleteStoreShowcaseCard(id: number): Promise<void> {
  await apiClient.delete(`/admin/store-showcase-cards/${id}`);
}
