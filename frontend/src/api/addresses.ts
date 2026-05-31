import { apiClient } from "@/api/axios";
import type {
  SavedAddress,
  SavedAddressCreate,
  SavedAddressUpdate,
} from "@/types";

export async function fetchMyAddresses(): Promise<SavedAddress[]> {
  const { data } = await apiClient.get<SavedAddress[]>("/me/addresses");
  return data;
}

export async function createAddress(
  payload: SavedAddressCreate
): Promise<SavedAddress> {
  const { data } = await apiClient.post<SavedAddress>("/me/addresses", payload);
  return data;
}

export async function updateAddress(
  id: number,
  payload: SavedAddressUpdate
): Promise<SavedAddress> {
  const { data } = await apiClient.patch<SavedAddress>(
    `/me/addresses/${id}`,
    payload
  );
  return data;
}

export async function deleteAddress(id: number): Promise<void> {
  await apiClient.delete(`/me/addresses/${id}`);
}
