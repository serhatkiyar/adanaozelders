import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReport,
  fetchAdminReports,
  fetchAdminReportList,
  type AdminReportsParams,
  fetchOpenReportCount,
  resolveReport,
} from "@/api/reports";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS, ReportStatus, type ReportCreate } from "@/types";

export function useCreateReport() {
  return useMutation({
    mutationFn: (payload: ReportCreate) => createReport(payload),
  });
}

function useIsAdmin() {
  const user = useAuthStore((s) => s.user);
  return user?.role_id === ROLE_IDS.ADMIN;
}

export function useAdminReports(status?: ReportStatus) {
  const enabled = useIsAdmin();
  return useQuery({
    queryKey: ["admin", "reports", status ?? "ALL"],
    queryFn: () => fetchAdminReports(status),
    enabled,
  });
}

export function useAdminReportList(params: AdminReportsParams) {
  const enabled = useIsAdmin();
  return useQuery({
    queryKey: ["admin", "reports", "list", params],
    queryFn: () => fetchAdminReportList(params),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useOpenReportCount(permissionEnabled = true) {
  const enabled = useIsAdmin() && permissionEnabled;
  return useQuery({
    queryKey: ["admin", "reports", "count"],
    queryFn: fetchOpenReportCount,
    enabled,
    refetchInterval: 60_000,
  });
}

export function useResolveReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      resolution,
    }: {
      id: number;
      status: ReportStatus;
      resolution?: string;
    }) => resolveReport(id, status, resolution),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
  });
}
