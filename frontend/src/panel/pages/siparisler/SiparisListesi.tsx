import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import { ListePage } from "@/panel/components/ListePage";
import { useAdminOrders } from "@/hooks/useStore";
import { formatTL } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
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
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);

  const { data, isPending, isError, refetch } = useAdminOrders(
    undefined,
    boyut,
    (sayfa - 1) * boyut,
  );

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
        title: "Tutar",
        dataIndex: "total",
        key: "total",
        render: (v: string) => formatTL(v),
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

  return (
    <ListePage<OrderOut>
      baslik="Siparişler"
      aramaDegeri={arama}
      // Sayfa NUMARASI burada sıfırlanmaz: arama sunucuya gitmiyor (yalnız
      // o an elde tutulan sayfayı süzüyor), sıfırlamak yalnız gereksiz bir
      // server round-trip'e yol açardı — bkz. yukarıdaki modül yorumu.
      aramaDegisti={setArama}
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
      bosBaslik={arama ? "Sonuç bulunamadı" : "Henüz sipariş yok"}
      bosAciklama={
        arama
          ? "Farklı bir arama deneyin."
          : "İlk sipariş geldiğinde burada görünecek."
      }
      rowKey={(k) => k.id}
    />
  );
}
