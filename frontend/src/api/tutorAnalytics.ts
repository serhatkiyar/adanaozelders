import { apiClient } from "@/api/axios";
import type { AnalyticsPeriod, SuccessGoal, TutorOverview } from "@/types";

// Metrikler sunucuda hesaplanır; tarayıcıda sayım yapılmaz.
export async function fetchTutorOverview(period: AnalyticsPeriod): Promise<TutorOverview> {
  const { data } = await apiClient.get<TutorOverview>("/tutors/me/analytics/overview", {
    params: { period },
  });
  return data;
}

export async function fetchTutorGoals(period: AnalyticsPeriod): Promise<SuccessGoal[]> {
  const { data } = await apiClient.get<SuccessGoal[]>("/tutors/me/analytics/goals", {
    params: { period },
  });
  return data;
}
