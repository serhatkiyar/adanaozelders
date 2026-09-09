import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
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
  /**
   * TOKENSİZ ziyaretçiye `/giris` yerine ÇİZİLECEK içerik.
   *
   * Varsayılan davranış (giriş ekranına yönlendir) çoğu panel yüzeyi için
   * doğrudur: orada görülecek bir şey yoktur. Ama alt sekme çubuğundan
   * gelinen `/favoriler` gibi yüzeylerde kullanıcı bir sekmeye dokunup
   * bambaşka bir ekranda buluyordu kendini. Böyle rotalar kendi "oturum aç"
   * davetini çizer.
   *
   * ROL KAPISINI DEĞİŞTİRMEZ: token varsa akış aynen devam eder, yani
   * yetkisiz rol yine kendi ana sayfasına yönlendirilir.
   */
  anonimIcerik?: ReactNode;
}

export function ProtectedRoute({
  allowedRoleId,
  allowedRoleIds,
  anonimIcerik,
}: ProtectedRouteProps) {
  const token = useAuthStore((s) => s.token);
  const { data: user, isLoading, isError } = useCurrentUser();

  if (!token) {
    return anonimIcerik ? <>{anonimIcerik}</> : <Navigate to={ROUTES.login} replace />;
  }

  if (isLoading) {
    return <FullScreenSpinner />;
  }

  // 401 interceptor zaten logout yaptı; girişe yönlendir.
  if (isError || !user) {
    return <Navigate to={ROUTES.login} replace />;
  }

  const allowed = new Set(
    [...(allowedRoleIds ?? []), ...(allowedRoleId !== undefined ? [allowedRoleId] : [])]
  );
  if (allowed.size > 0 && !allowed.has(user.role_id)) {
    return <Navigate to={roleHome(user.role_id)} replace />;
  }

  return <Outlet />;
}
