import { apiClient } from "@/api/axios";
import type { DemandCreate, DemandOut } from "@/types";

export async function createDemand(
  payload: DemandCreate
): Promise<DemandOut> {
  const { data } = await apiClient.post<DemandOut>("/demands", payload);
  return data;
}

export async function listMyDemands(): Promise<DemandOut[]> {
  const { data } = await apiClient.get<DemandOut[]>("/demands/me", {
    params: { limit: 100 },
  });
  return data;
}

export async function browseDemands(subject?: string): Promise<DemandOut[]> {
  const { data } = await apiClient.get<DemandOut[]>("/demands", {
    params: { subject: subject || undefined, limit: 100 },
  });
  return data;
}

export async function closeDemand(id: number): Promise<DemandOut> {
  const { data } = await apiClient.post<DemandOut>(`/demands/${id}/close`);
  return data;
}
