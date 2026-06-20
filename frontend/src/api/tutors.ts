import { apiClient } from "@/api/axios";
import type {
  Gender,
  TutorOut,
  TutorProfileUpdate,
  TutorSearchOut,
  TutorSort,
} from "@/types";

export interface TutorSearchParams {
  q?: string;
  min_rate?: number;
  max_rate?: number;
  mode?: string[];
  gender?: Gender;
  min_age?: number;
  max_age?: number;
  subject?: string[];
  // Sınav bağlamı (TYT/AYT/KPSS…): sert filtre değil, sıralama boost'u.
  exam?: string;
  sort?: TutorSort;
  lat?: number;
  lng?: number;
  radius_km?: number;
  limit?: number;
  offset?: number;
}

export async function searchTutors(
  params: TutorSearchParams
): Promise<TutorSearchOut[]> {
  const { data } = await apiClient.get<TutorSearchOut[]>("/tutors/search", {
    params,
    // Dizi paramları FastAPI'nin beklediği gibi tekrarla: mode=ONLINE&mode=IN_PERSON
    paramsSerializer: { indexes: null },
  });
  return data;
}

export async function fetchTutor(id: number): Promise<TutorSearchOut> {
  const { data } = await apiClient.get<TutorSearchOut>(`/tutors/${id}`);
  return data;
}

// Giriş yapmış eğitmenin kendi ilan profili (status + headline/bio/hourly_rate).
export async function fetchMyTutorProfile(): Promise<TutorOut> {
  const { data } = await apiClient.get<TutorOut>("/tutors/me");
  return data;
}

export async function updateMyTutorProfile(
  payload: TutorProfileUpdate
): Promise<TutorOut> {
  const { data } = await apiClient.patch<TutorOut>("/tutors/me", payload);
  return data;
}

export async function submitMyTutorProfile(): Promise<TutorOut> {
  const { data } = await apiClient.post<TutorOut>("/tutors/me/submit");
  return data;
}

export async function suspendMyListing(): Promise<TutorOut> {
  const { data } = await apiClient.post<TutorOut>("/tutors/me/suspend");
  return data;
}

export async function activateMyListing(): Promise<TutorOut> {
  const { data } = await apiClient.post<TutorOut>("/tutors/me/activate");
  return data;
}
