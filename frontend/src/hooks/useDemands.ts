import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  browseDemands,
  closeDemand,
  createDemand,
  listMyDemands,
} from "@/api/demands";
import { useAuthStore } from "@/store/authStore";
import type { DemandCreate } from "@/types";

export function useMyDemands() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["demands", "me"],
    queryFn: listMyDemands,
    enabled: !!token,
  });
}

export function useOpenDemands(subject: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["demands", "open", subject],
    queryFn: () => browseDemands(subject),
    enabled: !!token,
  });
}

export function useCreateDemand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: DemandCreate) => createDemand(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["demands"] }),
  });
}

export function useCloseDemand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => closeDemand(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["demands"] }),
  });
}
