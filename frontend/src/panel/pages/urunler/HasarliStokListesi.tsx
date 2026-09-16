// Hasarlı stok — eski DamageEventsPage'in verisi, izin kapısı ve dört işlemi, ListePage üzerinde.
// Geçmiş append-only'dir: satır aksiyonu yok, yanlış işlem ters yönde yeni kayıtla düzeltilir.
import { useMemo, useState } from "react";
import { Button, Flex, InputNumber, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import { AccessDenied } from "@/components/admin/AccessState";
import { ListePage } from "@/panel/components/ListePage";
import { HasarPenceresi } from "@/panel/pages/urunler/HasarliStokPencereleri";
import { useDamageEvents } from "@/hooks/useInventory";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { formatDateTime } from "@/lib/datetime";
import { DAMAGE_KINDS, bucketLabel, damageKindPastLabel, damageReasonLabel, inventoryErrorMessage, type DamageKind } from "@/lib/inventory";
import type { DamageEventOut } from "@/api/inventory";

export function HasarliStokListesi() {
  // Filtre + sayfalama URL'de (eski ekranla aynı); `sayfa`/`boyut` filtre sayılmaz.
  const { degerler, ayarla } = useUrlDurumu(
    { urun: "", sayfa: 1, boyut: 25 },
    { sayfaAnahtari: "sayfa", filtreDisi: ["sayfa", "boyut"] },
  );
  const sayfa = Math.max(1, Number(degerler.sayfa) || 1);
  const boyut = Math.max(1, Number(degerler.boyut) || 25);
  // Yalnız pozitif tam sayı sorguya gider.
  const urunNo = /^\d+$/.test(String(degerler.urun)) && Number(degerler.urun) > 0 ? Number(degerler.urun) : undefined;
  const [filtreAcik, setFiltreAcik] = useState(false);
  const [acikIslem, setAcikIslem] = useState<DamageKind | null>(null);
  const { canView, canApply } = useInventoryAccess();

  const sorgu = useDamageEvents({ product_id: urunNo, limit: boyut, offset: (sayfa - 1) * boyut }, canView);
  const satirlar = sorgu.data?.items ?? [];

  const urunSec = (v: number | null | undefined) => ayarla({ urun: v && v > 0 ? String(v) : "" }, { replace: true });

  const kolonlar: TableProps<DamageEventOut>["columns"] = useMemo(
    () => [
      { title: "İşlem", key: "kind", render: (_, o) => <span style={{ fontWeight: 500 }}>{damageKindPastLabel(o.kind)}</span> },
      { title: "Ürün", key: "product", render: (_, o) => `Ürün #${o.product_id}` },
      { title: "Miktar", key: "qty", align: "right", render: (_, o) => o.qty },
      {
        title: "Kaynak kova",
        key: "bucket",
        render: (_, o) => <Tag color={o.source_bucket === "DAMAGED" ? "warning" : "default"}>{bucketLabel(o.source_bucket)}</Tag>,
      },
      {
        title: "Neden",
        key: "reason",
        render: (_, o) => (
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span>{damageReasonLabel(o.reason_code)}</span>
            {o.note ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{o.note}</Typography.Text> : null}
          </span>
        ),
      },
      { title: "Yapan", key: "actor", render: (_, o) => <Typography.Text type="secondary">#{o.actor_admin_id}</Typography.Text> },
      { title: "Zaman", key: "created_at", render: (_, o) => <span style={{ whiteSpace: "nowrap" }}>{formatDateTime(o.created_at)}</span> },
    ],
    [],
  );

  const islemDugmeleri = canApply ? (
    <Flex gap={8} wrap>
      {DAMAGE_KINDS.map((k) => (
        <Button key={k.value} type={k.value === "TRANSFER" ? "primary" : "default"} onClick={() => setAcikIslem(k.value)}>
          {k.label}
        </Button>
      ))}
    </Flex>
  ) : null;

  if (!canView) return <AccessDenied area="Hasarlı Stok" />;

  return (
    <>
      <ListePage<DamageEventOut>
        baslik="Hasarlı Stok"
        detayliBilgiIpucu="Her işlem stok defterine yazılır ve geri alınamaz bir kayıt bırakır; yanlış işlem ters yönde yeni bir kayıtla düzeltilir."
        aciklama={canApply ? undefined : "İşlem başlatmak için rolünüzde inventory.apply izni bulunmalı."}
        aksiyonlar={islemDugmeleri}
        filtreSayisi={urunNo ? 1 : 0}
        filtreIcerigi={
          <InputNumber
            aria-label="Ürün numarası"
            placeholder="Ürün numarasına göre"
            min={1}
            precision={0}
            value={urunNo ?? null}
            style={{ width: 240 }}
            onChange={urunSec}
          />
        }
        filtreAcik={filtreAcik}
        filtreAcikDegisti={setFiltreAcik}
        birimEtiket="Kayıt"
        kolonlar={kolonlar}
        veri={satirlar}
        yukleniyor={sorgu.isPending}
        hata={sorgu.isError ? inventoryErrorMessage(sorgu.error, "Hasar olayları yüklenemedi.") : null}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
        toplam={sorgu.data?.total}
        sayfa={sayfa}
        sayfaBoyutu={boyut}
        sayfaDegisti={(s, b) => ayarla(b !== boyut ? { boyut: b, sayfa: 1 } : { sayfa: s })}
        bosBaslik={urunNo ? "Bu filtreyle kayıt bulunamadı" : "Hasar kaydı yok"}
        bosAciklama={
          urunNo
            ? `Ürün #${urunNo} için hasar kaydı bulunmuyor. Filtreyi temizleyip tüm geçmişe bakabilirsiniz.`
            : "Kırık, ıslak ya da baskı hatalı ürünleri hasarlı rafa ayırdığınızda burada listelenir."
        }
        bosAksiyon={
          urunNo ? (
            <Button onClick={() => urunSec(null)}>Filtreyi temizle</Button>
          ) : canApply ? (
            <Button type="primary" onClick={() => setAcikIslem("TRANSFER")}>İlk kaydı oluştur</Button>
          ) : undefined
        }
        rowKey={(o) => o.id}
      />
      <HasarPenceresi kind={acikIslem} kapat={() => setAcikIslem(null)} />
    </>
  );
}
