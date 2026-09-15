// İade talepleri (RMA) — eski ReturnsPanel'in verisi ve kararları ListePage üzerinde.
import { useMemo, useState } from "react";
import { App, Button, Select, Typography } from "antd";
import type { TableProps } from "antd";
import { useSearchParams } from "react-router-dom";
import { ListePage } from "@/panel/components/ListePage";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { IadeDetayPenceresi, IadeDurumEtiketi, IADE_DURUMLARI, IADE_TURLERI, RedGerekcesiPenceresi } from "@/panel/pages/siparisler/IadePenceresi";
import { useAdminReturns, useResolveReturn } from "@/hooks/useStore";
import { formatDateTime } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import type { OrderReturn, ReturnStatus } from "@/types";

const HEPSI = "hepsi";
type Suzgec = ReturnStatus | typeof HEPSI;
const SUZGECLER: { value: Suzgec; label: string }[] = [
  { value: "PENDING", label: "Bekleyenler" },
  { value: "APPROVED", label: "Onaylananlar" },
  { value: "REJECTED", label: "Reddedilenler" },
  { value: HEPSI, label: "Tümü" },
];
// Eski ekranın varsayılanı "Yalnız bekleyenler": parametre yokken PENDING.
const VARSAYILAN: Suzgec = "PENDING";

