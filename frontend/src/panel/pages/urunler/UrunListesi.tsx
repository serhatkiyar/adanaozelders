import { useMemo, useState } from "react";
import { Button } from "antd";
import type { TableProps } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { ListePage } from "@/panel/components/ListePage";
import { useAdminProducts } from "@/hooks/useStore";
import { useDebounce } from "@/hooks/useDebounce";
import { formatTL } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import type { ProductSearchOut } from "@/types";

export function UrunListesi() {
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);
  const navigate = useNavigate();

  // Girdi anında güncellenir (aramaDegeri); API'ye giden değer gecikmelidir —
  // yoksa her tuş vuruşu bir /store/admin/products isteği demek olur.
  const gecikmisArama = useDebounce(arama);

  // `isLoading` DEĞİL: React Query v5'te `isLoading = isPending && isFetching`.
  // `isPending`, veri hiç gelmemişken (henüz çekilmedi/yeniden deneniyor/
  // iptal edildi) `fetchStatus`un anlık durumundan bağımsız true kalan
  // sinyaldir — "boş" (İlk Ürününüzü Yükleyin!) yalnız gerçekten veri
  // GELDİĞİNDE (success + 0 kayıt) veya hata OLUŞMADIĞINDA çıkmalı, ara bir
  // fetch/retry durumunda değil. Bkz. task-4-report.md "Düzeltme turu 2".
  const { data, isPending, isError, refetch } = useAdminProducts({
    q: gecikmisArama || undefined,
    limit: boyut,
    offset: (sayfa - 1) * boyut,
  });

  const satirlar = data?.items ?? [];
  // Toplam bilinmiyorsa (`X-Total-Count` yoksa) API -1 döner; sayfalama o
  // durumda toplamı göstermemeli — bkz. store.ts listProductsAdmin notu.
  const toplam = data && data.total >= 0 ? data.total : undefined;

  const kolonlar: TableProps<ProductSearchOut>["columns"] = useMemo(
    () => [
      { title: "Ürün", dataIndex: "title", key: "title" },
      {
        title: "Satış Fiyatı",
        dataIndex: "price",
        key: "price",
        render: (v: string | number) => formatTL(v),
      },
      {
        title: "Envanter",
        dataIndex: "stock",
        key: "stock",
        render: (v?: number | null) => (v == null ? "—" : `${v} adet`),
      },
    ],
    [],
  );

  return (
    <ListePage<ProductSearchOut>
      baslik="Ürünler"
      aksiyonlar={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(ROUTES.adminNewProductNew)}>
          Ürün Ekle
        </Button>
      }
      aramaDegeri={arama}
      aramaDegisti={(v) => {
        setArama(v);
        setSayfa(1);
      }}
      kolonlar={kolonlar}
      veri={satirlar}
      yukleniyor={isPending}
      hata={isError ? "Ürünler yüklenemedi." : null}
      hataAksiyon={<Button onClick={() => refetch()}>Tekrar dene</Button>}
      toplam={toplam}
      sayfa={sayfa}
      sayfaBoyutu={boyut}
      sayfaDegisti={(s, b) => {
        setSayfa(s);
        setBoyut(b);
      }}
      bosBaslik="İlk Ürününüzü Yükleyin!"
      bosAciklama="Ürünlerinizi yükleyin ve hemen satışa başlayın."
      bosAksiyon={
        <Button type="primary" onClick={() => navigate(ROUTES.adminNewProductNew)}>
          Ürün Ekle
        </Button>
      }
      rowKey={(k) => k.id}
    />
  );
}
