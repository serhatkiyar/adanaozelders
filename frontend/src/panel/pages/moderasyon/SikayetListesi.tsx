import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Flex, Input, Select, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useAdminReportList, useResolveReport } from "@/hooks/useReports";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_PAGE_SIZES,
  parseAdminReportQuery,
} from "@/lib/adminOperationsQuery";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { ListePage } from "@/panel/components/ListePage";
import { sunucuHatasiniDagit } from "@/panel/components/pencereAlanlari";
import { YanPencere } from "@/panel/components/YanPencere";
import { toast } from "@/store/toastStore";
import { ReportReason, ReportStatus, type ReportOut } from "@/types";

const VARSAYILAN = {
  status: ReportStatus.OPEN,
  target: "",
  page: 1,
  limit: ADMIN_DEFAULT_PAGE_SIZE,
};

const DURUM_ETIKETI: Record<ReportStatus, string> = {
  OPEN: "Açık",
  RESOLVED: "Çözüldü",
  DISMISSED: "Reddedildi",
};

const DURUM_RENGI: Record<ReportStatus, string> = {
  OPEN: "warning",
  RESOLVED: "success",
  DISMISSED: "default",
};

const NEDEN_ETIKETI: Record<ReportReason, string> = {
  SPAM: "Spam",
  HARASSMENT: "Taciz / hakaret",
  INAPPROPRIATE: "Uygunsuz içerik",
  CONTACT_INFO: "İletişim bilgisi",
  SCAM: "Dolandırıcılık",
  OTHER: "Diğer",
};

const HEDEFLER = ["TUTOR", "CLIENT", "REVIEW", "MESSAGE", "BOOKING_COMMENT"];
const YAYINDAN_KALDIRILABILIR = ["REVIEW", "PRODUCT_REVIEW", "LIBRARY_REVIEW"];

type Karar = {
  rapor: ReportOut;
  durum: ReportStatus.RESOLVED | ReportStatus.DISMISSED;
};

function yayindanKaldirilabilir(rapor: ReportOut) {
  return YAYINDAN_KALDIRILABILIR.includes(rapor.target_type);
}

