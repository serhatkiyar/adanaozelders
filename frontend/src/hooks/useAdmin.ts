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
