import { useQuery } from "@tanstack/react-query";
import { fetchMyClientDashboard } from "@/api/clients";

/**
 * Anahtar BİLEREK `["bookings"]` önekli: ders mutasyonlarının hepsi
 * (kabul/red/iptal/erteleme/onay/sorun/ödeme/yorum) ve App'teki WS tazelemesi
 * bu öneki zaten geçersiz sayıyor, pano ayrıca bir invalidation istemez.
 *
 * DİKKAT: `useBookings.ts::patchBookingCaches` aynı önekteki önbellekleri
 * iyimser olarak yamar. Pano nesnesi dizi değildir ve `id` alanı taşımaz, o
 * yüzden yamadan değişmeden döner. O fonksiyon nesneye yeni alan yazacak
 * biçimde değişirse bu nesneyi de bozabilir.
 */
export const CLIENT_DASHBOARD_KEY = ["bookings", "client-dashboard"] as const;

export function useClientDashboard() {
  return useQuery({
    queryKey: CLIENT_DASHBOARD_KEY,
    queryFn: fetchMyClientDashboard,
    // Katılma penceresi ve onay süresi zamana bağlı; açık pano güncel kalsın.
    refetchInterval: 60_000,
  });
}
