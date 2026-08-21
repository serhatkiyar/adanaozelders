import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { formatDateTime } from "@/lib/datetime";
import { formatTL } from "@/lib/money";
import { getErrorDetail, getErrorMessage } from "@/lib/errors";
import {
  useFailedOutbox,
  useRetryOutboxEvent,
  useStuckEscrow,
} from "@/hooks/useAdminOperations";
import { toast } from "@/store/toastStore";
import type {
  FailedOutboxEvent,
  StuckEscrowEntity,
  StuckEscrowRecord,
} from "@/types";

/**
 * Hata Çözme — sıkışmış para + ölü iş (P1-4).
 *
 * Denetim raporu: `escrow_reconciler` deneme sınırı dolan iadeyi
 * `logger.error("MANUEL müdahale gerekli")` ile bırakıyor, outbox dead-letter
 * satırlarını hiçbir uç göstermiyordu. Sarkan para ve ölü SMS/e-posta işi
 * YALNIZ sunucu logundan görülebiliyor, düzeltmesi YALNIZ SQL'den yapılıyordu.
 *
 * Ekran bilinçli olarak SAKİN ve dar: iki liste, tek aksiyon. "Elle iade et"
 * düğmesi YOKTUR — iade kararının tek sahibi `services/escrow.py`'nin iki fazlı
 * claim'idir (İP-2a sözleşmesi); buradan ikinci bir para yolu açmak o güvenliği
 * geri alırdı. Yönetici sağlayıcı referansını görür ve mutabakatı orada yapar.
 *
 * Başlık `AdminPageHeader` tarafından basılır; sayfa kendi <h1>'ini basmaz.
 */
export default function AdminOperationsPage() {
  const { canView, canManage } = useAdminAreaAccess("operations");
  if (!canView) return <AccessDenied area="Hata çözme" />;

  return (
    <div className="space-y-10">
      <StuckEscrowSection />
      <FailedOutboxSection canManage={canManage} />
    </div>
  );
}

/* ─── Sıkışmış para ──────────────────────────────────────────────────────── */

const ENTITY_LABEL: Record<StuckEscrowEntity, string> = {
  payment: "Ders ödemesi",
  exam_registration: "Deneme bileti",
  study_reservation: "Çalışma rezervasyonu",
  order: "Sipariş",
  order_return: "İade talebi",
};

