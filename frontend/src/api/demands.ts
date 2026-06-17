import { apiClient } from "@/api/axios";
import type {
  DemandCreate,
  DemandOut,
  DemandRespondResult,
  DemandResponseOut,
} from "@/types";

export async function createDemand(payload: DemandCreate): Promise<DemandOut> {
  const { data } = await apiClient.post<DemandOut>("/demands", payload);
  return data;
}

export async function fetchMyDemands(): Promise<DemandOut[]> {
  const { data } = await apiClient.get<DemandOut[]>("/demands/me");
  return data;
}

export interface BrowseDemandsParams {
  mine?: boolean;
  subject?: string;
}

export async function browseDemands(
  params: BrowseDemandsParams = {}
): Promise<DemandOut[]> {
  const { data } = await apiClient.get<DemandOut[]>("/demands", { params });
  return data;
}

export async function respondToDemand(
  demandId: number,
  body: string
): Promise<DemandRespondResult> {
  const { data } = await apiClient.post<DemandRespondResult>(
    `/demands/${demandId}/respond`,
    { body }
  );
  return data;
}

export async function fetchDemandResponses(
  demandId: number
): Promise<DemandResponseOut[]> {
  const { data } = await apiClient.get<DemandResponseOut[]>(
    `/demands/${demandId}/responses`
  );
  return data;
}

export async function closeDemand(demandId: number): Promise<DemandOut> {
  const { data } = await apiClient.post<DemandOut>(`/demands/${demandId}/close`);
  return data;
}
