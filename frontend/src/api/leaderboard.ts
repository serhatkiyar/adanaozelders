import { apiClient } from "@/api/axios";
import type { LeaderboardOut } from "@/types";

export async function fetchLeaderboard(): Promise<LeaderboardOut> {
  const { data } = await apiClient.get<LeaderboardOut>("/leaderboard");
  return data;
}
