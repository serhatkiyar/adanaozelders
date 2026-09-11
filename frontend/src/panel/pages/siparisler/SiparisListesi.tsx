import { useMemo, useState } from "react";
import { Button, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import { ListePage } from "@/panel/components/ListePage";
import { useAdminOrders } from "@/hooks/useStore";
import { formatTL } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
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
 * ## `useAdminOrders`in gerçek sözleşmesi — Ürünler'den FARKLI
 *
 * `useAdminOrders(statusFilter?, limit?)` `q`/`offset` desteklemez (bkz.
 * `api/store.ts` `listOrdersAdmin` — yalnız `status` + `limit`, sunucuda
 * OFFSET YOK). Bu yüzden:
 *
 *  - **Arama** sunucuya gitmez: zaten alınmış `items` dizisi istemcide
 *    `order_no`/müşteri adına göre süzülür. Sunucu tarafı bir `q` eklenene
 *    kadar bu ekranın arama kutusu YALNIZCA elde tutulan (limit kadar) satırı
 *    süzer — az sayıda sipariş için doğru, ama sunucudaki TÜM siparişleri
 *    aramaz. Bu bilinçli ve raporlanmış bir sınırdır.
 *  - **Sayfalama** de sunucuya gitmez: `ListePage`in sayfa/sayfaBoyutu/
 *    sayfaDegisti'si yalnız zaten çekilmiş `items` dizisini İSTEMCİDE
 *    dilimler (AntD `Table`'ın kendi dahili sayfalaması) — sahte bir "sonraki
 *    sayfa sunucudan yeni veri getirir" izlenimi YARATILMAZ, `toplam` her
 *    zaman gerçekten elde tutulan (ve aramadan geçen) satır sayısını yansıtır.
 *    Sunucudaki gerçek toplam bu sayıyı aşarsa (fetch `limit`'i doldurduysa)
 *    ekran bunu bildirmez — eski panelin `OrdersPanel`indeki "kesilme
 *    uyarısı" şeridine karşılık gelen bir slot `ListePage`de yok (bkz. rapor).
 */
export function SiparisListesi() {
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);

  const { data, isPending, isError, refetch } = useAdminOrders();

  const siparisler = data?.items ?? [];

  const filtrelenmis = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    if (!q) return siparisler;
    return siparisler.filter(
      (s) =>
        s.order_no.toLocaleLowerCase("tr-TR").includes(q) ||
        (s.ship_recipient ?? "").toLocaleLowerCase("tr-TR").includes(q),
    );
  }, [siparisler, arama]);

  const kolonlar: TableProps<OrderOut>["columns"] = useMemo(
    () => [
      { title: "Sipariş No", dataIndex: "order_no", key: "order_no" },
      {
        title: "Müşteri",
        dataIndex: "ship_recipient",
        key: "ship_recipient",
        render: (v?: string | null) =>
          v ?? <Typography.Text type="secondary">Dijital sipariş</Typography.Text>,
      },
      {
        title: "Tutar",
        dataIndex: "total",
        key: "total",
        render: (v: string) => formatTL(v),
      },
      {
        title: "Durum",
        dataIndex: "status",
        key: "status",
        render: (v: string) => <Tag color={TON_RENK[orderStatusTone(v)]}>{orderStatusLabel(v)}</Tag>,
      },
      {
        title: "Tarih",
        dataIndex: "created_at",
        key: "created_at",
        render: (v: string) => formatDateTime(v),
      },
    ],
    [],
  );

  return (
    <ListePage<OrderOut>
      baslik="Siparişler"
      aramaDegeri={arama}
      aramaDegisti={(v) => {
        setArama(v);
        setSayfa(1);
      }}
      kolonlar={kolonlar}
      veri={filtrelenmis}
      yukleniyor={isPending}
      hata={isError ? "Siparişler yüklenemedi." : null}
      hataAksiyon={<Button onClick={() => refetch()}>Tekrar dene</Button>}
      toplam={filtrelenmis.length}
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
