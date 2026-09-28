import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/admin/data-table";
import { Badge, Button, ErrorState } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import { useAdminReportList, useResolveReport } from "@/hooks/useReports";
import { parseAdminReportQuery } from "@/lib/adminOperationsQuery";
import { setQueryValue } from "@/lib/adminUserQuery";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { useAuthStore } from "@/store/authStore";
import { rolEtiketi } from "@/lib/roles";
import { ROLE_IDS, ReportReason, ReportStatus, type ReportOut } from "@/types";

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
/** Hedef türü etiketleri; değerler (adres/API sözleşmesi) ham kalır. */
const TARGET_LABEL: Record<string, string> = {
  TUTOR: rolEtiketi(ROLE_IDS.TUTOR),
  CLIENT: rolEtiketi(ROLE_IDS.CLIENT),
  REVIEW: "Değerlendirme",
  MESSAGE: "Mesaj",
  BOOKING_COMMENT: "Rezervasyon yorumu",
  PRODUCT_REVIEW: "Ürün değerlendirmesi",
  LIBRARY_REVIEW: "Kütüphane değerlendirmesi",
};
const hedefEtiketi = (tur: string) => TARGET_LABEL[tur] ?? tur;

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
  // Pencere durumu ekranda YAŞAMAZ (İP-A4 sözleşmesi). Karar yüzeyi hem
  // hedefi hem "çöz mü reddet mi" bağlamını taşır.
  const karar = useDuzenlemeYuzeyi<Decision, void>();
  const query = useAdminReportList({
    status: state.status,
    target_type: state.targetType || undefined,
    limit: state.pageSize,
    offset: (state.page - 1) * state.pageSize,
  });
  const canManage = useAuthStore((store) => store.user?.admin_permissions?.includes("reports.manage")) ?? false;
  const update = (changes: Record<string, string | number | boolean | undefined>) =>
    setParams(setQueryValue(params, changes));

  const openDecision = (report: ReportOut, status: Decision["status"]) =>
    karar.ac({ report, status });

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
      cell: ({ row }) => <span className="font-semibold">{hedefEtiketi(row.original.target_type)} #{row.original.target_id}</span>,
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
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
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
            {TARGETS.map((target) => <option key={target} value={target}>{hedefEtiketi(target)}</option>)}
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
                <div><p className="font-semibold">{hedefEtiketi(report.target_type)} #{report.target_id}</p><p className="text-xs text-rose-600">{REASON_LABEL[report.reason]}</p></div>
                <Badge tone={STATUS_TONE[report.status]}>{STATUS_LABEL[report.status]}</Badge>
              </div>
              {report.description && <p className="mt-3 text-sm text-slate-600 ">{report.description}</p>}
              {report.target_snapshot && <p className="mt-2 whitespace-pre-line break-words rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">Bildirilen içerik: {report.target_snapshot}</p>}
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

      <KararPenceresi yuzey={karar} />
    </div>
  );
}

/**
 * Karar penceresi — İP-A7d3'te ortak düzenleme yüzeyine geçti.
 *
 * SK-4 sınıfı bir kusur buradaydı: pencere kendi `Dialog`ını kuruyor, içinde
 * 2000 karakterlik bir moderasyon notu alanı taşıyor ve kirli form bekçisini
 * HİÇ çağırmıyordu. Yönetici gerekçeyi yazıp yanlışlıkla dışarı tıkladığında
 * metin sormadan gidiyordu — üstelik bu, hakkında karar verilen içeriğin
 * yayından kaldırılıp kaldırılmayacağını da içeren bir yüzey.
 */
function KararPenceresi({ yuzey }: { yuzey: DuzenlemeYuzeyiDurumu<Decision, void> }) {
  const karar = yuzey.kayit;
  return (
    <DuzenlemePenceresi
      yuzey={yuzey}
      baslik={karar?.status === ReportStatus.RESOLVED ? "Şikâyeti çöz" : "Şikâyeti reddet"}
      aciklama={
        karar
          ? `${hedefEtiketi(karar.report.target_type)} #${karar.report.target_id} için karar kaydedilecek.`
          : undefined
      }
    >
      {karar && <KararIcerik yuzey={yuzey} karar={karar} />}
    </DuzenlemePenceresi>
  );
}

const kararSemasi = z.object({
  resolution: z.string().max(2000, "Not en fazla 2000 karakter olabilir."),
  hideTarget: z.boolean(),
});

type KararDegerleri = z.infer<typeof kararSemasi>;

function KararIcerik({
  yuzey,
  karar,
}: {
  yuzey: DuzenlemeYuzeyiDurumu<Decision, void>;
  karar: Decision;
}) {
  const resolve = useResolveReport();
  const moderable = isModeratable(karar.report);

  const form = useForm<KararDegerleri>({
    resolver: zodResolver(kararSemasi),
    defaultValues: {
      resolution: "",
      // Varsayılan: şikayeti çözerken içeriği de kaldır. Bir yorum hakkındaki
      // şikayet haklı bulunduysa yorumun yayında kalması beklenmez; yine de
      // admin bu kutuyu kaldırabilir (ör. yorum uygun, şikayet asılsız).
      hideTarget: karar.status === ReportStatus.RESOLVED && moderable,
    },
    mode: "onChange",
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: resolve.error });

  const gonder = form.handleSubmit(
    (deger) => {
      form.clearErrors("root.sunucu");
      resolve.mutate(
        {
          id: karar.report.id,
          status: karar.status,
          resolution: deger.resolution.trim() || undefined,
          hideTarget: deger.hideTarget && moderable,
        },
        {
          onSuccess: () => {
            toast.success("Şikâyet kararı kaydedildi.");
            yuzey.kapat();
          },
          onError: (error) => {
            const kalan = sunucuHatasiniUygula(error, form, ["resolution"], undefined, (h) =>
              getErrorMessage(h, "Karar kaydedilemedi.")
            );
            form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
          },
        }
      );
    },
    (hatalar) => {
      if (hatalar.resolution) form.setFocus("resolution");
    }
  );

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <div className="space-y-4">
      {genelHata && (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 "
        >
          {genelHata}
        </p>
      )}

      <Form.Field
        control={form.control}
        name="resolution"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Moderasyon notu</Form.Label>
            <Form.Control>
              <textarea
                maxLength={2000}
                rows={5}
                placeholder="Kararın kısa gerekçesi"
                className="input min-h-28 resize-y"
                {...field}
              />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {moderable && (
        <Form.Field
          control={form.control}
          name="hideTarget"
          render={({ field }) => (
            <Form.Item>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  name={field.name}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-marka"
                />
                <span>
                  <span className="font-semibold">Yorumu yayından kaldır</span>
                  <span className="mt-0.5 block text-xs text-slate-500 ">
                    Yorum silinmez; gizlenir ve puan ortalamasından düşülür. Karar geri alınabilir.
                  </span>
                </span>
              </label>
            </Form.Item>
          )}
        />
      )}

      <div className="flex justify-end">
        {/* Düğme geçerlilikle KAPANMAZ (kilitli karar). */}
        <Button
          variant={karar.status === ReportStatus.DISMISSED ? "danger" : "primary"}
          isPending={resolve.isPending}
          onClick={gonder}
        >
          Kararı kaydet
        </Button>
      </div>
    </div>
  );
}
