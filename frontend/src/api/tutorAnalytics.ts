import { apiClient } from "@/api/axios";
import type { AnalyticsPeriod, TutorOverview, TutorSeries } from "@/types";

// Metrikler sunucuda hesaplanır; tarayıcıda sayım yapılmaz.
export async function fetchTutorOverview(period: AnalyticsPeriod): Promise<TutorOverview> {
  const { data } = await apiClient.get<TutorOverview>("/tutors/me/analytics/overview", {
    params: { period },
  });
  return data;
}

export async function fetchTutorSeries(period: AnalyticsPeriod): Promise<TutorSeries> {
  const { data } = await apiClient.get<TutorSeries>("/tutors/me/analytics/series", {
    params: { period },
  });
  return data;
}
