import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef, OnChangeFn, SortingState } from "@tanstack/react-table";
import { DataTable } from "@/components/admin/data-table";
import { Badge, Button, Dialog, ErrorState } from "@/components/admin/ui";
import { useAdminAuditLogs } from "@/hooks/useAdmin";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { parseAdminAuditQuery, type AdminAuditSort } from "@/lib/adminOperationsQuery";
import { setQueryValue } from "@/lib/adminUserQuery";
import type { AuditLogOut } from "@/types";

const ACTOR_ROLE_LABEL: Record<number, string> = {
  1: "Admin",
  2: "Eğitmen",
  3: "Öğrenci",
  4: "Operatör",
  5: "Kurye",
};

function actorLabel(log: AuditLogOut): string {
  return `${ACTOR_ROLE_LABEL[log.actor_role] ?? "Kullanıcı"} #${log.actor_id}`;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-700 dark:text-slate-300">{children}</dd>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** Tek kaydın tüm yapılandırılmış alanları — satıra tıklayınca açılır. */
function AuditDetailDialog({ log, onClose }: { log: AuditLogOut | null; onClose: () => void }) {
  return (
    <Dialog open={log !== null} title="Denetim kaydı" onClose={onClose}>
      {log && (
        <div>
          <dl className="divide-y divide-slate-100 dark:divide-slate-800">
            <DetailRow label="Aksiyon"><Badge tone="info">{log.action}</Badge></DetailRow>
            <DetailRow label="Hedef">{log.target_type}{log.target_id ? ` #${log.target_id}` : ""}</DetailRow>
            <DetailRow label="Aktör">{actorLabel(log)}</DetailRow>
            <DetailRow label="Zaman">{formatDateTime(log.created_at)}</DetailRow>
            {log.reason && <DetailRow label="Gerekçe">{log.reason}</DetailRow>}
            {log.details && <DetailRow label="Açıklama">{log.details}</DetailRow>}
            {log.ip_address && <DetailRow label="IP">{log.ip_address}</DetailRow>}
            {log.request_id && (
              <DetailRow label="Request ID">
                <code className="break-all text-xs">{log.request_id}</code>
              </DetailRow>
            )}
          </dl>
          {log.before_values && Object.keys(log.before_values).length > 0 && (
            <JsonBlock label="Önce" value={log.before_values} />
          )}
          {log.after_values && Object.keys(log.after_values).length > 0 && (
            <JsonBlock label="Sonra" value={log.after_values} />
          )}
          {log.meta && Object.keys(log.meta).length > 0 && (
            <JsonBlock label="Ek bilgi" value={log.meta} />
          )}
        </div>
      )}
    </Dialog>
  );
}

export default function AdminAuditLogsPage() {
  const [params, setParams] = useSearchParams();
  const state = parseAdminAuditQuery(params);
  const [search, setSearch] = useState(state.q);
  const [requestId, setRequestId] = useState(state.requestId);
  const [selected, setSelected] = useState<AuditLogOut | null>(null);
  const query = useAdminAuditLogs({
    limit: state.pageSize,
    offset: (state.page - 1) * state.pageSize,
    q: state.q || undefined,
    action: state.action || undefined,
    target_type: state.targetType || undefined,
    actor_id: state.actorId,
    request_id: state.requestId || undefined,
    sort: state.sort,
    order: state.order,
  });

  useEffect(() => setSearch(state.q), [state.q]);
  useEffect(() => setRequestId(state.requestId), [state.requestId]);
  const update = (changes: Record<string, string | number | boolean | undefined>) =>
    setParams(setQueryValue(params, changes));
  const sorting = useMemo<SortingState>(
    () => [{ id: state.sort, desc: state.order === "desc" }],
    [state.order, state.sort]
  );
  const changeSorting: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const selectedSort = next[0];
    update({
      sort: (selectedSort?.id as AdminAuditSort | undefined) ?? "created_at",
      order: selectedSort?.desc === false ? "asc" : "desc",
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
      cell: ({ row }) => <span>{actorLabel(row.original)}</span>,
    },
    {
      id: "details",
      header: "Gerekçe / Açıklama",
      enableSorting: false,
      cell: ({ row }) => {
        const text = row.original.reason || row.original.details;
        return <span className="block max-w-md truncate text-xs text-slate-500" title={text ?? undefined}>{text || "—"}</span>;
      },
    },
    {
      accessorKey: "created_at",
      header: "Zaman",
      cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{formatDateTime(String(getValue()))}</span>,
    },
  ], []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update({ q: search.trim() || undefined, rid: requestId.trim() || undefined, page: 1 });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 md:grid-cols-[minmax(13rem,1fr)_10rem_8rem_11rem_auto]">
          <input aria-label="Denetim kaydı ara" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Aksiyon, hedef, gerekçe ara" className="input" />
          <input aria-label="Hedef türü" value={state.targetType} maxLength={30} onChange={(event) => update({ target: event.target.value || undefined, page: 1 })} placeholder="Hedef türü" className="input" />
          <input aria-label="Admin kimliği" type="number" min={1} value={state.actorId ?? ""} onChange={(event) => update({ actor: event.target.value || undefined, page: 1 })} placeholder="Aktör ID" className="input" />
          <input aria-label="Request ID" value={requestId} maxLength={64} onChange={(event) => setRequestId(event.target.value)} placeholder="Request ID" className="input" />
          <div className="flex gap-2">
            <Button type="submit">Ara</Button>
            <Button variant="ghost" onClick={() => { setSearch(""); setRequestId(""); setParams({}); }}>Temizle</Button>
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
          onRowClick={(row) => setSelected(row)}
          renderMobileRow={(log) => (
            <div>
              <div className="flex items-center justify-between gap-2"><Badge tone="info">{log.action}</Badge><span className="text-xs text-slate-400">{formatDateTime(log.created_at)}</span></div>
              <p className="mt-2 text-sm font-semibold">{log.target_type}{log.target_id ? ` #${log.target_id}` : ""}</p>
              <p className="mt-1 truncate text-xs text-slate-500">{actorLabel(log)} · {log.reason || log.details || "Açıklama yok"}</p>
            </div>
          )}
          page={state.page}
          pageSize={state.pageSize}
          total={query.data?.total ?? 0}
          onPageChange={(page) => update({ page })}
          onPageSizeChange={(size) => update({ limit: size, page: 1 })}
        />
      )}

      <AuditDetailDialog log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
