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

  return () => {
    // Token yerelde temizlenmeden önce alınır ve sunucuya açıkça gönderilir;
    // yerel oturum yönlendirmeden ÖNCE ve senkron kapanır. Tersi (önce
    // yönlendirme, istek bitince temizlik) arada /giris'teki PublicRoute'un
    // eski token'ı görüp kullanıcıyı kendi panosuna geri yollamasına yol
    // açıyordu: hesap değiştirmede titreme ve boşuna pano istekleri.
    const token = useAuthStore.getState().token;
    void logoutRequest(token).catch(() => {});
    logout();
    queryClient.clear();
    // Mağaza favorileri hesapla senkron — sonraki kullanıcıya sızmasın.
    useFavoritesStore.getState().clear();
    // Varsayılan: /giris (panel). Mağaza gibi public yüzeyler kendi hedefini verir.
    navigate(redirectTo, { replace: true });
  };}
