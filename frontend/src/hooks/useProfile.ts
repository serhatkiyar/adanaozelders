import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changePassword,
  listMyNameChangeRequests,
  requestPhoneOtp,
  updateMe,
  verifyPhoneOtp,
} from "@/api/users";
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
      // Onaya gönderilmiş olabilecek ad/kullanıcı adı talepleri tazelensin.
      queryClient.invalidateQueries({ queryKey: ["me", "name-change-requests"] });
    },
  });
}

// Kullanıcının ad/kullanıcı adı değişiklik talepleri (admin onay durumu).
export function useMyNameChangeRequests() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["me", "name-change-requests"],
    queryFn: listMyNameChangeRequests,
    enabled: !!token,
  });
}

// Şifre değişimi diğer tüm oturumları düşürür; sunucunun bu cihaz için ürettiği
// yeni token çiftini store'a yazmazsak kullanıcı kendi oturumundan da atılır.
export function useChangePassword() {
  const setTokens = useAuthStore((s) => s.setTokens);
  return useMutation({
    mutationFn: (payload: PasswordChange) => changePassword(payload),
    onSuccess: (token) => {
      setTokens(token.access_token, token.refresh_token ?? null);
    },
  });
}

// Telefon: numara kaydet + SMS OTP iste.
export function useRequestPhoneOtp() {
  return useMutation({
    mutationFn: (phone: string) => requestPhoneOtp(phone),
  });
}

// SMS kodunu doğrula; başarıda store.user + ["me"] tazelenir.
export function useVerifyPhone() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (code: string) => verifyPhoneOtp(code),
    onSuccess: (user) => {
      setUser(user);
      queryClient.setQueryData(["me"], user);
    },
  });
}
