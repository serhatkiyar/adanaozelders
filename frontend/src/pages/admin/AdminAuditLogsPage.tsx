import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef, OnChangeFn, SortingState } from "@tanstack/react-table";
import { DataTable } from "@/components/admin/data-table";
import { Badge, Button, ErrorState } from "@/components/admin/ui";
import { useAdminAuditLogs } from "@/hooks/useAdmin";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { parseAdminAuditQuery, type AdminAuditSort } from "@/lib/adminOperationsQuery";
import { setQueryValue } from "@/lib/adminUserQuery";
import type { AuditLogOut } from "@/types";

export default function AdminAuditLogsPage() {
  const [params, setParams] = useSearchParams();
  const state = parseAdminAuditQuery(params);
  const [search, setSearch] = useState(state.q);
  const query = useAdminAuditLogs({
    limit: state.pageSize,
    offset: (state.page - 1) * state.pageSize,
    q: state.q || undefined,
    action: state.action || undefined,
    target_type: state.targetType || undefined,
    actor_id: state.actorId,
    sort: state.sort,
    order: state.order,
  });

  useEffect(() => setSearch(state.q), [state.q]);
  const update = (changes: Record<string, string | number | boolean | undefined>) =>
    setParams(setQueryValue(params, changes));
  const sorting = useMemo<SortingState>(
    () => [{ id: state.sort, desc: state.order === "desc" }],
    [state.order, state.sort]
  );
  const changeSorting: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const selected = next[0];
    update({
      sort: (selected?.id as AdminAuditSort | undefined) ?? "created_at",
      order: selected?.desc === false ? "asc" : "desc",
      page: 1,
    });
  };

  const columns = useMemo<ColumnDef<AuditLogOut, unknown>[]>(() => [
    {
      accessorKey: "action",
      header: "Aksiyon",
      cell: ({ row }) => <Badge tone="info">{row.original.action}</Badge>,
    },
    {
      accessorKey: "target_type",
      header: "Hedef",
      cell: ({ row }) => <span className="font-medium">{row.original.target_type}{row.original.target_id ? ` #${row.original.target_id}` : ""}</span>,
    },
    {
      accessorKey: "actor_id",
      header: "Aktör",
      cell: ({ row }) => <span>Admin #{row.original.actor_id}</span>,
    },
    {
      id: "details",
      header: "Açıklama",
      enableSorting: false,
      cell: ({ row }) => <span className="block max-w-md truncate text-xs text-slate-500" title={row.original.details ?? undefined}>{row.original.details || "—"}</span>,
    },
    {
      accessorKey: "created_at",
      header: "Zaman",
      cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{formatDateTime(String(getValue()))}</span>,
    },
  ], []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update({ q: search.trim() || undefined, page: 1 });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 md:grid-cols-[minmax(14rem,1fr)_11rem_9rem_auto]">
          <input aria-label="Denetim kaydı ara" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Aksiyon, hedef veya açıklama ara" className="input" />
          <input aria-label="Hedef türü" value={state.targetType} maxLength={30} onChange={(event) => update({ target: event.target.value || undefined, page: 1 })} placeholder="Hedef türü" className="input" />
          <input aria-label="Admin kimliği" type="number" min={1} value={state.actorId ?? ""} onChange={(event) => update({ actor: event.target.value || undefined, page: 1 })} placeholder="Admin ID" className="input" />
          <div className="flex gap-2">
            <Button type="submit">Ara</Button>
            <Button variant="ghost" onClick={() => { setSearch(""); setParams({}); }}>Temizle</Button>
          </div>
        </div>
      </form>

      {query.isError ? (
        <ErrorState description={getErrorMessage(query.error, "Denetim kayıtları yüklenemedi.")} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          getRowId={(row) => String(row.id)}
          sorting={sorting}
          onSortingChange={changeSorting}
          isLoading={query.isLoading}
          emptyTitle="Denetim kaydı bulunamadı"
          emptyDescription="Filtreleri değiştirerek yeniden deneyin."
          renderMobileRow={(log) => (
            <div>
              <div className="flex items-center justify-between gap-2"><Badge tone="info">{log.action}</Badge><span className="text-xs text-slate-400">{formatDateTime(log.created_at)}</span></div>
              <p className="mt-2 text-sm font-semibold">{log.target_type}{log.target_id ? ` #${log.target_id}` : ""}</p>
              <p className="mt-1 truncate text-xs text-slate-500">Admin #{log.actor_id} · {log.details || "Açıklama yok"}</p>
            </div>
          )}
          page={state.page}
          pageSize={state.pageSize}
          total={query.data?.total ?? 0}
          onPageChange={(page) => update({ page })}
          onPageSizeChange={(size) => update({ limit: size, page: 1 })}
        />
      )}
    </div>
  );
}
