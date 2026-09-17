import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Flex, Input, Select, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import type { AdminBookingSort } from "@/api/admin";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ConfirmDialog, ReasonDialog } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import {
  useAdminBookingList,
  useAdminCancelBooking,
  useAdminResolveDisputeBooking,
  useAdminToggleDisputeBooking,
} from "@/hooks/useAdmin";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_PAGE_SIZES,
  parseAdminBookingQuery,
} from "@/lib/adminOperationsQuery";
import { BOOKING_STATUS_LABEL } from "@/lib/bookingStatus";
import { sorunNedeniEtiketi } from "@/lib/dersOnayi";
import { rolEtiketi } from "@/lib/roles";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";
import { ListePage } from "@/panel/components/ListePage";
import { toast } from "@/store/toastStore";
import { BookingStatus, type AdminBookingOut } from "@/types";

const VARSAYILAN = {
  q: "",
  status: "",
  disputed: "",
  sort: "created_at",
  order: "desc",
  page: 1,
  limit: ADMIN_DEFAULT_PAGE_SIZE,
};

const SIRALANABILIR: Record<string, AdminBookingSort> = {
  start_at: "start_at",
  price: "price",
  status: "status",
  created_at: "created_at",
};

const DURUM_RENGI: Partial<Record<BookingStatus, string>> = {
  PENDING: "warning",
  ACCEPTED: "processing",
  REJECTED: "error",
  COMPLETED: "success",
};

type Karar = {
  kind: "cancel" | "dispute" | "clear" | "refund" | "release";
  booking: AdminBookingOut;
};

function rezervasyonDurumu(value: AdminBookingOut["status"]): BookingStatus {
  return Object.values(BookingStatus).includes(value as BookingStatus)
    ? (value as BookingStatus)
    : BookingStatus.PENDING;
}

