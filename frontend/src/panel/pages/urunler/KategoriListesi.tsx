// Kategoriler listesi — eski CategoriesPanel'in verisi ve davranışı (hiyerarşi,
// ürün sayısı, KDV, aktiflik, ekle/düzenle/sil) ListePage (ikas liste anatomisi) üzerinde.
import { useCallback, useMemo, useState } from "react";
import { App, Button, Dropdown, Tag, Typography } from "antd";
import type { MenuProps, TableProps } from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ListePage } from "@/panel/components/ListePage";
import { KategoriCekmecesi } from "@/panel/pages/urunler/KategoriCekmecesi";
import { deleteCategory, updateCategory } from "@/api/store";
import { useCategories, useInvalidateAdminStore } from "@/hooks/useStore";
import { getErrorDetail } from "@/lib/errors";
import { orandanYuzde } from "@/lib/tax";
import type { ProductCategory } from "@/types";
import { onayAc } from "@/panel/components/onayPenceresi";

function derinlik(kategori: ProductCategory, hepsi: Map<number, ProductCategory>): number {
  let d = 0;
  let su = kategori;
  const gorulen = new Set<number>();
  while (su.parent_id && !gorulen.has(su.id) && d < 4) {
    gorulen.add(su.id);
    const ust = hepsi.get(su.parent_id);
    if (!ust) break;
    d += 1;
    su = ust;
  }
  return d;
}

/** "miras" etiketi: kendi değeri boş olup atasından devralan kategoriyi ayırt eder. */
function kdvEtiketi(k: ProductCategory): string {
  const kendi = orandanYuzde(k.default_tax_rate);
  const efektif = orandanYuzde(k.effective_tax_rate);
  return kendi ? `%${kendi}` : efektif ? `%${efektif} (miras)` : "—";
}

export function KategoriListesi() {
  const { canView, canManage } = useAdminAreaAccess("products");
  const sorgu = useCategories();
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);
  const [cekmeceAcik, setCekmeceAcik] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<ProductCategory | null>(null);

  const hepsi = useMemo(() => sorgu.data ?? [], [sorgu.data]);
  const haritasi = useMemo(() => new Map(hepsi.map((k) => [k.id, k])), [hepsi]);
  // Veri azalıp sayfa sayısı düşerse etkin sayfa geçerli son sayfaya çekilir.
  const sonSayfa = Math.max(1, Math.ceil(hepsi.length / boyut));
  const etkinSayfa = Math.min(sayfa, sonSayfa);
  const sayfadakiler = hepsi.slice((etkinSayfa - 1) * boyut, etkinSayfa * boyut);

  const ac = useCallback((k: ProductCategory | null) => {
    setDuzenlenen(k);
    setCekmeceAcik(true);
  }, []);

  const kolonlar: TableProps<ProductCategory>["columns"] = useMemo(() => {
    const satirTiklama = (k: ProductCategory) =>
      canManage ? { onClick: () => ac(k), style: { cursor: "pointer" } } : {};
    return [
      {
        title: "Kategori",
        key: "name",
        render: (_: unknown, k: ProductCategory) => (
          <Typography.Text
            type={k.is_active ? undefined : "secondary"}
            style={{ paddingLeft: derinlik(k, haritasi) * 18, fontWeight: 500 }}
          >
            {k.parent_id ? "↳ " : ""}
            {k.name}
          </Typography.Text>
        ),
        onCell: satirTiklama,
      },
      { title: "Ürün", key: "product_count", render: (_: unknown, k: ProductCategory) => k.product_count ?? 0, onCell: satirTiklama },
      { title: "Varsayılan KDV", key: "tax", render: (_: unknown, k: ProductCategory) => kdvEtiketi(k), onCell: satirTiklama },
      {
        title: "Durum",
        key: "is_active",
        render: (_: unknown, k: ProductCategory) => <Tag color={k.is_active ? "success" : "default"}>{k.is_active ? "Aktif" : "Pasif"}</Tag>,
        onCell: satirTiklama,
      },
      ...(canManage
        ? [
            {
              title: "",
              key: "aksiyonlar",
              width: 56,
              render: (_: unknown, k: ProductCategory) => <KategoriSatirAksiyonlari kategori={k} duzenle={() => ac(k)} />,
            },
          ]
        : []),
    ];
  }, [ac, canManage, haritasi]);

  const ekleDugmesi = (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => ac(null)}>
      Kategori Ekle
    </Button>
  );

  if (!canView) return <AccessDenied area="Kategoriler" />;

  return (
    <>
      <ListePage<ProductCategory>
        baslik="Kategoriler"
        aksiyonlar={canManage ? ekleDugmesi : null}
        aciklama={canManage ? undefined : "Bu alanda yalnız görüntüleme yetkiniz var; değişiklik yapamazsınız."}
        birimEtiket="Kategori"
        kolonlar={kolonlar}
        veri={sayfadakiler}
        yukleniyor={sorgu.isPending}
        hata={sorgu.isError ? getErrorDetail(sorgu.error, "Kategoriler yüklenemedi.") : null}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
        toplam={hepsi.length}
        sayfa={etkinSayfa}
        sayfaBoyutu={boyut}
        sayfaDegisti={(s, b) => {
          setSayfa(s);
          setBoyut(b);
        }}
        bosBaslik="Henüz kategori yok"
        bosAciklama="Ürünleri gruplamak için bir kategori ekleyin."
        bosAksiyon={canManage ? ekleDugmesi : undefined}
        rowKey={(k) => k.id}
      />
      <KategoriCekmecesi acik={cekmeceAcik} kategori={duzenlenen} kapat={() => setCekmeceAcik(false)} />
    </>
  );
}

