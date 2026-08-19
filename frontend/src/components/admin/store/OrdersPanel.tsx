/**
 * Mağaza "Siparişler" sekmesi — İP-A5'te `AdminStore.tsx`ten AYNEN taşındı.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, ConfirmDialog, ErrorState, ReasonDialog } from "@/components/admin/ui";
import { DataTable } from "@/components/admin/data-table";
import { deliverOrder, refundOrder, shipOrder } from "@/api/store";
import { useAdminOrders, useInvalidateAdminStore } from "@/hooks/useStore";
import { setQueryValue } from "@/lib/adminUserQuery";
import { formatDateTime } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { orderPaymentLabel } from "@/lib/orderPayment";
import {
  ORDER_STATUS_FILTERS,
  orderPaymentTone,
  orderStatusLabel,
  orderStatusTone,
} from "@/lib/orderStatus";
import { toast } from "@/store/toastStore";
import type { OrderOut } from "@/types";

export function OrdersPanel() {
  const { canView, canManage } = useAdminAreaAccess("orders");
  const [params, setParams] = useSearchParams();
  // Durum URL'de yaşar: filtreli liste linki paylaşılabilir ve sayfa
  // yenilendiğinde seçim korunur. Beyaz liste, bilinmeyen bir değerin
  // sunucuya gidip 422 üretmesini (ya da sessizce boş liste dönmesini) önler.
  const hamDurum = params.get("durum");
  const durum =
    hamDurum && ORDER_STATUS_FILTERS.includes(hamDurum) ? hamDurum : undefined;
  const { data, isLoading, isError, error, refetch } = useAdminOrders(durum);
  const invalidate = useInvalidateAdminStore();
  // "Teslim edildi" siparişi terminal duruma taşır ve teslimat akışını kapatır;
  // yanlış satıra tıklama geri alınamaz (P1-5 gerekçesi).
  const [teslimSiparisi, setTeslimSiparisi] = useState<number | null>(null);

  const ship = useMutation({
    mutationFn: ({ id, tracking }: { id: number; tracking: string }) => shipOrder(id, tracking),
    onSuccess: () => {
      toast.success("Kargoya verildi");
      invalidate();
    },
  });
  const deliver = useMutation({
    mutationFn: (id: number) => deliverOrder(id),
    onSuccess: () => {
      toast.success("Sipariş teslim edildi olarak işaretlendi");
      setTeslimSiparisi(null);
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorDetail(err, "İşlem başarısız")),
  });
  // Gerekçe ZORUNLU (backend `AdminOrderActionIn`): iade denetim izine
  // gerekçesiz yazılamaz, bu yüzden aksiyon önce gerekçe penceresi açar.
  const [iadeSiparisi, setIadeSiparisi] = useState<number | null>(null);
  const refund = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      refundOrder(id, reason),
    onSuccess: () => {
      toast.success("İade edildi");
      setIadeSiparisi(null);
      invalidate();
    },
    onError: () => toast.error("İade başarısız"),
  });

  if (!canView) return <AccessDenied area="Siparişler" />;
  // P1-6: hata "Sipariş yok." diye gösterilemez.
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "Siparişler yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }
  const siparisler = data?.items ?? [];
  const toplam = data?.total ?? -1;
  // Kesilme, GERÇEK sunucu davranışından okunur: eşleşen toplam, dönen kayıt
  // sayısından büyükse liste kesilmiştir.
  //
  // Önceki hâli sabit `200`e bakıyordu ve üretimde ASLA tetiklenemiyordu
  // (P1-5): istemci `limit` göndermiyor, sunucu varsayılan 100 uyguluyor,
  // `X-Total-Count` dönmüyordu — 130 siparişin 100'ü gösteriliyor ve
  // kullanıcıya hiçbir şey söylenmiyordu. Test ise sahte sunucuya 200 kayıt
  // uydurarak geçiyordu.
  //
  // Sipariş listesinde henüz sayfalama yok (kapsam dışı); geldiği gün bu
  // uyarı KALKMALI, çünkü sayfalı listede toplam zaten görünür ve uyarı
  // yanıltıcı olur (E-5 nöbetçisi bunu koruyor).
  const kesilmisOlabilir = toplam > siparisler.length;

  const kolonlar: ColumnDef<OrderOut, unknown>[] = [
    {
      id: "no",
      accessorFn: (o) => o.id,
      header: "No",
      cell: ({ row }) => (
        <span className="font-semibold text-slate-800 dark:text-slate-200">
          #{row.original.id}
        </span>
      ),
    },
    {
      id: "tarih",
      accessorFn: (o) => o.created_at,
      header: "Tarih",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-slate-500">
          {formatDateTime(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "musteri",
      accessorFn: (o) => o.ship_recipient ?? "",
      header: "Müşteri",
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.ship_recipient ?? (
            <span className="text-slate-400">Dijital sipariş</span>
          )}
        </span>
      ),
    },
    {
      id: "kalem",
      accessorFn: (o) => o.items?.length ?? 0,
      header: "Kalem",
      cell: ({ row }) => {
        const adet = row.original.items?.length ?? 0;
        // Kalem listesi BOŞ ise bu "sipariş boş" demek değildir; eski/bozuk
        // veride `order_items` satırı hiç olmayabilir (bkz. lib/orderItems).
        return adet > 0 ? (
          <span className="text-sm">{adet}</span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        );
      },
    },
    {
      id: "toplam",
      accessorFn: (o) => o.total,
      header: "Toplam",
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-medium">
          {formatTL(row.original.total)}
        </span>
      ),
    },
    {
      id: "odeme",
      accessorFn: (o) => o.payment_status,
      header: "Ödeme",
      cell: ({ row }) => (
        <Badge tone={orderPaymentTone(row.original.payment_status)}>
          {orderPaymentLabel(row.original.payment_status)}
        </Badge>
      ),
    },
    {
      id: "durum",
      accessorFn: (o) => o.status,
      header: "Durum",
      cell: ({ row }) => (
        <Badge tone={orderStatusTone(row.original.status)}>
          {orderStatusLabel(row.original.status)}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const o = row.original;
        if (!canManage) return null;
        return (
          <div className="flex flex-wrap justify-end gap-2">
            {o.has_physical && o.payment_status === "PAID" && o.status === "PAID" && (
              <ShipButton onShip={(tracking) => ship.mutate({ id: o.id, tracking })} />
            )}
            {o.status === "SHIPPED" && (
              <button type="button" onClick={() => setTeslimSiparisi(o.id)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs dark:border-slate-700">
                Teslim edildi
              </button>
            )}
            {o.payment_status === "PAID" && (
              <button type="button" onClick={() => setIadeSiparisi(o.id)} className="rounded-lg border border-rose-200 px-3 py-1 text-xs text-rose-600 dark:border-rose-500/30">
                İade et
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      {!canManage && <ReadOnlyNotice />}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Durum
          <select
            value={durum ?? ""}
            onChange={(e) =>
              setParams((onceki) =>
                setQueryValue(new URLSearchParams(onceki), {
                  durum: e.target.value || undefined,
                })
              )
            }
            className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">Tümü</option>
            {ORDER_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {orderStatusLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DataTable
        columns={kolonlar}
        data={siparisler}
        getRowId={(o) => String(o.id)}
        isLoading={isLoading}
        page={1}
        pageSize={Math.max(siparisler.length, 1)}
        total={siparisler.length}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        emptyTitle={durum ? "Sonuç bulunamadı" : "Henüz sipariş yok"}
        emptyDescription={
          durum
            ? "Bu durumda sipariş bulunmuyor; filtreyi değiştirmeyi deneyin."
            : "İlk sipariş geldiğinde burada görünecek."
        }
        emptyAction={
          durum ? (
            <Button size="sm" variant="secondary" onClick={() => setParams({})}>
              Filtreleri temizle
            </Button>
          ) : undefined
        }
        truncationNotice={
          kesilmisOlabilir ? (
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Toplam {toplam} siparişin ilk {siparisler.length} tanesi
              gösteriliyor; listenin tamamı bu değil. Daraltmak için durum
              filtresini kullanın.
            </p>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={teslimSiparisi !== null}
        title="Siparişi teslim edildi işaretle"
        description={`#${teslimSiparisi} siparişi teslim edilmiş sayılacak ve teslimat akışı kapanacak.`}
        confirmLabel="Teslim edildi olarak işaretle"
        isPending={deliver.isPending}
        onClose={() => setTeslimSiparisi(null)}
        onConfirm={() => teslimSiparisi !== null && deliver.mutate(teslimSiparisi)}
      />

      <ReasonDialog
        open={iadeSiparisi !== null}
        title="Siparişi iade et"
        description="Gerekçe sipariş geçmişine ve denetim izine yazılacak."
        label="İade gerekçesi"
        required
        minLength={3}
        maxLength={500}
        danger
        confirmLabel="İade et"
        isPending={refund.isPending}
        onClose={() => setIadeSiparisi(null)}
        onConfirm={(reason) =>
          iadeSiparisi !== null && refund.mutate({ id: iadeSiparisi, reason })
        }
      />
    </div>
  );
}

function ShipButton({ onShip }: { onShip: (tracking: string) => void }) {
  const [tracking, setTracking] = useState("");
  return (
    <div className="flex gap-2">
      <input
        value={tracking}
        onChange={(e) => setTracking(e.target.value)}
        placeholder="Takip no"
        className="rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
      />
      <button type="button" onClick={() => onShip(tracking)} className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white dark:bg-white dark:text-slate-900">
        Kargola
      </button>
    </div>
  );
}
