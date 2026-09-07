import { useQuery } from "@tanstack/react-query";

import { fetchOAuthProviders } from "@/api/auth";

/**
 * Google girişi yapılandırılmış mı? (sunucuda CLIENT_ID + SECRET dolu mu)
 *
 * FAIL-CLOSED, bilerek — `useKayitAcik`in fail-open'ının TERSİ, ve ayrım
 * kasıtlı:
 *
 * - Kayıt düğmesi bir ağ hıçkırığında kaybolmamalı; asıl kilit zaten
 *   backend'de (kapalıyken register uçları 403 döner), düğmeyi göstermenin
 *   maliyeti sıfır.
 * - Google düğmesi ise yapılandırma yoksa kullanıcıyı 404'e götürür. Yanlış
 *   yönde hata yapmak burada "çalışmayan bir düğme" demek, orada "gereksiz
 *   gizlenen bir düğme".
 */
export function useGoogleGirisiAcik(): boolean {
  const { data } = useQuery({
    queryKey: ["auth", "oauth-providers"],
    queryFn: fetchOAuthProviders,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data?.google ?? false;
}
