import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approveNameChange,
  fetchAdminNameChangeRequests,
  rejectNameChange,
} from "@/api/nameChanges";
import type { NameChangeStatus } from "@/types";

export function useAdminNameChangeRequests(status?: NameChangeStatus) {
  return useQuery({
    queryKey: ["admin", "name-change-requests", status ?? "all"],
    queryFn: () => fetchAdminNameChangeRequests(status),
  });
}

export function useApproveNameChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => approveNameChange(id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["admin", "name-change-requests"],
      }),
  });
}

export function useRejectNameChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) =>
      rejectNameChange(id, note),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["admin", "name-change-requests"],
      }),
  });
}
