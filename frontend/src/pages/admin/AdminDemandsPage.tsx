import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ColumnDef, OnChangeFn, SortingState } from "@tanstack/react-table";
import { DataTable } from "@/components/admin/data-table";
import { Badge, Button, ErrorState, ReasonDialog } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useAdminDemands, useCancelAdminDemand } from "@/hooks/useAdmin";
import { parseAdminDemandQuery } from "@/lib/adminOperationsQuery";
import { setQueryValue } from "@/lib/adminUserQuery";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import { useAuthStore } from "@/store/authStore";
import { DemandStatus, type AdminDemandOut } from "@/types";
import type { AdminDemandSort } from "@/api/admin";

const STATUS_LABEL: Record<DemandStatus, string> = {
  OPEN: "Açık",
  CLOSED: "Kapatıldı",
  CANCELLED: "İptal edildi",
};

const STATUS_TONE: Record<DemandStatus, "success" | "neutral" | "danger"> = {
  OPEN: "success",
  CLOSED: "neutral",
  CANCELLED: "danger",
};

function budgetLabel(demand: AdminDemandOut): string {
  if (demand.budget_min && demand.budget_max) {
    return `${formatTRY(demand.budget_min)} – ${formatTRY(demand.budget_max)}`;
  }
  if (demand.budget_min) return `${formatTRY(demand.budget_min)} ve üzeri`;
  if (demand.budget_max) return `${formatTRY(demand.budget_max)}'ye kadar`;
  return "Belirtilmedi";
}

