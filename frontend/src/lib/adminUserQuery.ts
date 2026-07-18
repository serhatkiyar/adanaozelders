import type { AdminUserRole } from "@/types";

export type AdminUserSort = "created_at" | "full_name" | "email" | "role";
export type SortOrder = "asc" | "desc";

export interface AdminUserQueryState {
  page: number;
  pageSize: number;
  q: string;
  role?: AdminUserRole;
  isActive?: boolean;
  sort: AdminUserSort;
  order: SortOrder;
}

const ROLES = new Set<AdminUserRole>(["ADMIN", "TUTOR", "CLIENT"]);
const SORTS = new Set<AdminUserSort>(["created_at", "full_name", "email", "role"]);
const PAGE_SIZES = new Set([10, 25, 50]);

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseAdminUserQuery(params: URLSearchParams): AdminUserQueryState {
  const rawRole = params.get("role") as AdminUserRole | null;
  const rawSort = params.get("sort") as AdminUserSort | null;
  const rawPageSize = positiveInt(params.get("limit"), 25);
  const active = params.get("active");

  return {
    page: positiveInt(params.get("page"), 1),
    pageSize: PAGE_SIZES.has(rawPageSize) ? rawPageSize : 25,
    q: (params.get("q") ?? "").slice(0, 100),
    role: rawRole && ROLES.has(rawRole) ? rawRole : undefined,
    isActive: active === "true" ? true : active === "false" ? false : undefined,
    sort: rawSort && SORTS.has(rawSort) ? rawSort : "created_at",
    order: params.get("order") === "asc" ? "asc" : "desc",
  };
}

export function setQueryValue(
  current: URLSearchParams,
  changes: Record<string, string | number | boolean | undefined>
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
  }
  return next;
}