function KararPenceresi({
  karar,
  kapat,
}: {
  karar: Karar | null;
  kapat: () => void;
}) {
  const { modal } = App.useApp();
  const resolve = useResolveReport();
  const gonderiliyorRef = useRef(false);
  const [not, setNot] = useState("");
  const [hedefiGizle, setHedefiGizle] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [alanHatasi, setAlanHatasi] = useState<string | null>(null);
  const rapor = karar?.rapor;
  const kaldirilabilir = Boolean(rapor && yayindanKaldirilabilir(rapor));
  const varsayilanGizle = Boolean(
    karar?.durum === ReportStatus.RESOLVED && kaldirilabilir,
  );

  useEffect(() => {
    if (!karar) {
      setNot("");
      setHedefiGizle(false);
      setHata(null);
      setAlanHatasi(null);
      return;
    }
    setNot("");
    setHedefiGizle(
      karar.durum === ReportStatus.RESOLVED && yayindanKaldirilabilir(karar.rapor),
    );
    setHata(null);
    setAlanHatasi(null);
  }, [karar]);

  const mesgul = () => resolve.isPending || gonderiliyorRef.current;
  const kirli = Boolean(not || hedefiGizle !== varsayilanGizle);
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!kirli) return kapat();
    modal.confirm({
      title: "Kaydedilmemiş değişiklikler var",
      content: "Pencereyi kapatırsanız yazdığınız karar bilgileri silinecek.",
      okText: "Değişiklikleri sil",
      okButtonProps: { danger: true },
      cancelText: "Düzenlemeye devam et",
      onOk: kapat,
    });
  };

  const gonder = () => {
    if (!karar || mesgul()) return;
    if (not.length > 2000) {
      setHata("Not en fazla 2000 karakter olabilir.");
      return;
    }
    const sabit = {
      id: karar.rapor.id,
      status: karar.durum,
      resolution: not.trim() || undefined,
      hideTarget: hedefiGizle && kaldirilabilir,
    };
    gonderiliyorRef.current = true;
    setHata(null);
    setAlanHatasi(null);
    resolve.mutate(sabit, {
      onSuccess: () => {
        toast.success("Şikayet kararı kaydedildi.");
        kapat();
      },
      onError: (error) => {
        const dagitim = sunucuHatasiniDagit(
          error,
          "Karar kaydedilemedi.",
          ["resolution"] as const,
        );
        setAlanHatasi(dagitim.alan.resolution ?? null);
        setHata(dagitim.genel);
      },
      onSettled: () => {
        gonderiliyorRef.current = false;
      },
    });
  };

  return (
    <YanPencere
      acik={Boolean(karar)}
      baslik={karar?.durum === ReportStatus.RESOLVED ? "Şikayeti çöz" : "Şikayeti reddet"}
      kapat={kapatIstegi}
      kaydet={gonder}
      kaydediyor={resolve.isPending}
      kaydetMetni="Kararı kaydet"
    >
      <Flex vertical gap={16}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {rapor ? `${rapor.target_type} #${rapor.target_id} için karar kaydedilecek.` : ""}
        </Typography.Paragraph>
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
        <label htmlFor="moderasyon-notu">
          <Typography.Text type="secondary">Moderasyon notu (isteğe bağlı)</Typography.Text>
          <Input.TextArea
            id="moderasyon-notu"
            aria-label="Moderasyon notu (isteğe bağlı)"
            rows={5}
            maxLength={2000}
            showCount
            value={not}
            placeholder="Kararın kısa gerekçesi"
            onChange={(event) => {
              setNot(event.target.value);
              setHata(null);
              setAlanHatasi(null);
            }}
            status={alanHatasi ? "error" : undefined}
            style={{ marginTop: 4 }}
          />
        </label>
        {alanHatasi ? <Typography.Text type="danger" role="alert">{alanHatasi}</Typography.Text> : null}
        {kaldirilabilir ? (
          <Checkbox checked={hedefiGizle} onChange={(event) => setHedefiGizle(event.target.checked)}>
            <Flex vertical gap={2}>
              <Typography.Text strong>Yorumu yayından kaldır</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Yorum silinmez; gizlenir ve puan ortalamasından düşürülür. Karar geri alınabilir.
              </Typography.Text>
            </Flex>
          </Checkbox>
        ) : null}
      </Flex>
    </YanPencere>
  );
}

