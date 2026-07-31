import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/admin/data-table";
import { Badge, Button, Dialog, ErrorState } from "@/components/admin/ui";
import { useAdminReportList, useResolveReport } from "@/hooks/useReports";
import { parseAdminReportQuery } from "@/lib/adminOperationsQuery";
import { setQueryValue } from "@/lib/adminUserQuery";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { useAuthStore } from "@/store/authStore";
import { ReportReason, ReportStatus, type ReportOut } from "@/types";

const STATUS_LABEL: Record<ReportStatus, string> = {
  OPEN: "Açık",
  RESOLVED: "Çözüldü",
  DISMISSED: "Reddedildi",
};
const STATUS_TONE: Record<ReportStatus, "warning" | "success" | "neutral"> = {
  OPEN: "warning",
  RESOLVED: "success",
  DISMISSED: "neutral",
};
const REASON_LABEL: Record<ReportReason, string> = {
  SPAM: "Spam",
  HARASSMENT: "Taciz / hakaret",
  INAPPROPRIATE: "Uygunsuz içerik",
  CONTACT_INFO: "İletişim bilgisi",
  SCAM: "Dolandırıcılık",
  OTHER: "Diğer",
};
const TARGETS = ["TUTOR", "CLIENT", "REVIEW", "MESSAGE", "BOOKING_COMMENT"];

/** Yayından kaldırılabilen hedefler (backend: services/content_moderation.py).
 *  Kullanıcı ve mesaj bu akıştan gizlenmez — onların yaptırımı askı/silme. */
const MODERATABLE_TARGETS = ["REVIEW", "PRODUCT_REVIEW", "LIBRARY_REVIEW"];

const isModeratable = (report: ReportOut) =>
  MODERATABLE_TARGETS.includes(report.target_type);

interface Decision {
  report: ReportOut;
  status: ReportStatus.RESOLVED | ReportStatus.DISMISSED;
}

