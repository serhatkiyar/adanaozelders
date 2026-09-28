import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { roleHome } from "@/lib/roles";
import { FullScreenSpinner } from "@/components/Spinner";

// Giriş yapmış kullanıcıyı login/register'dan kendi paneline yollar.
export function PublicRoute() {
  const token = useAuthStore((s) => s.token);
  const cikisYapiliyor = useAuthStore((s) => s.cikisYapiliyor);
  const { data: user, isLoading } = useCurrentUser();

  // Çıkış sürerken token henüz silinmedi; kullanıcı zaten çıkıyor.
  if (!token || cikisYapiliyor) {
    return <Outlet />;
  }

  if (isLoading) {
    return <FullScreenSpinner />;
  }

  if (user) {
    return <Navigate to={roleHome(user.role_id)} replace />;
  }

  return <Outlet />;
}
