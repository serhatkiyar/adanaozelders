/**
 * Mağaza "Siparişler" sekmesi.
 *
 * ## İP-A6 · Görev 4c/4d/4e — göç
 *
 *   - Üç ham `<button>` ortak `Button`a; takip no alanı gerçek etiket taşıyor.
 *   - "Teslim edildi" ve "İade et" pencerelerinin durumu ekrandan
 *     `ui2/duzenlemeYuzeyi`ne taşındı — bu dosyada pencere `useState`i yok.
 *   - Tabloya `renderMobileRow` eklendi: mobilde yedi kolonlu tablo yatay
 *     kaydırmaya düşüyordu ve satır aksiyonları ekranın dışında kalıyordu.
 *
 * ## Bilinen sınır (TB-A5-2, bu pakette KAPANMADI)
 *
 * Sipariş listesinin SAYFALAMASI yok: `DataTable` `page={1}` ve
 * `pageSize={siparisler.length}` ile besleniyor, kesilme yalnız bir uyarı
 * şeridiyle bildiriliyor. Sayfalama ayrı bir kapsamdır (sunucu tarafı
 * `limit`/`offset` + `X-Total-Count` gerekir); geldiği gün uyarı şeridi
 * KALKMALI (E-5 nöbetçisi onu koruyor).
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, ConfirmDialog, ErrorState, ReasonDialog } from "@/components/admin/ui";
import { DataTable } from "@/components/admin/data-table";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/yuzeyDurumu";
import { Form } from "@/components/admin/ui2/form";
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
  //
  // Pencere durumu EKRANDA yaşamaz (İP-A4 sözleşmesi): hedef sipariş numarası
  // düzenleme yüzeyinde tutulur.
  const teslimYuzeyi = useDuzenlemeYuzeyi<number, void>();

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
      teslimYuzeyi.kapat();
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorDetail(err, "İşlem başarısız")),
  });
  // Gerekçe ZORUNLU (backend `AdminOrderActionIn`): iade denetim izine
  // gerekçesiz yazılamaz, bu yüzden aksiyon önce gerekçe penceresi açar.
  const iadeYuzeyi = useDuzenlemeYuzeyi<number, void>();
  const refund = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      refundOrder(id, reason),
    onSuccess: () => {
      toast.success("İade edildi");
      iadeYuzeyi.kapat();
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
        <span className="font-semibold text-slate-800 ">
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
              <Button size="sm" variant="secondary" onClick={() => teslimYuzeyi.ac(o.id)}>
                Teslim edildi
              </Button>
            )}
            {o.payment_status === "PAID" && (
              <Button size="sm" variant="ghost" onClick={() => iadeYuzeyi.ac(o.id)}>
                İade et
              </Button>
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
        <Form.Item>
          <Form.Label className="mb-1 block text-xs font-medium text-slate-500 ">
            Durum
          </Form.Label>
          <Form.Control>
          <select
            value={durum ?? ""}
            onChange={(e) =>
              setParams((onceki) =>
                setQueryValue(new URLSearchParams(onceki), {
                  durum: e.target.value || undefined,
                })
              )
            }
            className="block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-panel-accent "
          >
            <option value="">Tümü</option>
            {ORDER_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {orderStatusLabel(s)}
              </option>
            ))}
          </select>
          </Form.Control>
        </Form.Item>
      </div>

      <DataTable
        columns={kolonlar}
        data={siparisler}
        getRowId={(o) => String(o.id)}
        isLoading={isLoading}
        // Mobilde yedi kolonlu tablo yatay kaydırmaya düşüyor ve satır
        // aksiyonları ekranın dışında kalıyordu; kart düzeninde aynı veri ve
        // AYNI aksiyonlar görünür (İP-A6 · Görev 4e).
        renderMobileRow={(o) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-slate-800 ">
                #{o.id}
              </span>
              <span className="font-medium">{formatTL(o.total)}</span>
            </div>
            <p className="text-xs text-slate-500">
              {formatDateTime(o.created_at)} ·{" "}
              {o.ship_recipient ?? "Dijital sipariş"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={orderPaymentTone(o.payment_status)}>
                {orderPaymentLabel(o.payment_status)}
              </Badge>
              <Badge tone={orderStatusTone(o.status)}>
                {orderStatusLabel(o.status)}
              </Badge>
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2 pt-1">
                {o.has_physical && o.payment_status === "PAID" && o.status === "PAID" && (
                  <ShipButton onShip={(tracking) => ship.mutate({ id: o.id, tracking })} />
                )}
                {o.status === "SHIPPED" && (
                  <Button size="sm" variant="secondary" onClick={() => teslimYuzeyi.ac(o.id)}>
                    Teslim edildi
                  </Button>
                )}
                {o.payment_status === "PAID" && (
                  <Button size="sm" variant="ghost" onClick={() => iadeYuzeyi.ac(o.id)}>
                    İade et
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
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
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 ">
              Toplam {toplam} siparişin ilk {siparisler.length} tanesi
              gösteriliyor; listenin tamamı bu değil. Daraltmak için durum
              filtresini kullanın.
            </p>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={teslimYuzeyi.acik}
        title="Siparişi teslim edildi işaretle"
        description={`#${teslimYuzeyi.kayit} siparişi teslim edilmiş sayılacak ve teslimat akışı kapanacak.`}
        confirmLabel="Teslim edildi olarak işaretle"
        isPending={deliver.isPending}
        onClose={teslimYuzeyi.kapat}
        onConfirm={() => teslimYuzeyi.kayit !== null && deliver.mutate(teslimYuzeyi.kayit)}
      />

      <ReasonDialog
        open={iadeYuzeyi.acik}
        title="Siparişi iade et"
        description="Gerekçe sipariş geçmişine ve denetim izine yazılacak."
        label="İade gerekçesi"
        required
        minLength={3}
        maxLength={500}
        danger
        confirmLabel="İade et"
        isPending={refund.isPending}
        onClose={iadeYuzeyi.kapat}
        onConfirm={(reason) =>
          iadeYuzeyi.kayit !== null && refund.mutate({ id: iadeYuzeyi.kayit, reason })
        }
      />
    </div>
  );
}

function ShipButton({ onShip }: { onShip: (tracking: string) => void }) {
  const [tracking, setTracking] = useState("");
  return (
    <div className="flex items-end gap-2">
      <Form.Item>
        <Form.Label className="mb-1 block text-[11px] font-medium text-slate-500 ">
          Takip no
        </Form.Label>
        <Form.Control>
          <input
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs "
          />
        </Form.Control>
      </Form.Item>
      <Button size="sm" onClick={() => onShip(tracking)}>
        Kargola
      </Button>
    </div>
  );
}
