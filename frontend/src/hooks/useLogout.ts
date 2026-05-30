import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { logout as logoutRequest } from "@/api/auth";

export function useLogout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);

  return () => {
    // Önce sunucuya logout isteği gider (token interceptor ile eklenir), istek
    // settle olunca yerel token temizlenir — böylece Authorization başlığı kaybolmaz.
    void logoutRequest()
      .catch(() => {})
      .finally(() => {
        logout();
        queryClient.clear();
      });
    navigate("/login", { replace: true });
  };
}
