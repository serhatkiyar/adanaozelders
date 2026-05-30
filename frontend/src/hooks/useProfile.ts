import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { changePassword, updateMe } from "@/api/users";
import { fetchMyStats } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";
import type { PasswordChange, UserUpdate } from "@/types";

export function useMyStats() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["me", "stats"],
    queryFn: fetchMyStats,
    enabled: !!token,
  });
}

// Ad-soyad güncelleme; başarıda store.user + ["me"] cache'i tazelenir.
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (payload: UserUpdate) => updateMe(payload),
    onSuccess: (user) => {
      setUser(user);
      queryClient.setQueryData(["me"], user);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: PasswordChange) => changePassword(payload),
  });
}