export function IadeListesi() {
  const { canView, canManage } = useAdminAreaAccess("returns");
  const { message, modal } = App.useApp();
  const [params, setParams] = useSearchParams();
  const hamDurum = params.get("durum") ?? "";
  const durum: Suzgec = SUZGECLER.some((s) => s.value === hamDurum) ? (hamDurum as Suzgec) : VARSAYILAN;
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);
  const [filtreAcik, setFiltreAcik] = useState(false);
  const [seciliId, setSeciliId] = useState<number | null>(null);
  const [redId, setRedId] = useState<number | null>(null);

  // İzin yokken istek hiç çıkmaz; `AccessDenied` aşağıda çizilir.
  const sorgu = useAdminReturns(durum === HEPSI ? undefined : durum, canView);
  const resolve = useResolveReturn();
  const hepsi = useMemo(() => sorgu.data ?? [], [sorgu.data]);
  // Veri/süzgeç değişip sayfa sayısı düşerse etkin sayfa geçerli son sayfaya çekilir.
  const sonSayfa = Math.max(1, Math.ceil(hepsi.length / boyut));
  const etkinSayfa = Math.min(sayfa, sonSayfa);
  const sayfadakiler = useMemo(() => hepsi.slice((etkinSayfa - 1) * boyut, etkinSayfa * boyut), [hepsi, etkinSayfa, boyut]);
  const secili = seciliId === null ? null : (hepsi.find((r) => r.id === seciliId) ?? null);

  const durumSec = (v: Suzgec | undefined) => {
    setParams(v && v !== VARSAYILAN ? { durum: v } : {});
    setSayfa(1);
    setFiltreAcik(false);
  };

  // onOk gerçek Promise döndürür: sürerken onay penceresi kilitli kalır, hatada açık kalır.
  const onayla = async (iade: OrderReturn) => {
    // `await` kipi: onOk reddi sessiz kalır (unhandled rejection yok), pencere açık kalır.
    await modal.confirm({
      title: "İade talebini onayla",
      content: "Müşteriye ödeme iadesi yapılacak ve ürün stoğu geri yüklenecek.",
      okText: "Onayla ve iade et",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      onOk: async () => {
        if (resolve.isPending) return;
        try {
          await resolve.mutateAsync({ id: iade.id, action: "approve" });
          message.success("İade onaylandı, ödeme iade edildi");
          setSeciliId(null);
        } catch (err) {
          message.error(getErrorDetail(err, "İade onaylanamadı"));
          throw err;
        }
      },
    });
  };

  // Hatada red penceresi ve ayrıntı açık kalır, yazılan not korunur.
  const reddet = async (not: string | null) => {
    if (redId === null || resolve.isPending) return;
    try {
      await resolve.mutateAsync({ id: redId, action: "reject", adminNote: not });
      message.success("İade talebi reddedildi");
      setRedId(null);
      setSeciliId(null);
    } catch (err) {
      message.error(getErrorDetail(err, "İşlem başarısız"));
    }
  };

  const kolonlar: TableProps<OrderReturn>["columns"] = useMemo(() => {
    const satirTiklama = (r: OrderReturn) => ({ onClick: () => setSeciliId(r.id), style: { cursor: "pointer" } });
    return [
      {
        title: "Sipariş",
        key: "order",
        render: (_: unknown, r: OrderReturn) => (
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontWeight: 500 }}>Sipariş #{r.order_id}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.order ? formatTL(r.order.total) : "—"}
              {r.order?.ship_recipient ? ` · ${r.order.ship_recipient}` : ""}
            </Typography.Text>
          </span>
        ),
        onCell: satirTiklama,
      },
      { title: "Tür", key: "type", render: (_: unknown, r: OrderReturn) => IADE_TURLERI[r.type] ?? r.type, onCell: satirTiklama },
      {
        title: "Gerekçe",
        key: "reason",
        render: (_: unknown, r: OrderReturn) => (
          <Typography.Text ellipsis={{ tooltip: r.reason }} style={{ maxWidth: 320 }}>
            {r.reason}
          </Typography.Text>
        ),
        onCell: satirTiklama,
      },
      {
        title: "Tarih",
        key: "created_at",
        render: (_: unknown, r: OrderReturn) => <span style={{ whiteSpace: "nowrap" }}>{formatDateTime(r.created_at)}</span>,
        onCell: satirTiklama,
      },
      { title: "Durum", key: "status", render: (_: unknown, r: OrderReturn) => <IadeDurumEtiketi durum={r.status} />, onCell: satirTiklama },
    ];
  }, []);

  if (!canView) return <AccessDenied area="İadeler" />;

  const bosBaslik =
    durum === HEPSI ? "İade talebi yok" : durum === "PENDING" ? "Bekleyen iade talebi yok" : `${IADE_DURUMLARI[durum].label} iade talebi yok`;

  return (
    <>
      <ListePage<OrderReturn>
        baslik="İadeler"
        detayliBilgiIpucu="Ayrıntı ve karar için satıra tıklayın."
        filtreSayisi={durum === VARSAYILAN ? 0 : 1}
        filtreIcerigi={
          <Select<Suzgec> aria-label="Durum" value={durum} options={SUZGECLER} style={{ width: 240 }} onChange={durumSec} />
        }
        filtreAcik={filtreAcik}
        filtreAcikDegisti={setFiltreAcik}
        birimEtiket="Talep"
        kolonlar={kolonlar}
        veri={sayfadakiler}
        yukleniyor={sorgu.isPending}
        hata={sorgu.isError ? getErrorDetail(sorgu.error, "İade talepleri yüklenemedi.") : null}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
        aciklama={canManage ? undefined : "Salt okunur görünüm: rolünüz bu bölümde değişiklik yapma izni içermiyor."}
        toplam={hepsi.length}
        sayfa={etkinSayfa}
        sayfaBoyutu={boyut}
        sayfaDegisti={(s, b) => {
          setSayfa(s);
          setBoyut(b);
        }}
        bosBaslik={bosBaslik}
        bosAciklama={durum === HEPSI ? "Müşteri iade talebi açtığında burada görünecek." : "Farklı bir durum seçin ya da tümünü listeleyin."}
        bosAksiyon={durum === HEPSI ? undefined : <Button onClick={() => durumSec(HEPSI)}>Tümünü göster</Button>}
        rowKey={(r) => r.id}
      />
      <IadeDetayPenceresi
        acik={seciliId !== null}
        kapat={() => setSeciliId(null)}
        iade={secili}
        yonetebilir={canManage}
        kaydediyor={resolve.isPending}
        onayla={(r) => void onayla(r)}
        reddet={(r) => setRedId(r.id)}
      />
      <RedGerekcesiPenceresi acik={redId !== null} kapat={() => setRedId(null)} kaydediyor={resolve.isPending} onayla={(n) => void reddet(n)} />
    </>
  );
}
