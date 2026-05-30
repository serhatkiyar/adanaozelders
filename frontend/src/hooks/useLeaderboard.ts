import { useQuery } from "@tanstack/react-query";
import { fetchLeaderboard } from "@/api/leaderboard";
import { useAuthStore } from "@/store/authStore";

export function useLeaderboard() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["leaderboard"],
    queryFn: fetchLeaderboard,
    enabled: !!token,
  });
}
