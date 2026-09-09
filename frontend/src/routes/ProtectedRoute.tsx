import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { roleHome } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { FullScreenSpinner } from "@/components/Spinner";

interface ProtectedRouteProps {
  // Yalnızca bu role_id erişebilir. Boşsa: yalnızca kimlik doğrulaması yeter.
  allowedRoleId?: number;
  // Birden çok role izin (ör. saha ekranı: ADMIN + COURIER). allowedRoleId ile
  // birlikte verilirse ikisi de kabul kümesine girer (geriye uyumlu).
  allowedRoleIds?: number[];
}

export function ProtectedRoute({ allowedRoleId, allowedRoleIds }: ProtectedRouteProps) {
  const token = useAuthStore((s) => s.token);
  const { data: user, isLoading, isError } = useCurrentUser();
  const konum = useLocation();

  /*
   * Nereye gitmek istediği TAŞINIR (ÜK-10). Eskiden `/giris`e çıplak
   * gidiliyordu ve `Login` başarıda `roleHome()`e götürüyordu: ödemeye gitmek
   * isteyen kullanıcı giriş yapınca panosunda buluyordu kendini, hedefi
   * sessizce kaybolmuştu.
   *
   * `git` anahtarı `guvenliDonus`ta zaten tanınıyor ve dönüş adresi
   * üretilirken temizleniyor — yani bu parametre daha önce düşünülmüş.
   */
  const gitAdresi = `${ROUTES.login}?git=${encodeURIComponent(
    konum.pathname + konum.search
  )}`;

  if (!token) {
    return <Navigate to={gitAdresi} replace />;
  }

  if (isLoading) {
    return <FullScreenSpinner />;
  }

  // 401 interceptor zaten logout yaptı; girişe yönlendir.
  if (isError || !user) {
    return <Navigate to={gitAdresi} replace />;
  }

  const allowed = new Set(
    [...(allowedRoleIds ?? []), ...(allowedRoleId !== undefined ? [allowedRoleId] : [])]
  );
  if (allowed.size > 0 && !allowed.has(user.role_id)) {
    return <Navigate to={roleHome(user.role_id)} replace />;
  }

  return <Outlet />;
}
