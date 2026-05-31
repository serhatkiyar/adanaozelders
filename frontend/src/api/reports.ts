import { apiClient } from "@/api/axios";
import type { ReportCreate, ReportOut, ReportStatus } from "@/types";

export async function createReport(payload: ReportCreate): Promise<ReportOut> {
  const { data } = await apiClient.post<ReportOut>("/reports", payload);
  return data;
}

// --- Admin ---

export async function fetchAdminReports(
  status?: ReportStatus
): Promise<ReportOut[]> {
  const { data } = await apiClient.get<ReportOut[]>("/admin/reports", {
    params: status ? { status } : undefined,
  });
  return data;
}

export async function fetchOpenReportCount(): Promise<number> {
  const { data } = await apiClient.get<{ open: number }>("/admin/reports/count");
  return data.open;
}

export async function resolveReport(
  id: number,
  status: ReportStatus,
  resolution?: string
): Promise<ReportOut> {
  const { data } = await apiClient.post<ReportOut>(
    `/admin/reports/${id}/resolve`,
    { status, resolution }
  );
  return data;
}
