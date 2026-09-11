import { useMemo, useState } from "react";
import { Button, Dropdown } from "antd";
import type { TableProps } from "antd";
import { PlusOutlined, MoreOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { ListePage } from "@/panel/components/ListePage";
import { TipSecimi } from "@/panel/components/TipSecimi";
import { useAdminProducts } from "@/hooks/useStore";
import { useDebounce } from "@/hooks/useDebounce";
import { formatTL } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import type { ProductSearchOut } from "@/types";

/** `AdminProductQuery.sort` ile birebir — bkz. `backend/api/routers/store.py` `list_products_admin`. */
type UrunSiralamaAlani = "title" | "price" | "stock" | "created_at";
const SIRALANABILIR_ALANLAR: readonly UrunSiralamaAlani[] = ["title", "price", "stock", "created_at"];

type UrunSiralama = { alan: UrunSiralamaAlani; yon: "asc" | "desc" } | undefined;

export function UrunListesi() {
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);
  const [tipAcik, setTipAcik] = useState(false);
  const [siralama, setSiralama] = useState<UrunSiralama>(undefined);
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
    // Sıralama seçili değilken `sort`/`order` anahtarları hiç GÖNDERİLMEZ
    // (`undefined` değerle değil) — backend zaten `created_at desc`
    // varsayılanına düşüyor, ayrıca üçüncü tıklamada "sıralamayı kaldır"ın
    // temiz bir karşılığı bu (bkz. `siralamaDegisti` aşağıda).
    ...(siralama ? { sort: siralama.alan, order: siralama.yon } : {}),
    limit: boyut,
    offset: (sayfa - 1) * boyut,
  });

  const satirlar = data?.items ?? [];
  // Toplam bilinmiyorsa (`X-Total-Count` yoksa) API -1 döner; sayfalama o
  // durumda toplamı göstermemeli — bkz. store.ts listProductsAdmin notu.
  const toplam = data && data.total >= 0 ? data.total : undefined;

  // AntD `Table`, `ListePage` içinde sarmalı; satır tıklaması için `onRow`
  // orada açılmıyor (15 modülü etkileyen prop sözleşmesi değişikliği olurdu).
  // Bunun yerine her veri hücresine `onCell` ile aynı tıklamayı veriyoruz.
  // Satır menüsü düğmesi kendi tıklamasında olayı durdurur, böylece satır
  // gezinmesi tetiklenmez. Yardımcılar `useMemo` İÇİNDE tanımlı — dışarıda
  // olsalardı her render'da yeni referans üretip bağımlılık kuralını
  // susturmayı gerektiriyordu.
  const kolonlar: TableProps<ProductSearchOut>["columns"] = useMemo(
    () => {
    const duzenlemeyeGit = (kayit: ProductSearchOut) =>
      navigate(ROUTES.adminNewProductEdit(kayit.id));
    const satirTiklama = (kayit: ProductSearchOut) => ({
      onClick: () => duzenlemeyeGit(kayit),
      style: { cursor: "pointer" },
    });
    return [
      { title: "Ürün", dataIndex: "title", key: "title", onCell: satirTiklama },
      {
        title: "Satış Fiyatı",
        dataIndex: "price",
        key: "price",
        // Sıralanabilirlik kararı burada verilir — `ListePage` yalnız
        // AntD'nin ürettiği olayı taşır, hangi kolonun sıralanabilir
        // olduğuna karışmaz.
        sorter: true,
        render: (v: string | number) => formatTL(v),
        onCell: satirTiklama,
      },
      {
        title: "Envanter",
        dataIndex: "stock",
        key: "stock",
        render: (v?: number | null) => (v == null ? "—" : `${v} adet`),
        onCell: satirTiklama,
      },
      {
        title: "",
        key: "aksiyonlar",
        width: 48,
        render: (_, kayit) => (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [{ key: "duzenle", label: "Düzenle" }],
              onClick: ({ domEvent }) => {
                domEvent.stopPropagation();
                duzenlemeyeGit(kayit);
              },
            }}
          >
            <Button
              type="text"
              icon={<MoreOutlined />}
              aria-label="satır aksiyonları"
              onClick={(e) => e.stopPropagation()}
            />
          </Dropdown>
        ),
      },
    ];
    },
    [navigate],
  );

  // AntD `Table.onChange`'in HAM sorter'ını (`ascend`/`descend`) API'nin
  // gerçek `order` sözleşmesine (`asc`/`desc`) çevirir. Yalnız bilinen bir
  // alan + geçerli bir yön geldiğinde `siralama` kurulur; üçüncü tıklamada
  // AntD `order`ı `undefined` yollar — o zaman sıralama tamamen kaldırılır
  // (varsayılan `created_at desc`'e döner). Arama değişince sayfanın 1'e
  // dönmesiyle AYNI emsal: sıralama da sonuç kümesinin SIRASINI değiştirir,
  // kullanıcı sayfa 5'teyken yeni sırada o sayfa tutarsız/boş kalabilir.
  const tabloDegisti: TableProps<ProductSearchOut>["onChange"] = (_sayfalama, _filtreler, sorter) => {
    const tek = Array.isArray(sorter) ? sorter[0] : sorter;
    const alan = tek?.columnKey ?? tek?.field;
    const yon = tek?.order === "ascend" ? "asc" : tek?.order === "descend" ? "desc" : undefined;
    setSiralama(
      yon && typeof alan === "string" && (SIRALANABILIR_ALANLAR as readonly string[]).includes(alan)
        ? { alan: alan as UrunSiralamaAlani, yon }
        : undefined,
    );
    setSayfa(1);
  };

  return (
    <>
      <ListePage<ProductSearchOut>
        baslik="Ürünler"
        aksiyonlar={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setTipAcik(true)}>
            Ürün Ekle
          </Button>
        }
        aramaDegeri={arama}
        aramaDegisti={(v) => {
          setArama(v);
          setSayfa(1);
        }}
        kolonlar={kolonlar}
        tabloDegisti={tabloDegisti}
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
          <Button type="primary" onClick={() => setTipAcik(true)}>
            Ürün Ekle
          </Button>
        }
        rowKey={(k) => k.id}
      />
      <TipSecimi
        acik={tipAcik}
        baslik="Ürün Ekle"
        secenekler={[
          { anahtar: "basit", baslik: "Basit Ürün", aciklama: "Tek parça olarak bir ürün ekleyin" },
          { anahtar: "varyantli", baslik: "Varyantlı Ürün", aciklama: "Renk, boyut gibi seçeneklerle ekleyin" },
        ]}
        kapat={() => setTipAcik(false)}
        secildi={(anahtar) => {
          setTipAcik(false);
          navigate(`${ROUTES.adminNewProductNew}?tip=${anahtar}`);
        }}
      />
    </>
  );
}
