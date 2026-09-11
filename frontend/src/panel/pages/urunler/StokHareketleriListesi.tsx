// Stok hareketleri (salt okunur defter) — eski StockMovementsPanel'in veri/filtre/denetim
// davranışı, ListePage üzerinde. Bu ekran hiçbir kayıt oluşturmaz veya değiştirmez.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, Button, Flex, Select, Tag, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { ListePage } from "@/panel/components/ListePage";
import { YukleniyorDurumu } from "@/panel/components/Durum";
import { useLedgerAudit, useStockMovements } from "@/hooks/useStock";
import { formatDateTime } from "@/lib/datetime";
import { formatDelta, movementTypeLabel, reasonLabel, type StockMovementType } from "@/lib/stockMovements";
import type { StockMovementOut } from "@/api/stock";

// lib/stockMovements.ts'teki güncel türlerin tamamı (beyaz liste).
const TURLER: StockMovementType[] = [
  "OPENING_BALANCE", "INITIAL", "SALE", "SALE_CANCEL", "RETURN", "ADMIN_ADJUSTMENT",
  "COUNT_ADJUSTMENT", "DAMAGE_TRANSFER", "DAMAGE_RECOVERY", "DAMAGE_DISPOSAL", "SUPPLIER_RETURN",
];
const AKTORLER = [
  { value: "SYSTEM", label: "Sistem" },
  { value: "ADMIN", label: "Yönetici" },
];
const REF_ETIKET: Record<string, string> = { order: "Sipariş", order_item: "Sipariş kalemi", order_return: "İade", product: "Ürün", migration: "Migration" };

function kaynak(m: StockMovementOut): string {
  if (!m.ref_type) return "—";
  const ad = REF_ETIKET[m.ref_type] ?? m.ref_type;
  return `${ad}${m.ref_id != null ? ` #${m.ref_id}` : ""}${m.ref_line_id != null ? ` · satır ${m.ref_line_id}` : ""}`;
}
function kim(m: StockMovementOut): string {
  if (m.actor_type === "ADMIN") return m.actor_id != null ? `Yönetici #${m.actor_id}` : "Yönetici";
  return "Sistem";
}

