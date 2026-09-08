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
export function useGoogleGirisi(): { acik: boolean; startUrl: string | null } {
  const { data } = useQuery({
    queryKey: ["auth", "oauth-providers"],
    queryFn: fetchOAuthProviders,
    staleTime: 5 * 60_000,
    // Bir deneme YETMEZ. `retry: false` ile yazılmıştı ve ölçüldü: backend bir
    // an erişilemezken açılan sayfa "kapalı" cevabını alıp düğmeyi gizliyor,
    // sunucu geri geldiğinde de o sekme kendini toparlamıyordu. Fail-closed
    // olmak "ilk hıçkırıkta pes et" demek değil.
    retry: 2,
    retryDelay: (deneme) => Math.min(1000 * 2 ** deneme, 5000),
    // Sekmeye geri dönüldüğünde tazele: kullanıcı sunucu düzeldikten sonra
    // sekmesine dönerse düğme kendiliğinden gelsin.
    refetchOnWindowFocus: true,
  });
  return {
    acik: (data?.google ?? false) && Boolean(data?.google_start_url),
    startUrl: data?.google_start_url ?? null,
  };
}
