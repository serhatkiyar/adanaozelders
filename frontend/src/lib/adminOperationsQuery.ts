import { BookingStatus, DemandStatus, ReportStatus } from "@/types";
import type { AdminBookingSort, AdminDemandSort } from "@/api/admin";

export type AdminAuditSort = "created_at" | "action" | "target_type" | "actor_id";

const PAGE_SIZES = new Set([10, 25, 50]);
const AUDIT_SORTS = new Set<AdminAuditSort>([
  "created_at",
  "action",
  "target_type",
  "actor_id",
]);
const REPORT_STATUSES = new Set(Object.values(ReportStatus));
const DEMAND_STATUSES = new Set(Object.values(DemandStatus));
const DEMAND_SORTS = new Set<AdminDemandSort>([
  "created_at",
  "title",
  "subject",
  "status",
  "response_count",
]);
const BOOKING_STATUSES = new Set(Object.values(BookingStatus));
const BOOKING_SORTS = new Set<AdminBookingSort>(["created_at", "start_at", "status", "price"]);

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pageSize(params: URLSearchParams): number {
  const parsed = positiveInt(params.get("limit"), 25);
  return PAGE_SIZES.has(parsed) ? parsed : 25;
}

export function parseAdminAuditQuery(params: URLSearchParams) {
  const rawSort = params.get("sort") as AdminAuditSort | null;
  const actorId = positiveInt(params.get("actor"), 0);
  return {
    page: positiveInt(params.get("page"), 1),
    pageSize: pageSize(params),
    q: (params.get("q") ?? "").slice(0, 100),
    action: (params.get("action") ?? "").slice(0, 50),
    targetType: (params.get("target") ?? "").slice(0, 30),
    actorId: actorId || undefined,
    sort: rawSort && AUDIT_SORTS.has(rawSort) ? rawSort : "created_at",
    order: params.get("order") === "asc" ? "asc" as const : "desc" as const,
  };
}

export function parseAdminReportQuery(params: URLSearchParams) {
  const rawStatus = params.get("status") as ReportStatus | null;
  return {
    page: positiveInt(params.get("page"), 1),
    pageSize: pageSize(params),
    status: rawStatus && REPORT_STATUSES.has(rawStatus) ? rawStatus : ReportStatus.OPEN,
    targetType: (params.get("target") ?? "").slice(0, 30),
  };
}

export function parseAdminDemandQuery(params: URLSearchParams) {
  const rawStatus = params.get("status") as DemandStatus | null;
  const rawSort = params.get("sort") as AdminDemandSort | null;
  return {
    page: positiveInt(params.get("page"), 1),
    pageSize: pageSize(params),
    q: (params.get("q") ?? "").slice(0, 100),
    status: rawStatus && DEMAND_STATUSES.has(rawStatus) ? rawStatus : undefined,
    sort: rawSort && DEMAND_SORTS.has(rawSort) ? rawSort : "created_at" as AdminDemandSort,
    order: params.get("order") === "asc" ? "asc" as const : "desc" as const,
  };
}

export function parseAdminBookingQuery(params: URLSearchParams) {
  const rawStatus = params.get("status") as BookingStatus | null;
  const rawSort = params.get("sort") as AdminBookingSort | null;
  const disputed = params.get("disputed");
  return {
    page: positiveInt(params.get("page"), 1),
    pageSize: pageSize(params),
    q: (params.get("q") ?? "").slice(0, 100),
    status: rawStatus && BOOKING_STATUSES.has(rawStatus) ? rawStatus : undefined,
    isDisputed: disputed === "true" ? true : disputed === "false" ? false : undefined,
    sort: rawSort && BOOKING_SORTS.has(rawSort) ? rawSort : "created_at" as AdminBookingSort,
    order: params.get("order") === "asc" ? "asc" as const : "desc" as const,
  };
}
