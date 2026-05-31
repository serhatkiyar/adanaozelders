import { Navigate, useLocation, useParams } from "react-router-dom";

// Eski (ilkel) URL'leri yeni Türkçe/panel yapısına yönlendirir. SPA içinde gerçek
// 301 olmaz ama `replace` ile geçmişe eski URL bırakmaz; query string korunur
// (örn. ?token=, ?q=, ?to=). Path param'lı eşlemeler için `to` bir fonksiyon olabilir.
export function LegacyRedirect({
  to,
}: {
  to: string | ((params: Record<string, string | undefined>) => string);
}) {
  const params = useParams();
  const location = useLocation();
  const target = typeof to === "function" ? to(params) : to;
  return <Navigate to={`${target}${location.search}`} replace />;
}