export function StokHareketleriListesi() {
  const { token } = theme.useToken();
  const [params, setParams] = useSearchParams();
  // Filtreler URL'de; beyaz liste dışı tur/aktor yok sayılır.
  const hamTur = params.get("tur") ?? "";
  const tur = (TURLER as string[]).includes(hamTur) ? hamTur : "";
  const hamAktor = params.get("aktor") ?? "";
  const aktor = AKTORLER.some((a) => a.value === hamAktor) ? hamAktor : "";
  const urlSku = params.get("sku") ?? "";

  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(25);
  const [filtreAcik, setFiltreAcik] = useState(false);
  const [denetimAcik, setDenetimAcik] = useState(false);

  const yaz = (yama: Record<string, string>) => {
    const sonraki: Record<string, string> = { sku: urlSku, tur, aktor, ...yama };
    setParams(Object.fromEntries(Object.entries(sonraki).filter(([, v]) => v)));
    setSayfa(1);
  };
  const liste = useStockMovements({
    limit: boyut,
    offset: (sayfa - 1) * boyut,
    movement_type: tur || undefined,
    sku: urlSku || undefined,
    actor_type: aktor || undefined,
  });
  // Denetim yalnız düğmeye basılınca sorgulanır; salt okunur teşhis.
  const denetim = useLedgerAudit({ limit: 100, offset: 0 }, denetimAcik);

  const filtreSayisi = (tur ? 1 : 0) + (aktor ? 1 : 0);
  const daraltilmis = filtreSayisi > 0 || Boolean(urlSku);

  const kolonlar: TableProps<StockMovementOut>["columns"] = useMemo(
    () => [
      { title: "Tarih", key: "tarih", render: (_, m) => <span style={{ whiteSpace: "nowrap" }}>{formatDateTime(m.created_at)}</span> },
      {
        title: "Ürün",
        key: "urun",
        render: (_, m) => (
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontWeight: 500 }}>{m.product_title}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: "monospace", userSelect: "all" }}>{m.sku}</Typography.Text>
          </span>
        ),
      },
      { title: "Hareket", key: "hareket", render: (_, m) => movementTypeLabel(m.movement_type) },
      {
        title: "Değişim",
        key: "degisim",
        align: "right",
        render: (_, m) => (
          <span style={{ fontWeight: 500, color: m.qty_delta > 0 ? token.colorSuccess : m.qty_delta < 0 ? token.colorError : token.colorTextSecondary }}>
            {formatDelta(m.qty_delta)}
          </span>
        ),
      },
      { title: "Sonraki stok", key: "sonraki", align: "right", render: (_, m) => m.qty_after },
      {
        title: "Gerekçe",
        key: "gerekce",
        render: (_, m) => (
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span>{reasonLabel(m.reason_code)}</span>
            {m.note ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{m.note}</Typography.Text> : null}
          </span>
        ),
      },
      { title: "Kaynak", key: "kaynak", render: (_, m) => kaynak(m) },
      { title: "Kim", key: "kim", render: (_, m) => kim(m) },
    ],
    [token],
  );

  const denetimYuzeyi = denetimAcik ? (
    <section
      aria-label="Defter denetimi"
      style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4, padding: 16, background: token.colorBgContainer }}
    >
      {denetim.isError ? (
        <Alert
          type="error"
          showIcon
          message="Denetim çalıştırılamadı"
          description="Defter okunamadı; bağlantıyı kontrol edip yeniden deneyin."
          action={<Button size="small" onClick={() => void denetim.refetch()}>Tekrar dene</Button>}
        />
      ) : denetim.isPending ? (
        <YukleniyorDurumu etiket="Denetleniyor…" />
      ) : denetim.data ? (
        <Flex vertical gap={8}>
          <Flex align="center" gap={8} wrap>
            <Tag color={denetim.data.inconsistent ? "warning" : "default"} style={{ marginInlineEnd: 0 }}>
              {denetim.data.inconsistent ? `${denetim.data.inconsistent} üründe sapma` : "Bu sayfada sapma yok"}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {denetim.data.checked} ürün denetlendi
              {denetim.data.next_offset != null ? ": defterin tamamı için sonraki sayfalar da denetlenmeli" : ""}
            </Typography.Text>
          </Flex>
          {denetim.data.problems.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: token.colorWarningText }}>
              {denetim.data.problems.slice(0, 20).map((p, i) => (
                <li key={`${p.product_id}-${p.code}-${i}`}>
                  <span style={{ fontFamily: "monospace" }}>{p.sku ?? p.product_id}</span>: {p.message}
                  {p.expected != null && p.actual != null ? (
                    <>
                      {" "}(beklenen <b>{p.expected}</b>, görülen <b>{p.actual}</b>)
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Bu ekran yalnız teşhis gösterir; hiçbir kayıt düzeltilmez.</Typography.Text>
        </Flex>
      ) : null}
    </section>
  ) : null;

  return (
    <ListePage<StockMovementOut>
      baslik="Stok Hareketleri"
      aciklama="Stok defteri salt okunurdur; ödeme, iade, sayım ve hasar işlemleri burada izlenir."
      aksiyonlar={<Button onClick={() => setDenetimAcik((v) => !v)}>{denetimAcik ? "Denetimi gizle" : "Defteri denetle"}</Button>}
      aramaDegeri={urlSku}
      aramaDegisti={(deger) => yaz({ sku: deger })}
      filtreSayisi={filtreSayisi}
      filtreIcerigi={
        <Flex gap={8} wrap>
          <Select<string>
            aria-label="Hareket türü"
            virtual={false}
            allowClear
            placeholder="Hareket türü: Tümü"
            value={tur || undefined}
            options={TURLER.map((t) => ({ value: t, label: movementTypeLabel(t) }))}
            style={{ width: 260 }}
            onChange={(v) => yaz({ tur: v ?? "" })}
          />
          <Select<string>
            aria-label="Kim"
            allowClear
            placeholder="Kim: Tümü"
            value={aktor || undefined}
            options={AKTORLER}
            style={{ width: 200 }}
            onChange={(v) => yaz({ aktor: v ?? "" })}
          />
        </Flex>
      }
      filtreAcik={filtreAcik}
      filtreAcikDegisti={setFiltreAcik}
      ustIcerik={denetimYuzeyi}
      birimEtiket="Hareket"
      kolonlar={kolonlar}
      veri={liste.data?.rows}
      yukleniyor={liste.isPending}
      hata={liste.isError ? "Stok hareketleri yüklenemedi. Defter okunamadı; bağlantıyı kontrol edip yeniden deneyin." : null}
      hataAksiyon={<Button size="small" onClick={() => void liste.refetch()}>Tekrar dene</Button>}
      toplam={liste.data?.total}
      sayfa={sayfa}
      sayfaBoyutu={boyut}
      sayfaDegisti={(s, b) => {
        setSayfa(s);
        setBoyut(b);
      }}
      bosBaslik={daraltilmis ? "Bu süzgeçlerle hareket bulunamadı" : "Henüz stok hareketi yok"}
      bosAciklama={daraltilmis ? "Süzgeçleri gevşetin ya da temizleyin." : "Ödeme, iptal, iade, sayım ve hasar işlemleri buraya düşer."}
      bosAksiyon={
        daraltilmis ? (
          <Button
            onClick={() => {
              setParams({});
              setSayfa(1);
            }}
          >
            Süzgeçleri temizle
          </Button>
        ) : undefined
      }
      rowKey={(m) => m.id}
    />
  );
}