export default function AdminReportsPage() {
  const [params, setParams] = useSearchParams();
  const state = parseAdminReportQuery(params);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [resolution, setResolution] = useState("");
  const [hideTarget, setHideTarget] = useState(false);
  const query = useAdminReportList({
    status: state.status,
    target_type: state.targetType || undefined,
    limit: state.pageSize,
    offset: (state.page - 1) * state.pageSize,
  });
  const resolve = useResolveReport();
  const canManage = useAuthStore((store) => store.user?.admin_permissions?.includes("reports.manage")) ?? false;
  const update = (changes: Record<string, string | number | boolean | undefined>) =>
    setParams(setQueryValue(params, changes));

  const openDecision = (report: ReportOut, status: Decision["status"]) => {
    setResolution("");
    // Varsayılan: şikayeti çözerken içeriği de kaldır. Bir yorum hakkındaki
    // şikayet haklı bulunduysa yorumun yayında kalması beklenmez; yine de
    // admin bu kutuyu kaldırabilir (ör. yorum uygun, şikayet asılsız).
    setHideTarget(status === ReportStatus.RESOLVED && isModeratable(report));
    setDecision({ report, status });
  };
  const submitDecision = () => {
    if (!decision) return;
    resolve.mutate(
      {
        id: decision.report.id,
        status: decision.status,
        resolution: resolution.trim() || undefined,
        hideTarget: hideTarget && isModeratable(decision.report),
      },
      {
        onSuccess: () => {
          toast.success("Şikâyet kararı kaydedildi.");
          setDecision(null);
        },
        onError: (error) => toast.error(getErrorMessage(error, "Karar kaydedilemedi.")),
      }
    );
  };

  const actionButtons = (report: ReportOut) => canManage && report.status === ReportStatus.OPEN ? (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => openDecision(report, ReportStatus.RESOLVED)}>Çöz</Button>
      <Button size="sm" variant="secondary" onClick={() => openDecision(report, ReportStatus.DISMISSED)}>Reddet</Button>
    </div>
  ) : <span className="text-xs text-slate-400">{canManage ? "Karar verildi" : "Salt okunur"}</span>;

  const columns = useMemo<ColumnDef<ReportOut, unknown>[]>(() => [
    {
      id: "target",
      header: "Hedef",
      enableSorting: false,
      cell: ({ row }) => <span className="font-semibold">{row.original.target_type} #{row.original.target_id}</span>,
    },
    {
      accessorKey: "reason",
      header: "Neden",
      enableSorting: false,
      cell: ({ row }) => <span>{REASON_LABEL[row.original.reason]}</span>,
    },
    {
      id: "reporter",
      header: "Bildiren",
      enableSorting: false,
      cell: ({ row }) => <span className="text-xs">Rol {row.original.reporter_role} · #{row.original.reporter_id}</span>,
    },
    {
      accessorKey: "status",
      header: "Durum",
      enableSorting: false,
      cell: ({ row }) => <Badge tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge>,
    },
    {
      accessorKey: "created_at",
      header: "Tarih",
      enableSorting: false,
      cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{formatDateTime(String(getValue()))}</span>,
    },
    {
      id: "actions",
      header: "İşlem",
      enableSorting: false,
      cell: ({ row }) => actionButtons(row.original),
    },
  ], [canManage]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-semibold text-slate-500">Durum</span>
          <select value={state.status} onChange={(event) => update({ status: event.target.value, page: 1 })} className="input">
            <option value="OPEN">Açık</option>
            <option value="RESOLVED">Çözülen</option>
            <option value="DISMISSED">Reddedilen</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-slate-500">Hedef türü</span>
          <select value={state.targetType} onChange={(event) => update({ target: event.target.value || undefined, page: 1 })} className="input">
            <option value="">Tüm hedefler</option>
            {TARGETS.map((target) => <option key={target} value={target}>{target}</option>)}
          </select>
        </label>
      </div>

      {query.isError ? (
        <ErrorState description={getErrorMessage(query.error, "Şikâyetler yüklenemedi.")} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          getRowId={(row) => String(row.id)}
          isLoading={query.isLoading}
          emptyTitle="Bu kuyrukta şikâyet yok"
          emptyDescription="Durum veya hedef filtresini değiştirerek diğer kayıtları inceleyin."
          renderMobileRow={(report) => (
            <div>
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold">{report.target_type} #{report.target_id}</p><p className="text-xs text-rose-600">{REASON_LABEL[report.reason]}</p></div>
                <Badge tone={STATUS_TONE[report.status]}>{STATUS_LABEL[report.status]}</Badge>
              </div>
              {report.description && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{report.description}</p>}
              <div className="mt-3">{actionButtons(report)}</div>
            </div>
          )}
          page={state.page}
          pageSize={state.pageSize}
          total={query.data?.total ?? 0}
          onPageChange={(page) => update({ page })}
          onPageSizeChange={(size) => update({ limit: size, page: 1 })}
        />
      )}

      <Dialog
        open={decision !== null}
        onClose={() => !resolve.isPending && setDecision(null)}
        title={decision?.status === ReportStatus.RESOLVED ? "Şikâyeti çöz" : "Şikâyeti reddet"}
        description={decision ? `${decision.report.target_type} #${decision.report.target_id} için karar kaydedilecek.` : undefined}
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Moderasyon notu</span>
          <textarea value={resolution} onChange={(event) => setResolution(event.target.value)} maxLength={2000} rows={5} className="input min-h-28 resize-y" placeholder="Kararın kısa gerekçesi" />
        </label>
        {decision && isModeratable(decision.report) && (
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={hideTarget}
              onChange={(event) => setHideTarget(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600"
            />
            <span>
              <span className="font-semibold">Yorumu yayından kaldır</span>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                Yorum silinmez; gizlenir ve puan ortalamasından düşülür. Karar geri alınabilir.
              </span>
            </span>
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" disabled={resolve.isPending} onClick={() => setDecision(null)}>Vazgeç</Button>
          <Button variant={decision?.status === ReportStatus.DISMISSED ? "danger" : "primary"} isPending={resolve.isPending} onClick={submitDecision}>Kararı kaydet</Button>
        </div>
      </Dialog>
    </div>
  );
}
