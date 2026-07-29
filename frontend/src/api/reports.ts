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
  return (await fetchAdminReportList(status ? { status } : {})).items;
}

export interface AdminReportsParams {
  status?: ReportStatus;
  target_type?: string;
  limit?: number;
  offset?: number;
}

export async function fetchAdminReportList(
  params: AdminReportsParams = {}
): Promise<{ items: ReportOut[]; total: number }> {
  const response = await apiClient.get<ReportOut[]>("/admin/reports", { params });
  return {
    items: response.data,
    total: Number(response.headers["x-total-count"] ?? response.data.length),
  };
}

export async function fetchOpenReportCount(): Promise<number> {
  const { data } = await apiClient.get<{ open: number }>("/admin/reports/count");
  return data.open;
}

export async function resolveReport(
  id: number,
  status: ReportStatus,
  resolution?: string,
  hideTarget = false
): Promise<ReportOut> {
  const { data } = await apiClient.post<ReportOut>(
    `/admin/reports/${id}/resolve`,
    { status, resolution, hide_target: hideTarget }
  );
  return data;
}

/** Şikayetten bağımsız olarak bir yorumu yayından kaldırır/geri getirir. */
export async function setContentHidden(
  targetType: string,
  targetId: number,
  hidden: boolean,
  reason?: string
): Promise<void> {
  const action = hidden ? "hide" : "unhide";
  await apiClient.post(
    `/admin/content/${targetType.toLowerCase()}/${targetId}/${action}`,
    hidden ? { reason } : undefined
  );
}
