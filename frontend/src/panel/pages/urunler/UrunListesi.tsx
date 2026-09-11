import { useState } from "react";
import { Button } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { ListePage } from "@/panel/components/ListePage";
import { useAdminProducts } from "@/hooks/useStore";
import { ROUTES } from "@/lib/routes";
import type { ProductSearchOut } from "@/types";

export function UrunListesi() {
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);
  const navigate = useNavigate();

  const { data, isLoading, isError, refetch } = useAdminProducts({
    q: arama || undefined,
    limit: boyut,
    offset: (sayfa - 1) * boyut,
  });

  const satirlar = data?.items ?? [];
  // Toplam bilinmiyorsa (`X-Total-Count` yoksa) API -1 döner; sayfalama o
  // durumda toplamı göstermemeli — bkz. store.ts listProductsAdmin notu.
  const toplam = data && data.total >= 0 ? data.total : undefined;

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
      kolonlar={[
        { title: "Ürün", dataIndex: "title", key: "title" },
        {
          title: "Satış Fiyatı",
          dataIndex: "price",
          key: "price",
          render: (v: string | number) => `₺ ${Number(v).toFixed(2)}`,
        },
        {
          title: "Envanter",
          dataIndex: "stock",
          key: "stock",
          render: (v?: number | null) => (v == null ? "—" : `${v} adet`),
        },
      ]}
      veri={satirlar}
      yukleniyor={isLoading}
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
