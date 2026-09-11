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
 *  - Sunucudaki gerçek toplam elde tutulan partiyi aşarsa (fetch `limit`'i
 *    doldurduysa) ekran artık bunu BİLDİRİR: `ListePage`in `uyari` şeridi —
 *    eski panelin `OrdersPanel`indeki "kesilme uyarısı" şeridinin emsali
 *    (bkz. `KESILME_TAVANI` altındaki yorum ve rapor).
 */
/**
 * Sunucudan tek seferde çekilen parti tavanı. `useAdminOrders`e AÇIKÇA
 * geçilir — `api/store.ts`teki `listOrdersAdmin`in kendi varsayılanı da
 * 100'dür (bkz. o dosyadaki yorum), ama burada sihirli bir sayıya
 * GÜVENİLMEZ: tavan bu ekranın kendi adlandırılmış sabitinden gelir, ki
 * aşağıdaki `partiTavaniDoldu` karşılaştırması iki dosyada birbirinden
 * bağımsız sürüklenen bir sayıya bağlı kalmasın.
 */
const KESILME_TAVANI = 100;

export function SiparisListesi() {
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);

  const { data, isPending, isError, refetch } = useAdminOrders(undefined, KESILME_TAVANI);

  const siparisler = data?.items ?? [];
  // GERÇEK sinyal `X-Total-Count`tan gelen `data.total`dır (bkz.
  // `api/store.ts` `listOrdersAdmin` — header sunucuda bu commit'lerden
  // ÖNCE de dönüyordu). Başlık okunabiliyorsa (`total >= 0`) kesilme
  // `total > siparisler.length` ile KESİN olarak bilinir — parti tam
  // `KESILME_TAVANI` kadarsa (== 100) ve `total` de 100 ise kesilme YOKTUR,
  // sınırda yanlış alarm vermez. `total === -1` ise (header hiç gelmedi)
  // eskisi gibi heuristiğe (parti tavanı doldu mu) düşülür — geriye dönük
  // emniyet. `filtrelenmis` DEĞİL `siparisler` (ham, aramadan ÖNCEki parti)
  // kullanılır — arama yalnız zaten çekilmiş partiyi süzer, sunucuya
  // gitmez, dolayısıyla kesilmeyi etkilemez. Eski panelin
  // `OrdersPanel`indeki "kesilme uyarısı" şeridinin emsali (bkz.
  // `components/admin/store/OrdersPanel.tsx` `kesilmisOlabilir`).
  const toplamBilgisi = data?.total ?? -1;
  const kesilmeSinyaliGuvenilir = toplamBilgisi >= 0;
  const partiTavaniDoldu = kesilmeSinyaliGuvenilir
    ? toplamBilgisi > siparisler.length
    : siparisler.length >= KESILME_TAVANI;

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
      uyari={
        partiTavaniDoldu
          ? kesilmeSinyaliGuvenilir
            ? `Toplam ${toplamBilgisi} siparişin ilk ${siparisler.length} tanesi gösteriliyor; listenin tamamı bu değil.`
            : `İlk ${siparisler.length} sipariş gösteriliyor; sunucuda muhtemelen daha fazlası var, listenin tamamı bu olmayabilir.`
          : undefined
      }
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
