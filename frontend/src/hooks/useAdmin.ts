import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateTutor,
  approveTutor,
  deleteTutor,
  fetchAdminStats,
  fetchAdminTutors,
  fetchAdminUsers,
  rejectTutor,
  suspendTutor,
  fetchAdminBookings,
  cancelAdminBooking,
  toggleDisputeAdminBooking,
  fetchPendingEducations,
  verifyEducation,
} from "@/api/admin";

export function useAdminStats() {
  return useQuery({
    queryKey: ["admin", "stats"],
    queryFn: fetchAdminStats,
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => fetchAdminUsers({ limit: 200 }),
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
    mutationFn: (id: number) => rejectTutor(id),
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
