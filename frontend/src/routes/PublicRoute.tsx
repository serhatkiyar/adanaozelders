import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { roleHome } from "@/lib/roles";
import { FullScreenSpinner } from "@/components/Spinner";

// Giriş yapmış kullanıcıyı login/register'dan kendi paneline yollar.
export function PublicRoute() {
  const token = useAuthStore((s) => s.token);
  const { data: user, isLoading } = useCurrentUser();

  if (!token) {
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
