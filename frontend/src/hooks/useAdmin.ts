import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateTutor,
  approveTutor,
  deleteTutor,
  fetchAdminStats,
  fetchAdminDashboard,
  fetchAdminRevenue,
  fetchAdminTutors,
  fetchAdminUsers,
  rejectTutor,
  suspendTutor,
  fetchAdminBookings,
  cancelAdminBooking,
  toggleDisputeAdminBooking,
  fetchPendingEducations,
  verifyEducation,
  fetchAdminUser,
  type AdminUsersParams,
  fetchAdminAuditLogs,
  type AdminAuditParams,
  cancelAdminDemand,
  fetchAdminDemands,
  type AdminDemandsParams,
  fetchAdminBookingList,
  type AdminBookingsParams,
  assignAdminRole,
  createAdminRole,
  fetchAdminPermissions,
  fetchAdminRoleAssignments,
  fetchAdminRoles,
  updateAdminRole,
} from "@/api/admin";
import type { AdminRoleCreate, AdminRoleInput, AdminUserRolePath } from "@/types";

export function useAdminPermissions() {
  return useQuery({ queryKey: ["admin", "access", "permissions"], queryFn: fetchAdminPermissions });
}

export function useAdminRoles() {
  return useQuery({ queryKey: ["admin", "access", "roles"], queryFn: fetchAdminRoles });
}

export function useAdminRoleAssignments() {
  return useQuery({ queryKey: ["admin", "access", "assignments"], queryFn: fetchAdminRoleAssignments });
}

function useInvalidateAdminAccess() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "access"] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
    ]);
  };
}

export function useCreateAdminRole() {
  const invalidate = useInvalidateAdminAccess();
  return useMutation({ mutationFn: (payload: AdminRoleCreate) => createAdminRole(payload), onSuccess: invalidate });
}

export function useUpdateAdminRole() {
  const invalidate = useInvalidateAdminAccess();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AdminRoleInput }) => updateAdminRole(id, payload),
    onSuccess: invalidate,
  });
}

export function useAssignAdminRole() {
  const invalidate = useInvalidateAdminAccess();
  return useMutation({
    mutationFn: ({ adminId, roleId }: { adminId: number; roleId: number }) => assignAdminRole(adminId, roleId),
    onSuccess: invalidate,
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: ["admin", "stats"],
    queryFn: fetchAdminStats,
  });
}

export function useAdminRevenue(range: "day" | "week" | "month") {
  return useQuery({
    queryKey: ["admin", "revenue", range],
    queryFn: () => fetchAdminRevenue(range),
    staleTime: 60_000,
  });
}

export function useAdminDashboard(range: "day" | "week" | "month") {
  return useQuery({
    queryKey: ["admin", "dashboard", range],
    queryFn: () => fetchAdminDashboard(range),
    refetchInterval: 60_000,
  });
}

export function useAdminUsers(params: AdminUsersParams = { limit: 25, offset: 0 }) {
  return useQuery({
    queryKey: ["admin", "users", params],
    queryFn: () => fetchAdminUsers(params),
    placeholderData: (previous) => previous,
  });
}

export function useAdminUser(role: AdminUserRolePath | undefined, id: number) {
  return useQuery({
    queryKey: ["admin", "users", "detail", role, id],
    queryFn: () => fetchAdminUser(role!, id),
    enabled: role !== undefined && Number.isInteger(id) && id > 0,
  });
}

export function useAdminAuditLogs(params: AdminAuditParams) {
  return useQuery({
    queryKey: ["admin", "audit-logs", params],
    queryFn: () => fetchAdminAuditLogs(params),
    placeholderData: (previous) => previous,
  });
}

export function useAdminDemands(params: AdminDemandsParams) {
  return useQuery({
    queryKey: ["admin", "demands", params],
    queryFn: () => fetchAdminDemands(params),
    placeholderData: (previous) => previous,
  });
}

export function useCancelAdminDemand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => cancelAdminDemand(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "demands"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit-logs"] });
    },
  });
}

export function useAdminTutors() {
  return useQuery({
    queryKey: ["admin", "tutors"],
    queryFn: fetchAdminTutors,
    refetchInterval: 30_000,
  });
}

function useInvalidateAdmin() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["admin", "tutors"] });
    qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
  };
}

export function useApproveTutor() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (id: number) => approveTutor(id),
    onSuccess: invalidate,
  });
}

export function useRejectTutor() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      rejectTutor(id, reason),
    onSuccess: invalidate,
  });
}

export function useSuspendTutor() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (id: number) => suspendTutor(id),
    onSuccess: invalidate,
  });
}

export function useActivateTutor() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (id: number) => activateTutor(id),
    onSuccess: invalidate,
  });
}

export function useDeleteTutor() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (id: number) => deleteTutor(id),
    onSuccess: invalidate,
  });
}

export function useAdminBookings(params: { limit?: number; offset?: number } = { limit: 100 }) {
  return useQuery({
    queryKey: ["admin", "bookings", params],
    queryFn: () => fetchAdminBookings(params),
  });
}

export function useAdminBookingList(params: AdminBookingsParams) {
  return useQuery({
    queryKey: ["admin", "bookings", "list", params],
    queryFn: () => fetchAdminBookingList(params),
    placeholderData: (previous) => previous,
  });
}

export function useAdminCancelBooking() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => cancelAdminBooking(id, reason),
    onSuccess: invalidate,
  });
}

export function useAdminToggleDisputeBooking() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, is_disputed, admin_notes }: { id: number; is_disputed: boolean; admin_notes?: string }) =>
      toggleDisputeAdminBooking(id, is_disputed, admin_notes),
    onSuccess: invalidate,
  });
}

// ── Diploma doğrulama kuyruğu ──

export function usePendingEducations() {
  return useQuery({
    queryKey: ["admin", "educations", "pending"],
    queryFn: fetchPendingEducations,
    refetchInterval: 30_000,
  });
}

export function useVerifyEducation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: number; action: "verify" | "reject"; note?: string }) =>
      verifyEducation(id, action, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "educations", "pending"] });
      qc.invalidateQueries({ queryKey: ["admin", "tutors"] });
    },
  });
}
