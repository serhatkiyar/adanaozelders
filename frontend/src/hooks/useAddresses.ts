import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAddress,
  deleteAddress,
  fetchMyAddresses,
  updateAddress,
} from "@/api/addresses";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS } from "@/types";
import type { SavedAddressCreate, SavedAddressUpdate } from "@/types";

const MY_ADDRESSES_KEY = ["addresses", "me"] as const;

export function useMyAddresses(enabled = true) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const isClient = user?.role_id === ROLE_IDS.CLIENT;
  return useQuery({
    queryKey: MY_ADDRESSES_KEY,
    queryFn: fetchMyAddresses,
    enabled: !!token && isClient && enabled,
  });
}

function useInvalidateAddresses() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: MY_ADDRESSES_KEY });
}

export function useAddAddress() {
  const invalidate = useInvalidateAddresses();
  return useMutation({
    mutationFn: (payload: SavedAddressCreate) => createAddress(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateAddress() {
  const invalidate = useInvalidateAddresses();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: SavedAddressUpdate }) =>
      updateAddress(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteAddress() {
  const invalidate = useInvalidateAddresses();
  return useMutation({
    mutationFn: (id: number) => deleteAddress(id),
    onSuccess: invalidate,
  });
}