export default function AdminDemandsPage() {
  const [params, setParams] = useSearchParams();
  const state = parseAdminDemandQuery(params);
  const [search, setSearch] = useState(state.q);
  // Pencere durumu ekranda YASAMAZ (IP-A4 sozlesmesi): iptal edilecek talep
  // yuzeyin HEDEFIDIR, ekranin yerel durumu degil.
  const iptal = useDuzenlemeYuzeyi<AdminDemandOut, void>();
  const cancelling = iptal.kayit;
  const query = useAdminDemands({
    limit: state.pageSize,
    offset: (state.page - 1) * state.pageSize,
    q: state.q || undefined,
    status: state.status,
    sort: state.sort,
    order: state.order,
  });
  const cancel = useCancelAdminDemand();
  const canManage = useAuthStore((store) => store.user?.admin_permissions?.includes("demands.manage")) ?? false;

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
      sort: (selected?.id as AdminDemandSort | undefined) ?? "created_at",
      order: selected?.desc === false ? "asc" : "desc",
      page: 1,
    });
  };

  const columns = useMemo<ColumnDef<AdminDemandOut, unknown>[]>(() => [
    {
      accessorKey: "title",
      header: "Talep",
      cell: ({ row }) => (
        <div className="max-w-sm">
          <p className="font-semibold text-slate-900 dark:text-white">{row.original.title}</p>
          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500" title={row.original.description ?? undefined}>
            {row.original.description || "Açıklama yok"}
          </p>
        </div>
      ),
    },
    {
      id: "client",
      header: "Öğrenci",
      enableSorting: false,
      cell: ({ row }) => (
        <Link className="font-medium text-indigo-600 hover:underline dark:text-indigo-300" to={ROUTES.adminUser("client", row.original.client_id)}>
          {row.original.client_name}
        </Link>
      ),
    },
    {
      accessorKey: "subject",
      header: "Branş",
      cell: ({ row }) => <span>{row.original.subject}{row.original.level ? ` · ${row.original.level}` : ""}</span>,
    },
    {
      id: "budget",
      header: "Bütçe",
      enableSorting: false,
      cell: ({ row }) => <span className="whitespace-nowrap text-xs">{budgetLabel(row.original)}</span>,
    },
    {
      accessorKey: "response_count",
      header: "Yanıt",
      cell: ({ getValue }) => <Badge tone="info">{Number(getValue())}</Badge>,
    },
    {
      accessorKey: "status",
      header: "Durum",
      cell: ({ row }) => <Badge tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge>,
    },
    {
      accessorKey: "created_at",
      header: "Oluşturma",
      cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{formatDateTime(String(getValue()))}</span>,
    },
    {
      id: "actions",
      header: "İşlem",
      enableSorting: false,
      cell: ({ row }) => canManage && row.original.status === DemandStatus.OPEN ? (
        <Button size="sm" variant="danger" disabled={cancel.isPending} onClick={() => iptal.ac(row.original)}>İptal et</Button>
      ) : <span className="text-xs text-slate-400">{canManage ? "İşlem yok" : "Salt okunur"}</span>,
    },
  ], [canManage, cancel.isPending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update({ q: search.trim() || undefined, page: 1 });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 sm:grid-cols-[minmax(16rem,1fr)_12rem_auto]">
          <input
            aria-label="Öğrenci talebi ara"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Başlık, branş, öğrenci veya e-posta ara"
            className="input"
          />
          <select
            aria-label="Talep durumu"
            value={state.status ?? ""}
            onChange={(event) => update({ status: event.target.value || undefined, page: 1 })}
            className="input"
          >
            <option value="">Tüm durumlar</option>
            {Object.values(DemandStatus).map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
          </select>
          <div className="flex gap-2">
            <Button type="submit">Ara</Button>
            <Button variant="ghost" onClick={() => { setSearch(""); setParams({}); }}>Temizle</Button>
          </div>
        </div>
      </form>

      {query.isError ? (
        <ErrorState description={getErrorMessage(query.error, "Öğrenci talepleri yüklenemedi.")} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          getRowId={(row) => String(row.id)}
          isLoading={query.isLoading}
          emptyTitle="Öğrenci talebi bulunamadı"
          emptyDescription="Arama veya durum filtresini değiştirerek tekrar deneyin."
          sorting={sorting}
          onSortingChange={changeSorting}
          renderMobileRow={(demand) => (
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{demand.title}</p>
                  <p className="text-xs text-slate-500">{demand.subject}{demand.level ? ` · ${demand.level}` : ""}</p>
                </div>
                <Badge tone={STATUS_TONE[demand.status]}>{STATUS_LABEL[demand.status]}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                <Link className="font-medium text-indigo-600 dark:text-indigo-300" to={ROUTES.adminUser("client", demand.client_id)}>{demand.client_name}</Link>
                <span>{demand.response_count} yanıt · {budgetLabel(demand)}</span>
              </div>
              {canManage && demand.status === DemandStatus.OPEN && (
                <Button className="mt-3" size="sm" variant="danger" disabled={cancel.isPending} onClick={() => iptal.ac(demand)}>İptal et</Button>
              )}
            </div>
          )}
          page={state.page}
          pageSize={state.pageSize}
          total={query.data?.total ?? 0}
          onPageChange={(page) => update({ page })}
          onPageSizeChange={(size) => update({ limit: size, page: 1 })}
        />
      )}

      <ReasonDialog
        open={iptal.acik}
        title="Öğrenci talebini iptal et"
        description={cancelling ? `“${cancelling.title}” talebi kapatılacak; işlem denetim kaydına yazılacak.` : ""}
        label="İptal gerekçesi"
        placeholder="İptal gerekçesini açıkça yazın"
        required
        minLength={3}
        maxLength={500}
        confirmLabel="Talebi iptal et"
        danger
        isPending={cancel.isPending}
        onClose={iptal.kapat}
        onConfirm={(reason) => {
          if (!cancelling) return;
          cancel.mutate(
            { id: cancelling.id, reason },
            {
              onSuccess: () => {
                toast.success("Öğrenci talebi iptal edildi.");
                iptal.kapat();
              },
              onError: (error) => toast.error(getErrorMessage(error, "Talep iptal edilemedi.")),
            }
          );
        }}
      />
    </div>
  );
}
