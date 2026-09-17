import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchTutorGoals, fetchTutorOverview } from "@/api/tutorAnalytics";
import type { AnalyticsPeriod } from "@/types";

// Dönem değişince eski kartlar yerinde kalır; iskelet yalnız ilk yüklemede.
export function useTutorOverview(period: AnalyticsPeriod) {
  return useQuery({
    queryKey: ["tutor", "analytics", "overview", period],
    queryFn: () => fetchTutorOverview(period),
    placeholderData: keepPreviousData,
  });
}

export function useTutorGoals(period: AnalyticsPeriod) {
  return useQuery({
    queryKey: ["tutor", "analytics", "goals", period],
    queryFn: () => fetchTutorGoals(period),
    placeholderData: keepPreviousData,
  });
}