/** Eski rezervasyon yönetiminin filtre, sıralama ve karar akışlarını yeni liste kabuğuna taşır. */
export function RezervasyonListesi() {
  const { canView, canManage } = useAdminAreaAccess("bookings");
  const { canView: kullaniciDetayiVar } = useAdminAreaAccess("users");
  const { degerler, ayarla, temizle, filtreliMi } = useUrlDurumu(VARSAYILAN, {
    sayfaAnahtari: "page",
    filtreDisi: ["page", "limit", "sort", "order"],
  });
  const durum = useMemo(
    () =>
      parseAdminBookingQuery(
        new URLSearchParams(
          Object.entries(degerler)
            .filter(([, value]) => value !== "" && value !== undefined)
            .map(([key, value]) => [key, String(value)] as [string, string]),
        ),
      ),
    [degerler],
  );
  const [arama, setArama] = useState(durum.q);
  const kararYuzeyi = useDuzenlemeYuzeyi<Karar, void>();
  const karar = kararYuzeyi.kayit;

  const sorgu = useAdminBookingList(
    {
      limit: durum.pageSize,
      offset: (durum.page - 1) * durum.pageSize,
      q: durum.q || undefined,
      status: durum.status,
      is_disputed: durum.isDisputed,
      sort: durum.sort,
      order: durum.order,
    },
    canView,
  );
  const iptal = useAdminCancelBooking();
  const ihtilaf = useAdminToggleDisputeBooking();
  const cozum = useAdminResolveDisputeBooking();
  const mesgul = iptal.isPending || ihtilaf.isPending || cozum.isPending;

  useEffect(() => setArama(durum.q), [durum.q]);

  const filtreleriTemizle = () => {
    setArama("");
    temizle();
  };
  const aramaGonder = (event: FormEvent) => {
    event.preventDefault();
    ayarla({ q: arama.trim() });
  };
  const siralamaDegeri = (alan: AdminBookingSort) =>
    durum.sort === alan ? (durum.order === "asc" ? "ascend" : "descend") : null;

  const taraf = (
    rol: "tutor" | "client",
    id: number,
    ad: string | null | undefined,
  ): ReactNode => {
    // Rol adı elle YAZILMAZ: tek kaynak `lib/roles.ts` (nöbetçi `__guards__/rolEtiketi.test.ts`).
    // Adsız kayıtta rol + kimlik yazılır; "Öğrenci" bir rol adı değildir ("Üye").
    const metin = ad || `${rolEtiketi(rol === "tutor" ? ROLE_IDS.TUTOR : ROLE_IDS.CLIENT)} #${id}`;
    return kullaniciDetayiVar ? (
      <Link to={ROUTES.adminNewCustomer(rol, id)} style={{ fontWeight: 500 }}>
        {metin}
      </Link>
    ) : (
      <Typography.Text strong>{metin}</Typography.Text>
    );
  };

  const aksiyonlar = (booking: AdminBookingOut) => {
    if (!canManage) return <Typography.Text type="secondary">Salt okunur</Typography.Text>;
    return (
      <Flex gap={8} wrap>
        <Button
          disabled={mesgul}
          onClick={() =>
            kararYuzeyi.ac({
              kind: booking.is_disputed ? "clear" : "dispute",
              booking,
            })
          }
        >
          {booking.is_disputed ? "İhtilafı kaldır" : "İhtilaf işaretle"}
        </Button>
        {booking.is_disputed ? (
          <>
            <Button
              disabled={mesgul}
              onClick={() => kararYuzeyi.ac({ kind: "refund", booking })}
            >
              Öğrenciye iade et
            </Button>
            <Button
              disabled={mesgul}
              onClick={() => kararYuzeyi.ac({ kind: "release", booking })}
            >
              Eğitmene öde
            </Button>
          </>
        ) : null}
        {booking.status !== BookingStatus.CANCELLED &&
        booking.status !== BookingStatus.REJECTED &&
        booking.status !== BookingStatus.COMPLETED ? (
          <Button
            danger
            disabled={mesgul}
            onClick={() => kararYuzeyi.ac({ kind: "cancel", booking })}
          >
            İptal / iade
          </Button>
        ) : null}
      </Flex>
    );
  };

  const kolonlar: TableProps<AdminBookingOut>["columns"] = [
    {
      title: "Taraflar",
      key: "parties",
      render: (_, booking) => (
        <Flex gap={6} wrap style={{ minWidth: 220 }}>
          {taraf("tutor", booking.tutor_id, booking.tutor_name)}
          <Typography.Text type="secondary">↔</Typography.Text>
          {taraf("client", booking.client_id, booking.client_name)}
        </Flex>
      ),
    },
    {
      title: "Ders zamanı",
      key: "start_at",
      sorter: true,
      sortOrder: siralamaDegeri("start_at"),
      render: (_, booking) => (
        <div style={{ whiteSpace: "nowrap", fontSize: 12 }}>
          <div>{formatDateTime(booking.start_at)}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Bitiş: {formatDateTime(booking.end_at)}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "Tutar",
      key: "price",
      sorter: true,
      sortOrder: siralamaDegeri("price"),
      render: (_, booking) => (
        <span style={{ whiteSpace: "nowrap", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
          {formatTRY(booking.price)}
        </span>
      ),
    },
    {
      title: "Durum",
      key: "status",
      sorter: true,
      sortOrder: siralamaDegeri("status"),
      render: (_, booking) => {
        const status = rezervasyonDurumu(booking.status);
        return (
          <Flex vertical align="flex-start" gap={4}>
            <Tag color={DURUM_RENGI[status]} style={{ marginInlineEnd: 0 }}>
              {BOOKING_STATUS_LABEL[status]}
            </Tag>
            {booking.is_disputed ? (
              <Tag color="warning" style={{ marginInlineEnd: 0 }}>İhtilaflı</Tag>
            ) : null}
          </Flex>
        );
      },
    },
    {
      title: "Notlar",
      key: "notes",
      render: (_, booking) => (
        <div style={{ minWidth: 180, maxWidth: 320, overflowWrap: "anywhere" }}>
          {booking.issue_reported_at ? (
            <Typography.Text type="danger" style={{ display: "block", fontSize: 12 }}>
              Öğrenci sorunu: {sorunNedeniEtiketi(booking.issue_reason)}
              {booking.issue_note ? ` — ${booking.issue_note}` : ""}
            </Typography.Text>
          ) : null}
          {booking.late_cancel ? (
            <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
              Geç iptal (12 saatten az kala); ücret eğitmene aktarıldı.
            </Typography.Text>
          ) : null}
          {booking.admin_notes ? (
            <Typography.Text type="warning" style={{ display: "block", fontSize: 12 }}>
              Admin notu: {booking.admin_notes}
            </Typography.Text>
          ) : null}
          {booking.cancel_reason ? (
            <Typography.Text type="danger" style={{ display: "block", fontSize: 12 }}>
              İptal: {booking.cancel_reason}
            </Typography.Text>
          ) : null}
          {!booking.admin_notes && !booking.cancel_reason && !booking.issue_reported_at && !booking.late_cancel ? (
            <Typography.Text type="secondary">-</Typography.Text>
          ) : null}
        </div>
      ),
    },
    {
      title: "Oluşturma",
      key: "created_at",
      sorter: true,
      sortOrder: siralamaDegeri("created_at"),
      render: (_, booking) => (
        <span style={{ whiteSpace: "nowrap", fontSize: 12 }}>
          {formatDateTime(booking.created_at)}
        </span>
      ),
    },
    {
      title: "İşlem",
      key: "actions",
      render: (_, booking) => aksiyonlar(booking),
    },
  ];

  const tabloDegisti: TableProps<AdminBookingOut>["onChange"] = (_, __, siralayici) => {
    const secili = Array.isArray(siralayici) ? siralayici[0] : siralayici;
    const alan = secili?.columnKey != null ? SIRALANABILIR[String(secili.columnKey)] : undefined;
    if (!alan || !secili?.order) return ayarla({ sort: "", order: "" });
    ayarla({
      sort: alan === "created_at" ? "" : alan,
      order: secili.order === "ascend" ? "asc" : "",
    });
  };

  const gerekceGonder = (reason: string) => {
    if (!karar) return;
    if (karar.kind === "refund" || karar.kind === "release") {
      cozum.mutate(
        { id: karar.booking.id, decision: karar.kind, note: reason },
        {
          onSuccess: () => {
            toast.success(
              karar.kind === "refund"
                ? "Ders iptal edildi, ücret öğrenciye iade ediliyor."
                : "İhtilaf kapandı, ücret eğitmene aktarıldı.",
            );
            kararYuzeyi.kapat();
          },
          onError: (error) => toast.error(getErrorMessage(error, "Karar kaydedilemedi.")),
        },
      );
      return;
    }
    if (karar.kind === "cancel") {
      iptal.mutate(
        { id: karar.booking.id, reason },
        {
          onSuccess: () => {
            toast.success("Rezervasyon iptal edildi.");
            kararYuzeyi.kapat();
          },
          onError: (error) =>
            toast.error(getErrorMessage(error, "Rezervasyon iptal edilemedi.")),
        },
      );
      return;
    }
    ihtilaf.mutate(
      { id: karar.booking.id, is_disputed: true, admin_notes: reason },
      {
        onSuccess: () => {
          toast.success("Rezervasyon ihtilaflı olarak işaretlendi.");
          kararYuzeyi.kapat();
        },
        onError: (error) =>
          toast.error(getErrorMessage(error, "İhtilaf kaydedilemedi.")),
      },
    );
  };

  if (!canView) return <AccessDenied area="Rezervasyonlar" />;

  return (
    <>
      <ListePage<AdminBookingOut>
        baslik="Rezervasyonlar"
        aciklama={
          canManage
            ? "Ders rezervasyonlarını, iptal/iade kararlarını ve ihtilaf durumlarını yönetin."
            : "Salt okunur görünüm: rezervasyon işlemleri için bookings.manage izni gerekir."
        }
        ustIcerik={
          <form onSubmit={aramaGonder}>
            <Flex gap={8} wrap>
              <Input
                aria-label="Rezervasyon ara"
                value={arama}
                maxLength={100}
                placeholder="Eğitmen, öğrenci veya e-posta ara"
                onChange={(event) => setArama(event.target.value)}
                style={{ width: 320, maxWidth: "100%" }}
              />
              <Select
                aria-label="Rezervasyon durumu"
                allowClear
                placeholder="Tüm durumlar"
                value={degerler.status || undefined}
                options={Object.values(BookingStatus).map((status) => ({
                  value: status,
                  label: BOOKING_STATUS_LABEL[status],
                }))}
                onChange={(value) => ayarla({ status: value ?? "" })}
                style={{ width: 180 }}
              />
              <Select
                aria-label="İhtilaf durumu"
                allowClear
                placeholder="Tüm ihtilaflar"
                value={degerler.disputed || undefined}
                options={[
                  { value: "true", label: "Yalnız ihtilaflı" },
                  { value: "false", label: "İhtilafsız" },
                ]}
                onChange={(value) => ayarla({ disputed: value ?? "" })}
                style={{ width: 180 }}
              />
              <Button type="primary" htmlType="submit">Ara</Button>
              <Button onClick={filtreleriTemizle}>Temizle</Button>
            </Flex>
          </form>
        }
        kolonlar={kolonlar}
        veri={sorgu.data?.items}
        yukleniyor={sorgu.isPending}
        hata={sorgu.isError ? getErrorMessage(sorgu.error, "Rezervasyonlar yüklenemedi.") : null}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
        toplam={sorgu.data?.total ?? 0}
        sayfa={durum.page}
        sayfaBoyutu={durum.pageSize}
        sayfaBoyutuSecenekleri={[...ADMIN_PAGE_SIZES]}
        sayfaDegisti={(sayfa, boyut) => {
          if (boyut !== durum.pageSize) ayarla({ limit: boyut });
          else ayarla({ page: sayfa });
        }}
        tabloDegisti={tabloDegisti}
        bosBaslik={filtreliMi ? "Bu filtreyle rezervasyon bulunamadı" : "Rezervasyon yok"}
        bosAciklama={
          filtreliMi
            ? "Aradığınız ölçütlere uyan rezervasyon yok. Filtreleri temizleyip tüm listeye bakabilirsiniz."
            : "Öğrenciler eğitmenlerden ders talep ettikçe rezervasyonlar burada listelenir."
        }
        bosAksiyon={filtreliMi ? <Button onClick={filtreleriTemizle}>Filtreleri temizle</Button> : undefined}
        rowKey={(booking) => booking.id}
        birimEtiket="Rezervasyon"
      />

      <ReasonDialog
        open={karar?.kind === "refund" || karar?.kind === "release"}
        title={karar?.kind === "refund" ? "Öğrenciye iade et" : "Eğitmene öde"}
        description={
          karar?.kind === "refund"
            ? "Ders iptal edilir ve emanetteki ücret öğrenciye iade edilir. Bu işlem geri alınamaz."
            : "İhtilaf kapanır, ders tamamlanmış sayılır ve ücret eğitmene aktarılır. Bu işlem geri alınamaz."
        }
        label="Karar notu"
        required
        minLength={3}
        maxLength={500}
        danger={karar?.kind === "refund"}
        confirmLabel={karar?.kind === "refund" ? "İade et" : "Eğitmene öde"}
        isPending={mesgul}
        onClose={kararYuzeyi.kapat}
        onConfirm={gerekceGonder}
      />
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
        isPending={mesgul}
        onClose={kararYuzeyi.kapat}
        onConfirm={gerekceGonder}
      />
      <ConfirmDialog
        open={karar?.kind === "clear"}
        title="İhtilafı kaldır"
        description="Rezervasyonun ihtilaf işareti kaldırılacak."
        confirmLabel="İhtilafı kaldır"
        isPending={ihtilaf.isPending}
        onClose={kararYuzeyi.kapat}
        onConfirm={() => {
          if (!karar) return;
          ihtilaf.mutate(
            { id: karar.booking.id, is_disputed: false },
            {
              onSuccess: () => {
                toast.success("İhtilaf işareti kaldırıldı.");
                kararYuzeyi.kapat();
              },
              onError: (error) =>
                toast.error(getErrorMessage(error, "İhtilaf kaldırılamadı.")),
            },
          );
        }}
      />
    </>
  );
}
