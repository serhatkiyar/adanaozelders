import { useQuery } from "@tanstack/react-query";
import { fetchMyTutorDashboard } from "@/api/tutors";

// Ders aksiyonları (kabul/red/iptal) bu anahtarı da geçersiz sayar.
export const TUTOR_DASHBOARD_KEY = ["tutor", "dashboard"] as const;

export function useTutorDashboard() {
  return useQuery({
    queryKey: TUTOR_DASHBOARD_KEY,
    queryFn: fetchMyTutorDashboard,
    // "Sıradaki ders" ve "derse katıl" zamana bağlı; açık kalan pano güncel kalsın.
    refetchInterval: 60_000,
  });
}
