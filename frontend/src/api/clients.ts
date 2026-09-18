import { apiClient } from "@/api/axios";
import type {
  ClientDashboardOut,
  ClientPublicOut,
  ClientSearchOut,
  Gender,
} from "@/types";

export async function fetchClient(id: number): Promise<ClientPublicOut> {
  const { data } = await apiClient.get<ClientPublicOut>(`/clients/${id}`);
  return data;
}

export interface ClientSearchParams {
  q?: string;
  gender?: Gender;
  min_age?: number;
  max_age?: number;
  limit?: number;
  offset?: number;
}

export async function searchClients(
  params: ClientSearchParams
): Promise<ClientSearchOut[]> {
  const { data } = await apiClient.get<ClientSearchOut[]>("/clients/search", {
    params,
  });
  return data;
}

/** Öğrencinin panosu — ana kart ve sayılar sunucuda hesaplanır (Modül 4). */
export async function fetchMyClientDashboard(): Promise<ClientDashboardOut> {
  const { data } = await apiClient.get<ClientDashboardOut>("/clients/me/dashboard");
  return data;
}
