import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Flex, Input, Select, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import type { AdminDemandSort } from "@/api/admin";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ReasonDialog } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useAdminDemands, useCancelAdminDemand } from "@/hooks/useAdmin";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_PAGE_SIZES,
  parseAdminDemandQuery,
} from "@/lib/adminOperationsQuery";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { ListePage } from "@/panel/components/ListePage";
import { toast } from "@/store/toastStore";
import { DemandStatus, type AdminDemandOut } from "@/types";

const VARSAYILAN = {
  q: "",
  status: "",
  sort: "created_at",
  order: "desc",
  page: 1,
  limit: ADMIN_DEFAULT_PAGE_SIZE,
};

const DURUM_ETIKETI: Record<DemandStatus, string> = {
  OPEN: "Açık",
  CLOSED: "Kapatıldı",
  CANCELLED: "İptal edildi",
};

const DURUM_RENGI: Record<DemandStatus, string> = {
  OPEN: "success",
  CLOSED: "default",
  CANCELLED: "error",
};

const SIRALANABILIR: Record<string, AdminDemandSort> = {
  title: "title",
  subject: "subject",
  response_count: "response_count",
  status: "status",
  created_at: "created_at",
};

function butceMetni(talep: AdminDemandOut): string {
  if (talep.budget_min != null && talep.budget_max != null) {
    return `${formatTRY(talep.budget_min)} – ${formatTRY(talep.budget_max)}`;
  }
  if (talep.budget_min != null) return `${formatTRY(talep.budget_min)} ve üzeri`;
  if (talep.budget_max != null) return `${formatTRY(talep.budget_max)}'ye kadar`;
  return "Belirtilmedi";
}

