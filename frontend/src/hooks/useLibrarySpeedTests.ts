import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSpeedTestStats, recordSpeedTest } from "@/api/speedtest";
import type { SpeedTestResult } from "@/types";

export function useSpeedTestStats(libraryId: number | undefined) {
  return useQuery({
    queryKey: ["library-speedtests", libraryId],
    queryFn: () => fetchSpeedTestStats(libraryId as number),
    enabled: typeof libraryId === "number",
  });
}

export function useRecordSpeedTest(libraryId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SpeedTestResult) =>
      recordSpeedTest(libraryId, payload),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["library-speedtests", libraryId],
      }),
  });
}
