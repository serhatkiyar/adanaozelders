import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Select, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import { ListePage } from "@/panel/components/ListePage";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { useAdminOrders } from "@/hooks/useStore";
import { formatTL } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { orderPaymentLabel } from "@/lib/orderPayment";
import { ORDER_STATUS_FILTERS, orderPaymentTone, orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
import { ROUTES } from "@/lib/routes";
import type { OrderOut } from "@/types";

/**
 * `orderStatusTone` (bkz. `lib/orderStatus.ts`) semantik ton döner
 * (neutral/info/success/warning/danger); burada AntD `Tag`in kendi ÖN
 * TANIMLI renk adlarına eşlenir — ham hex DEĞİL (panel kısıtı: renk sabiti
 * yalnız `panel/theme.ts`'te).
 */
const TON_RENK: Record<ReturnType<typeof orderStatusTone>, string> = {
  neutral: "default",
  info: "blue",
  success: "success",
  warning: "warning",
  danger: "error",
};

const HEPSI = "hepsi";
/**
 * Durum süzgeci eski `OrdersPanel` ile birebir: değer URL'de yaşar (filtreli liste
 * bağlantısı paylaşılabilir, yenilemede seçim korunur) ve BEYAZ LİSTEDEN geçer —
 * bilinmeyen bir değer sunucuya gidip 422 üretmez ya da sessizce boş liste döndürmez.
 */
export function durumCoz(ham: string | null): string {
  return ham && ORDER_STATUS_FILTERS.includes(ham) ? ham : HEPSI;
}

/**
 * Siparişler modülünün ilk ekranı — yalnız liste (bkz. spec §4/§5).
 *
 * ## Sunucu sayfalaması GERÇEK (bu paketle eklendi)
 *
 * Backend `list_orders_admin` (bkz. `backend/api/routers/store.py`) baştan
 * beri `offset` destekliyordu; eksik olan tek şey istemci sarmalayıcısının
 * onu hiç göndermemesiydi (bkz. `api/store.ts` `listOrdersAdmin`in `offset`
 * yorumu). `sayfa`/`boyut` artık gerçekten `useAdminOrders`e `offset =
 * (sayfa-1)*boyut` olarak gider ve `toplam` sunucunun GERÇEK
 * `X-Total-Count`unu yansıtır — eskiden bu ekranda elde tutulan tek bir
 * "parti" AntD `Table`ın kendi dahili sayfalamasıyla dilimleniyordu ve 100
 * siparişin üstünde sessizce kesiliyordu (bkz. eski `KESILME_TAVANI`); o
 * mekanizma tamamen kaldırıldı — sayfalama artık gerçek olduğu için
 * kesilme kaynaklı bir kesilme YOK.
 *
 * ## `useAdminOrders`in gerçek sözleşmesi — Ürünler'den hâlâ FARKLI: `q` YOK
 *
 * `listOrdersAdmin`/`list_orders_admin` bir arama parametresi (`q`)
 * sunmuyor — ürünler ucundan (`/store/admin/products`) farklı olarak
 * siparişler ucunda arama backend'de YOK (bunu eklemek bu paketin kapsamı
 * dışı). Bu yüzden **arama** hâlâ sunucuya gitmez: yalnızca o an sunucudan
 * çekilmiş TEK SAYFAdaki `items` dizisi istemcide `order_no`/müşteri adına
 * göre süzülür. Bu, sayfalamadan FARKLI bir sınırdır ve gerçek sayfalama
 * onu ORTADAN KALDIRMAZ — arama kutusuna bir şey yazıldığında ekran bunu
 * `ListePage`in `uyari` şeridiyle AÇIKÇA bildirir ("bu arama yalnızca bu
 * sayfada"); sahte bir "tüm siparişlerde arıyor" izlenimi YARATILMAZ.
 * Arama metni değiştiğinde sayfa NUMARASI sıfırlanmaz — arama zaten
 * sunucuya gitmediği için sıfırlamak yalnız gereksiz bir yeniden çekime
 * yol açardı.
 */
export function SiparisListesi() {
  const navigate = useNavigate();
  // Eski `OrdersPanel` gibi: uç `orders.view` ister. İzin yokken ekran kapanır VE
  // istek hiç çıkmaz (yetkisiz oturumda 403 üreten sorgu atılmaz).
  const { canView } = useAdminAreaAccess("orders");
  const [params, setParams] = useSearchParams();
  const durum = durumCoz(params.get("durum"));
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);
  const [filtreAcik, setFiltreAcik] = useState(false);

  // Durum SUNUCUYA gider (uç `status` alır): filtre tüm siparişleri kapsar, elde
  // tutulan sayfayı süzmez — aramadan farkı budur.
  const { data, isPending, isError, refetch } = useAdminOrders(
    durum === HEPSI ? undefined : durum,
    boyut,
    (sayfa - 1) * boyut,
    canView,
  );

  const durumSec = (v: string) => {
    // Varsayılan ("hepsi") URL'ye yazılmaz; ilgisiz parametreler korunur.
    const sonraki = new URLSearchParams(params);
    if (v === HEPSI) sonraki.delete("durum");
    else sonraki.set("durum", v);
    setParams(sonraki, { replace: true });
    // Filtre değişince sayfa 1'e döner: 3. sayfadayken filtre değiştirmek boş liste gösterirdi.
    setSayfa(1);
    setFiltreAcik(false);
  };

  const siparisler = data?.items ?? [];
  // Sunucu toplamı bilinmiyorsa (`X-Total-Count` hiç gelmediyse, `total ===
  // -1`) `ListePage`e toplam VERİLMEZ — bir sayı uydurup yanlış "N kayıt"
  // göstermektense hiç göstermemek daha dürüst (bkz. `UrunListesi`teki
  // aynı emsal).
  const toplam = data && data.total >= 0 ? data.total : undefined;

  const aramaAktif = arama.trim().length > 0;

  const filtrelenmis = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    if (!q) return siparisler;
    return siparisler.filter(
      (s) =>
        s.order_no.toLocaleLowerCase("tr-TR").includes(q) ||
        (s.ship_recipient ?? "").toLocaleLowerCase("tr-TR").includes(q),
    );
  }, [siparisler, arama]);

  // Satırın diğer hücreleri de aynı detaya SPA gezinmesi yapar.
  const satirTiklama = (k: OrderOut) => ({
    onClick: () => navigate(ROUTES.adminNewOrder(k.id)),
    style: { cursor: "pointer" },
  });
  const kolonlar: TableProps<OrderOut>["columns"] = useMemo(
    () => [
      {
        title: "Sipariş No",
        key: "order_no",
        // Gerçek bağlantı: Ctrl/orta tık yeni sekmede açar; satır olayı ikinci kez tetiklenmez.
        render: (_: unknown, k: OrderOut) => (
          <Link to={ROUTES.adminNewOrder(k.id)} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 500 }}>
            {k.order_no}
          </Link>
        ),
        onCell: satirTiklama,
      },
      {
        title: "Müşteri",
        dataIndex: "ship_recipient",
        key: "ship_recipient",
        render: (v?: string | null) =>
          v ?? <Typography.Text type="secondary">Dijital sipariş</Typography.Text>,
        onCell: satirTiklama,
      },
      {
        title: "Kalem",
        key: "kalem",
        render: (_: unknown, k: OrderOut) => {
          // Boş kalem listesi "sipariş boş" DEMEK DEĞİLDİR: eski/bozuk veride
          // `order_items` satırı hiç olmayabilir (bkz. `lib/orderItems`).
          const adet = k.items?.length ?? 0;
          return adet > 0 ? adet : <Typography.Text type="secondary">-</Typography.Text>;
        },
        onCell: satirTiklama,
      },
      {
        title: "Tutar",
        dataIndex: "total",
        key: "total",
        render: (v: string) => formatTL(v),
        onCell: satirTiklama,
      },
      {
        // Para ekseni durum ekseninden AYRIDIR: "Teslim edildi" bir siparişin
        // ödemesi iade sürecinde olabilir. Eski ekranda da ayrı kolondu.
        title: "Ödeme",
        dataIndex: "payment_status",
        key: "payment_status",
        render: (v: string) => <Tag color={TON_RENK[orderPaymentTone(v)]}>{orderPaymentLabel(v)}</Tag>,
        onCell: satirTiklama,
      },
      {
        title: "Durum",
        dataIndex: "status",
        key: "status",
        render: (v: string) => <Tag color={TON_RENK[orderStatusTone(v)]}>{orderStatusLabel(v)}</Tag>,
        onCell: satirTiklama,
      },
      {
        title: "Tarih",
        dataIndex: "created_at",
        key: "created_at",
        render: (v: string) => formatDateTime(v),
        onCell: satirTiklama,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate],
  );

  if (!canView) return <AccessDenied area="Siparişler" />;

  return (
    <ListePage<OrderOut>
      baslik="Siparişler"
      aramaDegeri={arama}
      // Sayfa NUMARASI burada sıfırlanmaz: arama sunucuya gitmiyor (yalnız
      // o an elde tutulan sayfayı süzüyor), sıfırlamak yalnız gereksiz bir
      // server round-trip'e yol açardı — bkz. yukarıdaki modül yorumu.
      aramaDegisti={setArama}
      filtreSayisi={durum === HEPSI ? 0 : 1}
      filtreIcerigi={
        <Select<string>
          aria-label="Durum"
          value={durum}
          onChange={durumSec}
          style={{ width: 240 }}
          options={[
            { value: HEPSI, label: "Tümü" },
            ...ORDER_STATUS_FILTERS.map((d) => ({ value: d, label: orderStatusLabel(d) })),
          ]}
        />
      }
      filtreAcik={filtreAcik}
      filtreAcikDegisti={setFiltreAcik}
      kolonlar={kolonlar}
      veri={filtrelenmis}
      yukleniyor={isPending}
      hata={isError ? "Siparişler yüklenemedi." : null}
      hataAksiyon={<Button onClick={() => refetch()}>Tekrar dene</Button>}
      uyari={
        aramaAktif
          ? `Bu arama yalnızca bu sayfadaki ${siparisler.length} siparişte yapılıyor; sunucuda \`q\` desteği olmadığından diğer sayfalardaki siparişleri kapsamaz.`
          : undefined
      }
      toplam={toplam}
      sayfa={sayfa}
      sayfaBoyutu={boyut}
      sayfaDegisti={(s, b) => {
        setSayfa(s);
        setBoyut(b);
      }}
      bosBaslik={arama || durum !== HEPSI ? "Sonuç bulunamadı" : "Henüz sipariş yok"}
      bosAciklama={
        arama
          ? "Farklı bir arama deneyin."
          : durum !== HEPSI
            ? "Bu durumda sipariş bulunmuyor; filtreyi değiştirmeyi deneyin."
            : "İlk sipariş geldiğinde burada görünecek."
      }
      bosAksiyon={
        durum !== HEPSI ? <Button onClick={() => durumSec(HEPSI)}>Filtreyi temizle</Button> : undefined
      }
      rowKey={(k) => k.id}
    />
  );
}