/** Ders taleplerinin mevcut yönetim işlevlerini yeni panel liste kabuğuna taşır. */
export function TalepListesi() {
  const { canView, canManage } = useAdminAreaAccess("demands");
  const { canView: kullaniciDetayiVar } = useAdminAreaAccess("users");
  const { degerler, ayarla, temizle, filtreliMi } = useUrlDurumu(VARSAYILAN, {
    sayfaAnahtari: "page",
    filtreDisi: ["page", "limit", "sort", "order"],
  });
  const durum = useMemo(
    () =>
      parseAdminDemandQuery(
        new URLSearchParams(
          Object.entries(degerler)
            .filter(([, value]) => value !== "" && value !== undefined)
            .map(([key, value]) => [key, String(value)] as [string, string]),
        ),
      ),
    [degerler],
  );
  const [arama, setArama] = useState(durum.q);
  const iptalYuzeyi = useDuzenlemeYuzeyi<AdminDemandOut, void>();
  const iptalEdilecek = iptalYuzeyi.kayit;
  const sorgu = useAdminDemands(
    {
      limit: durum.pageSize,
      offset: (durum.page - 1) * durum.pageSize,
      q: durum.q || undefined,
      status: durum.status,
      sort: durum.sort,
      order: durum.order,
    },
    canView,
  );
  const iptal = useCancelAdminDemand();

  useEffect(() => setArama(durum.q), [durum.q]);

  const filtreleriTemizle = () => {
    setArama("");
    temizle();
  };
  const aramaGonder = (event: FormEvent) => {
    event.preventDefault();
    ayarla({ q: arama.trim() });
  };
  const siralamaDegeri = (alan: AdminDemandSort) =>
    durum.sort === alan ? (durum.order === "asc" ? "ascend" : "descend") : null;

  const uye = (talep: AdminDemandOut): ReactNode => {
    const metin = talep.client_name || `Öğrenci #${talep.client_id}`;
    return kullaniciDetayiVar ? (
      <Link to={ROUTES.adminNewCustomer("client", talep.client_id)} style={{ fontWeight: 500 }}>
        {metin}
      </Link>
    ) : (
      <Typography.Text strong>{metin}</Typography.Text>
    );
  };

  const kolonlar: TableProps<AdminDemandOut>["columns"] = [
    {
      title: "Talep",
      key: "title",
      sorter: true,
      sortOrder: siralamaDegeri("title"),
      render: (_, talep) => (
        <div style={{ minWidth: 220, maxWidth: 360, overflowWrap: "anywhere" }}>
          <Typography.Text strong style={{ display: "block" }}>{talep.title}</Typography.Text>
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            {talep.description || "Açıklama yok"}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "Üye",
      key: "client",
      render: (_, talep) => uye(talep),
    },
    {
      title: "Branş",
      key: "subject",
      sorter: true,
      sortOrder: siralamaDegeri("subject"),
      render: (_, talep) => (
        <span>{talep.subject}{talep.level ? ` · ${talep.level}` : ""}</span>
      ),
    },
    {
      title: "Bütçe",
      key: "budget",
      render: (_, talep) => (
        <span style={{ whiteSpace: "nowrap", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {butceMetni(talep)}
        </span>
      ),
    },
    {
      title: "Yanıt",
      key: "response_count",
      sorter: true,
      sortOrder: siralamaDegeri("response_count"),
      render: (_, talep) => <Tag style={{ marginInlineEnd: 0 }}>{talep.response_count}</Tag>,
    },
    {
      title: "Durum",
      key: "status",
      sorter: true,
      sortOrder: siralamaDegeri("status"),
      render: (_, talep) => (
        <Tag color={DURUM_RENGI[talep.status]} style={{ marginInlineEnd: 0 }}>
          {DURUM_ETIKETI[talep.status]}
        </Tag>
      ),
    },
    {
      title: "Oluşturma",
      key: "created_at",
      sorter: true,
      sortOrder: siralamaDegeri("created_at"),
      render: (_, talep) => (
        <span style={{ whiteSpace: "nowrap", fontSize: 12 }}>{formatDateTime(talep.created_at)}</span>
      ),
    },
    {
      title: "İşlem",
      key: "actions",
      render: (_, talep) => {
        if (!canManage) return <Typography.Text type="secondary">Salt okunur</Typography.Text>;
        if (talep.status !== DemandStatus.OPEN) {
          return <Typography.Text type="secondary">İşlem yok</Typography.Text>;
        }
        return (
          <Button danger disabled={iptal.isPending} onClick={() => iptalYuzeyi.ac(talep)}>
            İptal et
          </Button>
        );
      },
    },
  ];

  const tabloDegisti: TableProps<AdminDemandOut>["onChange"] = (_, __, siralayici) => {
    const secili = Array.isArray(siralayici) ? siralayici[0] : siralayici;
    const alan = secili?.columnKey != null ? SIRALANABILIR[String(secili.columnKey)] : undefined;
    if (!alan || !secili?.order) return ayarla({ sort: "", order: "" });
    ayarla({
      sort: alan === "created_at" ? "" : alan,
      order: secili.order === "ascend" ? "asc" : "",
    });
  };

  if (!canView) return <AccessDenied area="Talepler" />;

  return (
    <>
      <ListePage<AdminDemandOut>
        baslik="Talepler"
        aciklama={
          canManage
            ? "Öğrencilerin açtığı ders taleplerini inceleyin ve gerektiğinde iptal edin."
            : "Salt okunur görünüm: talep işlemleri için demands.manage izni gerekir."
        }
        ustIcerik={
          <form onSubmit={aramaGonder}>
            <Flex gap={8} wrap>
              <Input
                aria-label="Ders talebi ara"
                value={arama}
                maxLength={100}
                placeholder="Başlık, branş, öğrenci veya e-posta ara"
                onChange={(event) => setArama(event.target.value)}
                style={{ width: 320, maxWidth: "100%" }}
              />
              <Select
                aria-label="Talep durumu"
                allowClear
                placeholder="Tüm durumlar"
                value={durum.status}
                options={Object.values(DemandStatus).map((status) => ({
                  value: status,
                  label: DURUM_ETIKETI[status],
                }))}
                onChange={(value) => ayarla({ status: value ?? "" })}
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
        hata={sorgu.isError ? getErrorMessage(sorgu.error, "Ders talepleri yüklenemedi.") : null}
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
        bosBaslik={filtreliMi ? "Bu filtreyle ders talebi bulunamadı" : "Ders talebi bulunamadı"}
        bosAciklama={
          filtreliMi
            ? "Arama veya durum filtresini değiştirerek tekrar deneyin."
            : "Öğrenciler yeni bir ders talebi açtığında kayıtlar burada listelenir."
        }
        bosAksiyon={filtreliMi ? <Button onClick={filtreleriTemizle}>Filtreleri temizle</Button> : undefined}
        rowKey={(talep) => talep.id}
        birimEtiket="Talep"
      />

      <ReasonDialog
        open={iptalYuzeyi.acik}
        title="Ders talebini iptal et"
        description={
          iptalEdilecek
            ? `“${iptalEdilecek.title}” talebi kapatılacak; işlem denetim kaydına yazılacak.`
            : ""
        }
        label="İptal gerekçesi"
        placeholder="İptal gerekçesini açıkça yazın"
        required
        minLength={3}
        maxLength={500}
        confirmLabel="Talebi iptal et"
        danger
        isPending={iptal.isPending}
        onClose={iptalYuzeyi.kapat}
        onConfirm={(reason) => {
          if (!iptalEdilecek) return;
          iptal.mutate(
            { id: iptalEdilecek.id, reason },
            {
              onSuccess: () => {
                toast.success("Ders talebi iptal edildi.");
                iptalYuzeyi.kapat();
              },
              onError: (error) =>
                toast.error(getErrorMessage(error, "Talep iptal edilemedi.")),
            },
          );
        }}
      />
    </>
  );
}
