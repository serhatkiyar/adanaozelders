import { apiClient } from "@/api/axios";
import type {
  AdminStats,
  AdminDashboardOut,
  AdminRevenueOut,
  AdminUserOut,
  TutorOut,
  AdminBookingOut,
  AdminEducation,
  Education,
  AdminUserDetailOut,
  AdminUserRole,
  AdminUserRolePath,
  AuditLogOut,
  AdminDemandOut,
  DemandStatus,
  BookingStatus,
  AdminPermissionOut,
  AdminRoleAssignmentOut,
  AdminRoleCreate,
  AdminRoleInput,
  AdminRoleOut,
} from "@/types";

/** Kullanıcı hesabını anonimleştirip kapatır (geri alınamaz) — users.manage.
 *  Açık para taahhüdü varsa backend 409 döner (gerekçesi detail'dedir). */
export async function deleteAdminUser(payload: {
  role: "tutor" | "client";
  user_id: number;
  reason: string;
}): Promise<void> {
  await apiClient.post("/admin/users/delete", payload);
}

export async function fetchAdminPermissions(): Promise<AdminPermissionOut[]> {
  const { data } = await apiClient.get<AdminPermissionOut[]>("/admin/access/permissions");
  return data;
}

export async function fetchAdminRoles(): Promise<AdminRoleOut[]> {
  const { data } = await apiClient.get<AdminRoleOut[]>("/admin/access/roles");
  return data;
}

export async function fetchAdminRoleAssignments(): Promise<AdminRoleAssignmentOut[]> {
  const { data } = await apiClient.get<AdminRoleAssignmentOut[]>("/admin/access/assignments");
  return data;
}

export async function createAdminRole(payload: AdminRoleCreate): Promise<AdminRoleOut> {
  const { data } = await apiClient.post<AdminRoleOut>("/admin/access/roles", payload);
  return data;
}

export async function updateAdminRole(id: number, payload: AdminRoleInput): Promise<AdminRoleOut> {
  const { data } = await apiClient.put<AdminRoleOut>(`/admin/access/roles/${id}`, payload);
  return data;
}

export async function assignAdminRole(adminId: number, roleId: number): Promise<AdminRoleAssignmentOut> {
  const { data } = await apiClient.put<AdminRoleAssignmentOut>(`/admin/access/admins/${adminId}/role`, { role_id: roleId });
  return data;
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const { data } = await apiClient.get<AdminStats>("/admin/stats");
  return data;
}

export async function fetchAdminRevenue(
  range: "day" | "week" | "month"
): Promise<AdminRevenueOut> {
  const { data } = await apiClient.get<AdminRevenueOut>("/admin/revenue", {
    params: { range },
  });
  return data;
}

export async function fetchAdminDashboard(
  range: "day" | "week" | "month"
): Promise<AdminDashboardOut> {
  const { data } = await apiClient.get<AdminDashboardOut>("/admin/dashboard", {
    params: { range },
  });
  return data;
}

export interface AdminUsersParams {
  limit?: number;
  offset?: number;
  q?: string;
  role?: AdminUserRole;
  is_active?: boolean;
  sort?: "created_at" | "full_name" | "email" | "role";
  order?: "asc" | "desc";
}

export interface AdminUsersResult {
  items: AdminUserOut[];
  total: number;
}

export async function fetchAdminUsers(
  params: AdminUsersParams = {}
): Promise<AdminUsersResult> {
  const response = await apiClient.get<AdminUserOut[]>("/admin/users", {
    params,
  });
  return {
    items: response.data,
    total: Number(response.headers["x-total-count"] ?? response.data.length),
  };
}

export async function fetchAdminUser(
  role: AdminUserRolePath,
  id: number
): Promise<AdminUserDetailOut> {
  const { data } = await apiClient.get<AdminUserDetailOut>(`/admin/users/${role}/${id}`);
  return data;
}

export type AdminDemandSort = "created_at" | "title" | "subject" | "status" | "response_count";

export interface AdminDemandsParams {
  limit?: number;
  offset?: number;
  q?: string;
  status?: DemandStatus;
  sort?: AdminDemandSort;
  order?: "asc" | "desc";
}

export async function fetchAdminDemands(
  params: AdminDemandsParams = {}
): Promise<{ items: AdminDemandOut[]; total: number }> {
  const response = await apiClient.get<AdminDemandOut[]>("/admin/demands", { params });
  return {
    items: response.data,
    total: Number(response.headers["x-total-count"] ?? response.data.length),
  };
}

