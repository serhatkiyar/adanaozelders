import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/axios";

/**
 * Yeni üye kaydı açık mı? (admin panelindeki `registration_open` bayrağı)
 *
 * UI tarafı bilerek FAIL-OPEN'dır: uç okunamazsa düğmeler GÖSTERİLİR — asıl
 * kilit backend'dedir (kapalıyken register uçları 403 döner) ve bir ağ
 * hıçkırığında sitenin kayıt düğmelerinin sessizce kaybolması istenmez.
 */
export function useKayitAcik(): boolean {
  const { data } = useQuery({
    queryKey: ["auth", "register-open"],
    queryFn: async () => {
      const { data } = await apiClient.get<{ open: boolean }>("/auth/register/open");
      return data.open;
    },
    staleTime: 60_000,
    retry: false,
  });
  return data ?? true;
}
