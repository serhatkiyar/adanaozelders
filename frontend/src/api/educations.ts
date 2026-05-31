import { apiClient } from "@/api/axios";
import type { Education, EducationCreate, EducationUpdate } from "@/types";

export async function fetchMyEducations(): Promise<Education[]> {
  const { data } = await apiClient.get<Education[]>("/me/educations");
  return data;
}

export async function createEducation(
  payload: EducationCreate
): Promise<Education> {
  const { data } = await apiClient.post<Education>("/me/educations", payload);
  return data;
}

export async function updateEducation(
  id: number,
  payload: EducationUpdate
): Promise<Education> {
  const { data } = await apiClient.patch<Education>(
    `/me/educations/${id}`,
    payload
  );
  return data;
}

export async function deleteEducation(id: number): Promise<void> {
  await apiClient.delete(`/me/educations/${id}`);
}

export async function uploadEducationDocument(
  id: number,
  file: File
): Promise<Education> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<Education>(
    `/me/educations/${id}/document`,
    form
  );
  return data;
}
