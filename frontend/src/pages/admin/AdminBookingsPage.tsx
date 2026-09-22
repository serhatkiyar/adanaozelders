// Rezervasyon yönetimi — çoklu filtre + satır aksiyonları (iptal / ihtilaf).
//
// ## İP-A7d1 · göç dalgası 1, ekran (b)
//
// Dalganın "çoklu filtre" ekranı: üç bağımsız filtre (serbest metin + iki
// ayrık seçim), sunucu tarafı sıralama (iki anahtar TEK olayda yazılır) ve
// sayfalama. `useUrlDurumu` bugüne dek yalnız tek filtreli pilot ekranda
// (`DamageEventsPage`) kullanılmıştı; buradaki yazım alanı sınanmamıştı.
//
// Göçte değişenler:
//
//   1. **Filtreler `useUrlDurumu`da.** Adres parametrelerinin ADLARI korundu
//      (`q`,`status`,`disputed`,`sort`,`order`,`page`,`limit`): paylaşılmış
//      eski bağlantılar çalışmaya devam eder. Kazanç: varsayılana eşit değer
//      artık adrese yazılmıyor ve sayfa sıfırlama kararı ÇAĞRI YERİNDE
//      tekrarlanmıyor — eskiden her `update(...)` çağrısına elle `page: 1`
//      yazılıyordu ve bir yerde unutulsa kullanıcı boş sayfada kalırdı.
//   2. **Pencere durumu ekranda YOK.** `decision` bir `useState`ti; artık
//      `useDuzenlemeYuzeyi` taşıyor. Kararın TÜRÜ (iptal/ihtilaf/kaldır)
//      yüzeyin hedefinde yaşar.
//   3. **Boş durum AYRIŞTI**: "filtre eşleşmedi" bir düzeltme talimatıdır ve
//      çıkış yolu sunar; "hiç rezervasyon yok" bir durum bildirimidir.
//
// Değer doğrulaması (enum beyaz listesi) `parseAdminBookingQuery`de KALDI:
// `useUrlDurumu` tip ve varsayılan yönetir, `?status=DROP` gibi bir adresi
// eleyemez. Gerekçe `AdminAuditLogsPage`teki notla aynıdır.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef, OnChangeFn, SortingState } from "@tanstack/react-table";
import type { AdminBookingSort } from "@/api/admin";
import { DataTable } from "@/components/admin/data-table";
import { Badge, Button, ConfirmDialog, ErrorState, ReasonDialog } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useAdminBookingList, useAdminCancelBooking, useAdminToggleDisputeBooking } from "@/hooks/useAdmin";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { BOOKING_STATUS_LABEL } from "@/lib/bookingStatus";
import { parseAdminBookingQuery } from "@/lib/adminOperationsQuery";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import { useAuthStore } from "@/store/authStore";
import { BookingStatus, type AdminBookingOut } from "@/types";

const STATUS_TONE: Record<BookingStatus, "warning" | "info" | "danger" | "neutral" | "success"> = {
  PENDING: "warning",
  ACCEPTED: "info",
  REJECTED: "danger",
  CANCELLED: "neutral",
  COMPLETED: "success",
};

/** Adres varsayılanları — anahtar ADLARI eski sürümle birebir aynıdır. */
const VARSAYILAN = {
  q: "",
  status: "",
  disputed: "",
  sort: "created_at",
  order: "desc",
  page: 1,
  limit: 25,
};

type Decision = { kind: "cancel" | "dispute" | "clear"; booking: AdminBookingOut };

function bookingStatus(value: AdminBookingOut["status"]): BookingStatus {
  return Object.values(BookingStatus).includes(value as BookingStatus)
    ? value as BookingStatus
    : BookingStatus.PENDING;
}

