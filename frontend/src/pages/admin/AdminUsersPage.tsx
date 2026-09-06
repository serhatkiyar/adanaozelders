import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { ColumnDef, OnChangeFn, SortingState } from "@tanstack/react-table";
import { Avatar } from "@/components/Avatar";
import { DataTable } from "@/components/admin/data-table";
import { Badge, Button, ErrorState } from "@/components/admin/ui";
import { useAdminUsers } from "@/hooks/useAdmin";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { parseAdminUserQuery, setQueryValue, type AdminUserSort } from "@/lib/adminUserQuery";
import { ROUTES } from "@/lib/routes";
import type { AdminUserOut, AdminUserRole, AdminUserRolePath } from "@/types";
import { rolEtiketi } from "@/lib/roles";
import { ROLE_IDS } from "@/types";

// Etiketler `lib/roles.ts` TEK KAYNAĞINDAN gelir; buradaki eşleme yalnız
// API'nin rol ADINI (`"CLIENT"`) rol KİMLİĞİNE (3) çeviriyor.
const ROLE_ID: Record<AdminUserRole, number> = {
  ADMIN: ROLE_IDS.ADMIN,
  TUTOR: ROLE_IDS.TUTOR,
  CLIENT: ROLE_IDS.CLIENT,
};
const ROLE_LABEL: Record<AdminUserRole, string> = {
  ADMIN: rolEtiketi(ROLE_ID.ADMIN),
  TUTOR: rolEtiketi(ROLE_ID.TUTOR),
  CLIENT: rolEtiketi(ROLE_ID.CLIENT),
};

const ROLE_TONE: Record<AdminUserRole, "info" | "warning" | "success"> = {
  ADMIN: "info",
  TUTOR: "warning",
  CLIENT: "success",
};

const ROLE_PATH: Record<AdminUserRole, AdminUserRolePath> = {
  ADMIN: "admin",
  TUTOR: "tutor",
  CLIENT: "client",
};

export default function AdminUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = parseAdminUserQuery(searchParams);
  const [search, setSearch] = useState(state.q);
  const offset = (state.page - 1) * state.pageSize;
  const query = useAdminUsers({
    limit: state.pageSize,
    offset,
    q: state.q || undefined,
    role: state.role,
    is_active: state.isActive,
    sort: state.sort,
    order: state.order,
  });

  useEffect(() => setSearch(state.q), [state.q]);

  const update = (changes: Record<string, string | number | boolean | undefined>) => {
    setSearchParams(setQueryValue(searchParams, changes));
  };

  const sorting = useMemo<SortingState>(
    () => [{ id: state.sort, desc: state.order === "desc" }],
    [state.order, state.sort]
  );

  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const selected = next[0];
    update({
      sort: (selected?.id as AdminUserSort | undefined) ?? "created_at",
      order: selected?.desc === false ? "asc" : "desc",
      page: 1,
    });
  };

  const columns = useMemo<ColumnDef<AdminUserOut, unknown>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: "Kullanıcı",
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={row.original.full_name} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-950 ">{row.original.full_name}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "email",
        header: "E-posta",
        cell: ({ getValue }) => <span className="text-xs">{String(getValue())}</span>,
      },
      {
        accessorKey: "role",
        header: "Rol",
        cell: ({ row }) => <Badge tone={ROLE_TONE[row.original.role]}>{ROLE_LABEL[row.original.role]}</Badge>,
      },
      {
        id: "status",
        header: "Durum",
        enableSorting: false,
        cell: ({ row }) => (
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${row.original.is_active ? "text-emerald-700 " : "text-slate-500"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${row.original.is_active ? "bg-emerald-500" : "bg-slate-400"}`} />
            {row.original.is_active ? "Aktif" : "Pasif"}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Kayıt",
        cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{formatDateTime(String(getValue()))}</span>,
      },
    ],
    []
  );

  const openUser = (user: AdminUserOut) => {
    const target = ROUTES.adminUser(ROLE_PATH[user.role], user.id);
    navigate(`${target}${location.search}`);
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    update({ q: search.trim() || undefined, page: 1 });
  };

  const hasFilters = Boolean(state.q || state.role || state.isActive !== undefined);

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
      <form onSubmit={submitSearch} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ">
        <div className="grid gap-3 md:grid-cols-[minmax(15rem,1fr)_11rem_11rem_auto]">
          <label className="block">
            <span className="sr-only">Kullanıcı ara</span>
            <input
              value={search}
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ad veya e-posta ara"
              className="input"
            />
          </label>
          <label>
            <span className="sr-only">Rol filtresi</span>
            <select value={state.role ?? ""} onChange={(event) => update({ role: event.target.value || undefined, page: 1 })} className="input">
              <option value="">Tüm roller</option>
              <option value="ADMIN">{ROLE_LABEL.ADMIN}</option>
              <option value="TUTOR">{ROLE_LABEL.TUTOR}</option>
              <option value="CLIENT">{ROLE_LABEL.CLIENT}</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Durum filtresi</span>
            <select value={state.isActive === undefined ? "" : String(state.isActive)} onChange={(event) => update({ active: event.target.value || undefined, page: 1 })} className="input">
              <option value="">Tüm durumlar</option>
              <option value="true">Aktif</option>
              <option value="false">Pasif</option>
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1">Ara</Button>
            {hasFilters && <Button variant="ghost" onClick={() => { setSearch(""); setSearchParams({}); }}>Temizle</Button>}
          </div>
        </div>
      </form>

      {query.isError ? (
        <ErrorState description={getErrorMessage(query.error, "Kullanıcılar yüklenemedi.")} onRetry={() => query.refetch()} />
      ) : (
        <div className="relative">
          {query.isFetching && query.data && <div className="absolute right-4 top-[-2.25rem] text-xs font-medium text-panel-accent-text">Güncelleniyor…</div>}
          <DataTable
            columns={columns}
            data={query.data?.items ?? []}
            getRowId={(row) => `${row.role}-${row.id}`}
            sorting={sorting}
            onSortingChange={onSortingChange}
            isLoading={query.isLoading}
            emptyTitle="Kullanıcı bulunamadı"
            emptyDescription="Arama veya filtre ölçütlerini değiştirerek yeniden deneyin."
            onRowClick={openUser}
            satirAdi={(user) => `${user.full_name} — kullanıcı ayrıntısı`}
            renderMobileRow={(user) => (
              <div className="flex items-start gap-3">
                <Avatar name={user.full_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold text-slate-950 ">{user.full_name}</p>
                    <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABEL[user.role]}</Badge>
                  </div>
                  <p className="truncate text-xs text-slate-500 ">{user.email}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(user.created_at)}</p>
                </div>
              </div>
            )}
            page={state.page}
            pageSize={state.pageSize}
            total={query.data?.total ?? 0}
            onPageChange={(page) => update({ page })}
            onPageSizeChange={(pageSize) => update({ limit: pageSize, page: 1 })}
          />
        </div>
      )}
    </div>
  );
}
