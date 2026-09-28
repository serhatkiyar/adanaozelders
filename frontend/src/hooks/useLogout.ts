import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { useFavoritesStore } from "@/store/favoritesStore";
import { logout as logoutRequest } from "@/api/auth";
import { ROUTES } from "@/lib/routes";

export function useLogout(redirectTo: string = ROUTES.login) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const cikisBasladi = useAuthStore((s) => s.cikisBasladi);

  return () => {
    // Önce sunucuya logout isteği gider (token interceptor ile eklenir), istek
    // settle olunca yerel token temizlenir — böylece Authorization başlığı kaybolmaz.
    void logoutRequest()
      .catch(() => {})
      .finally(() => {
        logout();
        queryClient.clear();
        // Mağaza favorileri hesapla senkron — sonraki kullanıcıya sızmasın.
        useFavoritesStore.getState().clear();
      });
    // Token istek bitene kadar durur; bu arada `/giris`teki `PublicRoute`
    // kullanıcıyı eski oturumla panosuna geri yollamasın (hesap değiştirirken
    // titreme ve boşuna pano istekleri).
    cikisBasladi();
    // Varsayılan: /giris (panel). Mağaza gibi public yüzeyler kendi hedefini verir.
    navigate(redirectTo, { replace: true });
  };
}