function StuckEscrowSection() {
  const { data, isLoading, isError, error, refetch } = useStuckEscrow();

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Sıkışmış para
        </h2>
        <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Otomatik mutabakatın artık çözemeyeceği kayıtlar. Sağlayıcı
          referansıyla panelde eşleştirip sonucu elle yazın; buradan para
          hareketi başlatılmaz.
        </p>
      </header>

      {isLoading ? (
        <YuklemeSeridi />
      ) : isError ? (
        <ErrorState
          description={getErrorMessage(error, "Sıkışmış para listesi yüklenemedi.")}
          onRetry={() => void refetch()}
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Sıkışmış para kaydı yok"
          description="Otomatik mutabakat şu an her kaydı sonuca sürebiliyor."
        />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {data.map((k) => (
            <StuckRow key={`${k.entity}-${k.entity_id}`} kayit={k} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StuckRow({ kayit }: { kayit: StuckEscrowRecord }) {
  const manuel = kayit.reason === "MANUAL_REVIEW";
  return (
    <li className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            {/* Backend yeni bir escrow yüzeyi eklerse etiket eksik kalabilir;
                satır BOŞ görünmesin — ham `entity` değeri en azından teşhis
                edilebilir bir metindir. */}
            {ENTITY_LABEL[kayit.entity] ?? kayit.entity} #{kayit.entity_id}
          </span>
          <Badge tone={manuel ? "danger" : "warning"}>
            {manuel ? "Manuel inceleme" : "Deneme tükendi"}
          </Badge>
          {kayit.order_id !== null && kayit.order_id !== kayit.entity_id && (
            <span className="text-xs text-slate-400">Sipariş #{kayit.order_id}</span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {kayit.amount ? formatTL(kayit.amount) : "—"} · durum{" "}
          {kayit.money_status} · {kayit.refund_attempts} deneme
          {kayit.refund_requested_at
            ? ` · ilk niyet ${formatDateTime(kayit.refund_requested_at)}`
            : ""}
        </p>
        <p className="break-all font-mono text-[11px] text-slate-400 dark:text-slate-500">
          Sağlayıcı referansı: {kayit.provider_ref ?? "—"}
        </p>
      </div>
      <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
        {kayit.updated_at ? formatDateTime(kayit.updated_at) : ""}
      </span>
    </li>
  );
}

/* ─── Ölü işler (outbox dead-letter) ─────────────────────────────────────── */

function FailedOutboxSection({ canManage }: { canManage: boolean }) {
  const { data, isLoading, isError, error, refetch } = useFailedOutbox();
  // Pencere durumu ekranda YASAMAZ (IP-A4 sozlesmesi): yeniden kuyruklanacak
  // olay yuzeyin HEDEFIDIR.
  const yuzey = useDuzenlemeYuzeyi<FailedOutboxEvent, void>();
  const retry = useRetryOutboxEvent();

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Ölü işler
        </h2>
        <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Deneme tavanını aşmış bildirim işleri. Yeniden denemek işi kuyruğa
          geri koyar; gönderilmiş bir bildirim ikinci kez gönderilmez.
        </p>
      </header>

      {isLoading ? (
        <YuklemeSeridi />
      ) : isError ? (
        <ErrorState
          description={getErrorMessage(error, "Ölü iş listesi yüklenemedi.")}
          onRetry={() => void refetch()}
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Ölü iş yok"
          description="Bildirim kuyruğunda tavana çarpmış bir iş bulunmuyor."
        />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {data.map((is) => (
            <li
              key={is.id}
              className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                    {is.kind}
                  </span>
                  <span className="text-xs text-slate-400">#{is.id}</span>
                  {is.order_id !== null && (
                    <span className="text-xs text-slate-400">
                      Sipariş #{is.order_id}
                    </span>
                  )}
                </div>
                <p className="break-words text-xs text-rose-600 dark:text-rose-400">
                  {is.last_error ?? "Hata metni yok"}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {is.attempts} deneme
                  {is.updated_at ? ` · son ${formatDateTime(is.updated_at)}` : ""}
                </p>
              </div>
              {canManage && (
                <Button size="sm" variant="secondary" className="shrink-0" onClick={() => yuzey.ac(is)}>
                  Yeniden dene
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={yuzey.acik}
        title="İşi yeniden kuyruğa al"
        description={
          yuzey.kayit
            ? `"${yuzey.kayit.kind}" işi (#${yuzey.kayit.id}) yeniden gönderilmek üzere kuyruğa alınacak. Bu işlem müşteriye giden bir bildirimi tetikleyebilir.`
            : ""
        }
        confirmLabel="İşi yeniden kuyruğa al"
        isPending={retry.isPending}
        onClose={yuzey.kapat}
        onConfirm={() =>
          yuzey.kayit &&
          retry.mutate(yuzey.kayit.id, {
            onSuccess: (sonuc) => {
              toast.success(
                sonuc.requeued
                  ? "İş yeniden kuyruğa alındı."
                  : "İş zaten kuyrukta bekliyordu; yeniden kuyruğa alınmadı."
              );
              yuzey.kapat();
            },
            onError: (err) =>
              // 409'un gerekçesi ("Gönderilmiş bir bildirim ikinci kez
              // gönderilmez") operatör için eyleme dönüşür; genel metin dönüşmez.
              toast.error(getErrorDetail(err, "İş yeniden kuyruğa alınamadı.")),
          })
        }
      />
    </section>
  );
}

function YuklemeSeridi() {
  return (
    <div aria-label="Yükleniyor" aria-busy="true" className="space-y-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800"
        />
      ))}
    </div>
  );
}
