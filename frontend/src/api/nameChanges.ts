import { apiClient } from "@/api/axios";
import type { NameChangeRequest, NameChangeStatus } from "@/types";

export async function fetchAdminNameChangeRequests(
  status?: NameChangeStatus
): Promise<NameChangeRequest[]> {
  const { data } = await apiClient.get<NameChangeRequest[]>(
    "/admin/name-change-requests",
    { params: status ? { status } : undefined }
  );
  return data;
}

export async function approveNameChange(
  id: number
): Promise<NameChangeRequest> {
  const { data } = await apiClient.post<NameChangeRequest>(
    `/admin/name-change-requests/${id}/approve`
  );
  return data;
}

export async function rejectNameChange(
  id: number,
  note?: string
): Promise<NameChangeRequest> {
  const { data } = await apiClient.post<NameChangeRequest>(
    `/admin/name-change-requests/${id}/reject`,
    { note: note || null }
  );
  return data;
}