export async function cancelAdminDemand(id: number, reason: string): Promise<AdminDemandOut> {
  const { data } = await apiClient.post<AdminDemandOut>(`/admin/demands/${id}/cancel`, { reason });
  return data;
}

export interface AdminAuditParams {
  limit?: number;
  offset?: number;
  q?: string;
  action?: string;
  target_type?: string;
  actor_id?: number;
  request_id?: string;
  sort?: "created_at" | "action" | "target_type" | "actor_id";
  order?: "asc" | "desc";
}

export async function fetchAdminAuditLogs(
  params: AdminAuditParams = {}
): Promise<{ items: AuditLogOut[]; total: number }> {
  const response = await apiClient.get<AuditLogOut[]>("/admin/audit-logs", {
    params,
  });
  return {
    items: response.data,
    total: Number(response.headers["x-total-count"] ?? response.data.length),
  };
}

export async function fetchAdminTutors(): Promise<TutorOut[]> {
  const { data } = await apiClient.get<TutorOut[]>("/admin/tutors");
  return data;
}

export async function approveTutor(id: number): Promise<void> {
  await apiClient.post(`/admin/tutors/${id}/approve`);
}

/** Red gerekçesi ZORUNLUDUR (backend `TutorRejectIn`; denetim izine yazılır). */
export async function rejectTutor(id: number, reason: string): Promise<void> {
  await apiClient.post(`/admin/tutors/${id}/reject`, { reason });
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

export type AdminBookingSort = "created_at" | "start_at" | "status" | "price";

export interface AdminBookingsParams {
  limit?: number;
  offset?: number;
  q?: string;
  status?: BookingStatus;
  is_disputed?: boolean;
  sort?: AdminBookingSort;
  order?: "asc" | "desc";
}

export async function fetchAdminBookingList(
  params: AdminBookingsParams = {}
): Promise<{ items: AdminBookingOut[]; total: number }> {
  const response = await apiClient.get<AdminBookingOut[]>("/admin/bookings", { params });
  return {
    items: response.data,
    total: Number(response.headers["x-total-count"] ?? response.data.length),
  };
}

export async function fetchAdminBookings(params: AdminBookingsParams = {}): Promise<AdminBookingOut[]> {
  return (await fetchAdminBookingList(params)).items;
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

// ── Eğitmen ön başvuruları (lead) ──

export type PreApplicationStatus =
  | "NEW"
  | "CONTACTED"
  | "CONVERTED"
  | "REJECTED";

export interface PreApplicationDocument {
  /** Sunucu imzalı (kısa ömürlü) private URL döner — doğrudan açılabilir. */
  url: string;
  name: string;
}

export interface AdminTutorPreApplication {
  id: number;
  full_name: string;
  phone: string;
  email: string | null;
  /** Virgülle ayrılmış branş etiketleri (sunucuda düz metin saklanır). */
  subjects: string;
  district: string | null;
  experience: string | null;
  note: string | null;
  documents: PreApplicationDocument[] | null;
  status: PreApplicationStatus;
  kvkk_accepted_at: string;
  created_at: string;
}

export async function fetchAdminTutorPreApplications(
  status?: string
): Promise<AdminTutorPreApplication[]> {
  const { data } = await apiClient.get<AdminTutorPreApplication[]>(
    "/admin/tutor-pre-applications",
    { params: status ? { status } : undefined }
  );
  return data;
}

export async function updateTutorPreApplicationStatus(
  id: number,
  status: PreApplicationStatus
): Promise<AdminTutorPreApplication> {
  const { data } = await apiClient.post<AdminTutorPreApplication>(
    `/admin/tutor-pre-applications/${id}/status`,
    { status }
  );
  return data;
}

// ── İlan öne çıkarma satışları ──

export interface AdminPromotion {
  id: number;
  tutor_id: number;
  tutor_name: string | null;
  package_days: number;
  price: string;
  currency: string;
  payment_status: string;
  provider: string | null;
  provider_ref: string | null;
  paid_at: string | null;
  refunded_amount: string | null;
  starts_at: string | null;
  ends_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export async function fetchAdminPromotions(
  status?: string
): Promise<AdminPromotion[]> {
  const { data } = await apiClient.get<AdminPromotion[]>("/admin/promotions", {
    params: status ? { status } : undefined,
  });
  return data;
}

/** İptal + iade. Gerekçe zorunludur ve denetim iznine yazılır. */
export async function cancelAdminPromotion(
  id: number,
  reason: string
): Promise<AdminPromotion> {
  const { data } = await apiClient.post<AdminPromotion>(
    `/admin/promotions/${id}/cancel`,
    { reason }
  );
  return data;
}
