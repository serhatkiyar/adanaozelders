import { apiClient } from "@/api/axios";
import type {
  AdminStats,
  AdminUserOut,
  TutorOut,
  AdminBookingOut,
  AdminEducation,
  Education,
} from "@/types";

export async function fetchAdminStats(): Promise<AdminStats> {
  const { data } = await apiClient.get<AdminStats>("/admin/stats");
  return data;
}

export interface AdminUsersParams {
  limit?: number;
  offset?: number;
}

export async function fetchAdminUsers(
  params: AdminUsersParams = {}
): Promise<AdminUserOut[]> {
  const { data } = await apiClient.get<AdminUserOut[]>("/admin/users", {
    params,
  });
  return data;
}

export async function fetchAdminTutors(): Promise<TutorOut[]> {
  const { data } = await apiClient.get<TutorOut[]>("/admin/tutors");
  return data;
}

export async function approveTutor(id: number): Promise<void> {
  await apiClient.post(`/admin/tutors/${id}/approve`);
}

export async function rejectTutor(id: number): Promise<void> {
  await apiClient.post(`/admin/tutors/${id}/reject`);
}

export async function suspendTutor(id: number): Promise<void> {
  await apiClient.post(`/admin/tutors/${id}/suspend`);
}

export async function activateTutor(id: number): Promise<void> {
  await apiClient.post(`/admin/tutors/${id}/activate`);
}

export async function deleteTutor(id: number): Promise<void> {
  await apiClient.delete(`/admin/tutors/${id}`);
}

export interface AdminTutorsParams {
  status?: string;
}

export async function fetchAdminTutorsByStatus(
  status?: string
): Promise<TutorOut[]> {
  const { data } = await apiClient.get<TutorOut[]>("/admin/tutors", {
    params: status ? { status } : undefined,
  });
  return data;
}

export async function fetchAdminBookings(params: { limit?: number; offset?: number } = {}): Promise<AdminBookingOut[]> {
  const { data } = await apiClient.get<AdminBookingOut[]>("/admin/bookings", { params });
  return data;
}

export async function cancelAdminBooking(id: number, reason: string): Promise<AdminBookingOut> {
  const { data } = await apiClient.post<AdminBookingOut>(`/admin/bookings/${id}/cancel`, { reason });
  return data;
}

export async function toggleDisputeAdminBooking(id: number, is_disputed: boolean, admin_notes?: string): Promise<AdminBookingOut> {
  const { data } = await apiClient.post<AdminBookingOut>(`/admin/bookings/${id}/dispute`, { is_disputed, admin_notes });
  return data;
}

// ── Diploma doğrulama kuyruğu ──

export async function fetchPendingEducations(): Promise<AdminEducation[]> {
  const { data } = await apiClient.get<AdminEducation[]>("/admin/educations/pending");
  return data;
}

export async function verifyEducation(
  id: number,
  action: "verify" | "reject",
  note?: string
): Promise<Education> {
  const { data } = await apiClient.post<Education>(`/admin/educations/${id}/verify`, {
    action,
    note: note ?? null,
  });
  return data;
}