export default function AdminBookingsPage() {
  // `sort`/`order` FİLTRE DEĞİLDİR: farklı sıralamada olmak boş durumun
  // metnini "filtreyi temizleyin"e çevirmemeli.
  const { degerler, ayarla, temizle, filtreliMi } = useUrlDurumu(VARSAYILAN, {
    sayfaAnahtari: "page",
    filtreDisi: ["page", "limit", "sort", "order"],
  });

  const state = useMemo(
    () =>
      parseAdminBookingQuery(
        new URLSearchParams(
          Object.entries(degerler)
            .filter(([, v]) => v !== "" && v !== undefined)
            .map(([k, v]) => [k, String(v)] as [string, string])
        )
      ),
    [degerler]
  );

  const [search, setSearch] = useState(state.q);
  // Pencere durumu ekranda DEĞİL: hangi kararın sorulduğu yüzeyin hedefidir.
  const yuzey = useDuzenlemeYuzeyi<Decision, void>();
  const karar = yuzey.kayit;

  const query = useAdminBookingList({
    limit: state.pageSize,
    offset: (state.page - 1) * state.pageSize,
    q: state.q || undefined,
    status: state.status,
    is_disputed: state.isDisputed,
    sort: state.sort,
    order: state.order,
  });
  const cancel = useAdminCancelBooking();
  const dispute = useAdminToggleDisputeBooking();
  const pending = cancel.isPending || dispute.isPending;
  const canManage = useAuthStore((store) => store.user?.admin_permissions?.includes("bookings.manage")) ?? false;

  useEffect(() => setSearch(state.q), [state.q]);

  const sorting = useMemo<SortingState>(
    () => [{ id: state.sort, desc: state.order === "desc" }],
    [state.order, state.sort]
  );
  const changeSorting: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const selected = next[0];
    // Tek çağrı = tek geçmiş girdisi; sayfa sıfırlaması kancanın işidir.
    ayarla({
      sort: (selected?.id as AdminBookingSort | undefined) ?? "created_at",
      order: selected?.desc === false ? "asc" : "desc",
    });
  };

  const actions = (booking: AdminBookingOut) => canManage ? (
    <div className="flex flex-wrap gap-2">
      {booking.is_disputed ? (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => yuzey.ac({ kind: "clear", booking })}>İhtilafı kaldır</Button>
      ) : (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => yuzey.ac({ kind: "dispute", booking })}>İhtilaf işaretle</Button>
      )}
      {booking.status !== BookingStatus.CANCELLED && booking.status !== BookingStatus.REJECTED && (
        <Button size="sm" variant="danger" disabled={pending} onClick={() => yuzey.ac({ kind: "cancel", booking })}>İptal / iade</Button>
      )}
    </div>
  ) : <span className="text-xs text-slate-400">Salt okunur</span>;

  const columns = useMemo<ColumnDef<AdminBookingOut, unknown>[]>(() => [
    {
      id: "parties",
      header: "Taraflar",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-48">
          <Link to={ROUTES.adminUser("tutor", row.original.tutor_id)} className="font-semibold text-panel-accent-text hover:underline">{row.original.tutor_name || `Öğretmen #${row.original.tutor_id}`}</Link>
          <span className="mx-1.5 text-slate-300">↔</span>
          <Link to={ROUTES.adminUser("client", row.original.client_id)} className="font-semibold text-panel-accent-text hover:underline">{row.original.client_name || `Öğrenci #${row.original.client_id}`}</Link>
        </div>
      ),
    },
    {
      accessorKey: "start_at",
      header: "Ders zamanı",
      cell: ({ row }) => <div className="whitespace-nowrap text-xs"><p>{formatDateTime(row.original.start_at)}</p><p className="text-slate-400">Bitiş: {formatDateTime(row.original.end_at)}</p></div>,
    },
    {
      accessorKey: "price",
      header: "Tutar",
      cell: ({ getValue }) => <span className="whitespace-nowrap font-medium">{formatTRY(getValue() as number | null)}</span>,
    },
    {
      accessorKey: "status",
      header: "Durum",
      cell: ({ row }) => {
        const status = bookingStatus(row.original.status);
        return <div className="flex flex-col items-start gap-1"><Badge tone={STATUS_TONE[status]}>{BOOKING_STATUS_LABEL[status]}</Badge>{row.original.is_disputed && <Badge tone="warning">İhtilaflı</Badge>}</div>;
      },
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
      cell: ({ row }) => actions(row.original),
    },
  ], [canManage, pending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    ayarla({ q: search.trim() });
  };
  const close = () => yuzey.kapat();
  const filtreleriTemizle = () => {
    setSearch("");
    temizle();
  };
  const submitReason = (reason: string) => {
    if (!karar) return;
    if (karar.kind === "cancel") {
      cancel.mutate(
        { id: karar.booking.id, reason },
        {
          onSuccess: () => { toast.success("Rezervasyon iptal edildi."); close(); },
          onError: (error) => toast.error(getErrorMessage(error, "Rezervasyon iptal edilemedi.")),
        }
      );
    } else {
      dispute.mutate(
        { id: karar.booking.id, is_disputed: true, admin_notes: reason },
        {
          onSuccess: () => { toast.success("Rezervasyon ihtilaflı olarak işaretlendi."); close(); },
          onError: (error) => toast.error(getErrorMessage(error, "İhtilaf kaydedilemedi.")),
        }
      );
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12">
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ">
        <div className="grid gap-3 md:grid-cols-[minmax(15rem,1fr)_11rem_11rem_auto]">
          <input aria-label="Rezervasyon ara" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Öğretmen, öğrenci veya e-posta ara" className="input" />
          <select aria-label="Rezervasyon durumu" value={degerler.status} onChange={(event) => ayarla({ status: event.target.value })} className="input">
            <option value="">Tüm durumlar</option>
            {Object.values(BookingStatus).map((status) => <option key={status} value={status}>{BOOKING_STATUS_LABEL[status]}</option>)}
          </select>
          <select aria-label="İhtilaf durumu" value={degerler.disputed} onChange={(event) => ayarla({ disputed: event.target.value })} className="input">
            <option value="">Tüm ihtilaflar</option>
            <option value="true">Yalnız ihtilaflı</option>
            <option value="false">İhtilafsız</option>
          </select>
          <div className="flex gap-2"><Button type="submit">Ara</Button><Button variant="ghost" onClick={filtreleriTemizle}>Temizle</Button></div>
        </div>
      </form>

      {query.isError ? (
        <ErrorState description={getErrorMessage(query.error, "Rezervasyonlar yüklenemedi.")} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          getRowId={(row) => String(row.id)}
          isLoading={query.isLoading}
          /* "Filtre eşleşmedi" ile "hiç kayıt yok" AYRI ekranlardır. */
          emptyTitle={filtreliMi ? "Bu filtreyle rezervasyon bulunamadı" : "Rezervasyon yok"}
          emptyDescription={
            filtreliMi
              ? "Aradığınız ölçütlere uyan rezervasyon yok. Filtreleri temizleyip tüm listeye bakabilirsiniz."
              : "Öğrenciler öğretmenlerden ders talep ettikçe rezervasyonlar burada listelenir."
          }
          emptyAction={
            filtreliMi ? (
              <Button size="sm" variant="secondary" onClick={filtreleriTemizle}>
                Filtreleri temizle
              </Button>
            ) : undefined
          }
          sorting={sorting}
          onSortingChange={changeSorting}
          renderMobileRow={(booking) => {
            const status = bookingStatus(booking.status);
            return (
              <div>
                <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{booking.tutor_name} ↔ {booking.client_name}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(booking.start_at)} · {formatTRY(booking.price)}</p></div><Badge tone={STATUS_TONE[status]}>{BOOKING_STATUS_LABEL[status]}</Badge></div>
                {booking.admin_notes && <p className="mt-2 text-xs text-amber-700">Admin notu: {booking.admin_notes}</p>}
                {booking.cancel_reason && <p className="mt-2 text-xs text-rose-600">İptal: {booking.cancel_reason}</p>}
                <div className="mt-3">{actions(booking)}</div>
              </div>
            );
          }}
          page={state.page}
          pageSize={state.pageSize}
          total={query.data?.total ?? 0}
          onPageChange={(page) => ayarla({ page })}
          onPageSizeChange={(size) => ayarla({ limit: size })}
        />
      )}

      <ReasonDialog
        open={karar?.kind === "cancel" || karar?.kind === "dispute"}
        title={karar?.kind === "cancel" ? "Rezervasyonu iptal et" : "İhtilaf işaretle"}
        description="Gerekçe rezervasyon kaydına ve denetim izine yazılacak."
        label={karar?.kind === "cancel" ? "İptal gerekçesi" : "İhtilaf gerekçesi"}
        required
        minLength={3}
        maxLength={500}
        danger={karar?.kind === "cancel"}
        confirmLabel={karar?.kind === "cancel" ? "İptal et" : "İhtilaf işaretle"}
        isPending={pending}
        onClose={close}
        onConfirm={submitReason}
      />
      <ConfirmDialog
        open={karar?.kind === "clear"}
        title="İhtilafı kaldır"
        description="Rezervasyonun ihtilaf işareti kaldırılacak."
        confirmLabel="İhtilafı kaldır"
        isPending={dispute.isPending}
        onClose={close}
        onConfirm={() => {
          if (!karar) return;
          dispute.mutate(
            { id: karar.booking.id, is_disputed: false },
            {
              onSuccess: () => { toast.success("İhtilaf işareti kaldırıldı."); close(); },
              onError: (error) => toast.error(getErrorMessage(error, "İhtilaf kaldırılamadı.")),
            }
          );
        }}
      />
    </div>
  );
}