// Satır menüsü: Düzenle · Pasife al/Etkinleştir · Sil (onaylı). Silme onayı
// `modal.confirm` ile (imperatif): dosyada pencere durumu doğmaz.
function KategoriSatirAksiyonlari({ kategori, duzenle }: { kategori: ProductCategory; duzenle: () => void }) {
  const { message, modal } = App.useApp();
  const yenile = useInvalidateAdminStore();

  const durum = useMutation({
    mutationFn: () => updateCategory(kategori.id, { is_active: !kategori.is_active }),
    onSuccess: () => {
      message.success(kategori.is_active ? "Kategori pasife alındı." : "Kategori açıldı.");
      yenile();
    },
    onError: (e: unknown) => message.error(getErrorDetail(e, "Kategori durumu değiştirilemedi.")),
  });
  const sil = useMutation({
    mutationFn: () => deleteCategory(kategori.id),
    onSuccess: () => {
      message.success("Kategori silindi.");
      yenile();
    },
    onError: (e: unknown) => message.error(getErrorDetail(e, "Kategori silinemedi.")),
  });

  const ogeler: MenuProps["items"] = [
    { key: "duzenle", label: "Düzenle" },
    { key: "durum", label: kategori.is_active ? "Pasife al" : "Etkinleştir" },
    { type: "divider" },
    { key: "sil", label: "Sil", danger: true },
  ];

  const sec: MenuProps["onClick"] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === "duzenle") duzenle();
    else if (key === "durum") durum.mutate();
    else if (key === "sil") {
      onayAc(modal, {
        title: "Kategoriyi sil",
        content: `"${kategori.name}" kategorisi silinecek.`,
        okText: "Kategoriyi sil",
        okButtonProps: { danger: true },
        cancelText: "Vazgeç",
        // Kapanış `onayAc`ta: mutasyon reddi AntD'ye çıkmaz, pencere açık kalır.
        mesgulMu: () => sil.isPending,
        calistir: () => sil.mutateAsync(),
      });
    }
  };

  return (
    <Dropdown trigger={["click"]} menu={{ items: ogeler, onClick: sec }}>
      <Button
        type="text"
        icon={<MoreOutlined />}
        loading={durum.isPending || sil.isPending}
        aria-label="satır aksiyonları"
        onClick={(e) => e.stopPropagation()}
      />
    </Dropdown>
  );
}