/** Şikayet kuyruğunun mevcut karar akışını yeni panel kabuğuna taşır. */
export function SikayetListesi() {
  const { canView, canManage } = useAdminAreaAccess("reports");
  const { degerler, ayarla, filtreliMi } = useUrlDurumu(VARSAYILAN, {
    sayfaAnahtari: "page",
    filtreDisi: ["page", "limit"],
  });
  const durum = useMemo(
    () =>
      parseAdminReportQuery(
        new URLSearchParams(
          Object.entries(degerler)
            .filter(([, value]) => value !== "" && value !== undefined)
            .map(([key, value]) => [key, String(value)] as [string, string]),
        ),
      ),
    [degerler],
  );
  const kararYuzeyi = useDuzenlemeYuzeyi<Karar, void>();
  const sorgu = useAdminReportList(
    {
      status: durum.status,
      target_type: durum.targetType || undefined,
      limit: durum.pageSize,
      offset: (durum.page - 1) * durum.pageSize,
    },
    canView,
  );

  const kolonlar: TableProps<ReportOut>["columns"] = [
    {
      title: "Hedef",
      key: "target",
      render: (_, rapor) => (
        <Typography.Text strong>{rapor.target_type} #{rapor.target_id}</Typography.Text>
      ),
    },
    {
      title: "Neden",
      key: "reason",
      render: (_, rapor) => NEDEN_ETIKETI[rapor.reason] ?? rapor.reason,
    },
    {
      title: "Bildirilen içerik",
      key: "target_snapshot",
      render: (_, rapor) => (
        <Typography.Text
          type={rapor.target_snapshot ? undefined : "secondary"}
          style={{ maxWidth: 320, overflowWrap: "anywhere", whiteSpace: "pre-line" }}
        >
          {rapor.target_snapshot || "—"}
        </Typography.Text>
      ),
    },
    {
      title: "Açıklama",
      key: "description",
      render: (_, rapor) => (
        <Typography.Text type={rapor.description ? undefined : "secondary"} style={{ maxWidth: 320, overflowWrap: "anywhere" }}>
          {rapor.description || "Açıklama yok"}
        </Typography.Text>
      ),
    },
    {
      title: "Bildiren",
      key: "reporter",
      render: (_, rapor) => (
        <Typography.Text type="secondary">Rol {rapor.reporter_role} · #{rapor.reporter_id}</Typography.Text>
      ),
    },
    {
      title: "Durum",
      key: "status",
      render: (_, rapor) => (
        <Tag color={DURUM_RENGI[rapor.status]} style={{ marginInlineEnd: 0 }}>
          {DURUM_ETIKETI[rapor.status]}
        </Tag>
      ),
    },
    {
      title: "Tarih",
      key: "created_at",
      render: (_, rapor) => (
        <span style={{ whiteSpace: "nowrap", fontSize: 12 }}>{formatDateTime(rapor.created_at)}</span>
      ),
    },
    {
      title: "İşlem",
      key: "actions",
      render: (_, rapor) => {
        if (!canManage) return <Typography.Text type="secondary">Salt okunur</Typography.Text>;
        if (rapor.status !== ReportStatus.OPEN) {
          return <Typography.Text type="secondary">Karar verildi</Typography.Text>;
        }
        return (
          <Flex gap={8} wrap>
            <Button
              onClick={() => kararYuzeyi.ac({ rapor, durum: ReportStatus.RESOLVED })}
            >
              Çöz
            </Button>
            <Button
              danger
              onClick={() => kararYuzeyi.ac({ rapor, durum: ReportStatus.DISMISSED })}
            >
              Reddet
            </Button>
          </Flex>
        );
      },
    },
  ];

  if (!canView) return <AccessDenied area="Şikayetler" />;

  return (
    <>
      <ListePage<ReportOut>
        baslik="Şikayetler"
        aciklama={
          canManage
            ? "Bildirilen içerikleri inceleyin, çözün veya reddedin."
            : "Salt okunur görünüm: moderasyon kararı için reports.manage izni gerekir."
        }
        ustIcerik={
          <Flex gap={8} wrap>
            <Select
              aria-label="Şikayet durumu"
              value={durum.status}
              options={Object.values(ReportStatus).map((status) => ({
                value: status,
                label: DURUM_ETIKETI[status],
              }))}
              onChange={(value) => ayarla({ status: value })}
              style={{ width: 180 }}
            />
            <Select
              aria-label="Hedef türü"
              allowClear
              placeholder="Tüm hedefler"
              value={durum.targetType || undefined}
              options={HEDEFLER.map((target) => ({ value: target, label: target }))}
              onChange={(value) => ayarla({ target: value ?? "" })}
              style={{ width: 220 }}
            />
          </Flex>
        }
        kolonlar={kolonlar}
        veri={sorgu.data?.items}
        yukleniyor={sorgu.isPending}
        hata={sorgu.isError ? getErrorMessage(sorgu.error, "Şikayetler yüklenemedi.") : null}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
        toplam={sorgu.data?.total ?? 0}
        sayfa={durum.page}
        sayfaBoyutu={durum.pageSize}
        sayfaBoyutuSecenekleri={[...ADMIN_PAGE_SIZES]}
        sayfaDegisti={(sayfa, boyut) => {
          if (boyut !== durum.pageSize) ayarla({ limit: boyut });
          else ayarla({ page: sayfa });
        }}
        bosBaslik="Bu kuyrukta şikayet yok"
        bosAciklama="Durum veya hedef filtresini değiştirerek diğer kayıtları inceleyin."
        bosAksiyon={filtreliMi ? <Button onClick={() => ayarla({ status: ReportStatus.OPEN, target: "" })}>Filtreleri temizle</Button> : undefined}
        rowKey={(rapor) => rapor.id}
        birimEtiket="Şikayet"
      />
      <KararPenceresi karar={kararYuzeyi.kayit} kapat={kararYuzeyi.kapat} />
    </>
  );
}
