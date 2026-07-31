import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changePassword,
  checkDeletionEligibility,
  deleteMyAccount,
  downloadMyData,
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
// yeni access token'ı store'a yazmazsak kullanıcı kendi oturumundan da atılır.
// (Yeni refresh token'ı sunucu doğrudan çereze yazar, istemcinin işi yok.)
export function useChangePassword() {
  const setToken = useAuthStore((s) => s.setToken);
  return useMutation({
    mutationFn: (payload: PasswordChange) => changePassword(payload),
    onSuccess: (token) => {
      setToken(token.access_token);
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

// ── KVKK: veri indirme ve hesap silme ──

/** Verilerini JSON dosyası olarak indirir (tarayıcıda kaydettirir). */
export function useDownloadMyData() {
  return useMutation({
    mutationFn: async () => {
      const blob = await downloadMyData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "verilerim.json";
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}

/** Hesap silinebilir mi — buton tıklanmadan önce sorulur. */
export function useDeletionEligibility() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["me", "deletion-eligibility"],
    queryFn: checkDeletionEligibility,
    enabled: !!token,
    staleTime: 60_000,
  });
}

/** Hesabı siler ve oturumu kapatır (sunucu tüm token'ları iptal etti). */
export function useDeleteMyAccount() {
  const logout = useAuthStore((s) => s.logout);
  return useMutation({
    mutationFn: (password: string) => deleteMyAccount(password),
    onSuccess: () => {
      logout();
    },
  });
}
