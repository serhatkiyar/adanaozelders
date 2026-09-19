import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchTutorGoals, fetchTutorOverview, fetchTutorSeries } from "@/api/tutorAnalytics";
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

export function useTutorSeries(period: AnalyticsPeriod) {
  return useQuery({
    queryKey: ["tutor", "analytics", "series", period],
    queryFn: () => fetchTutorSeries(period),
    placeholderData: keepPreviousData,
  });
}
