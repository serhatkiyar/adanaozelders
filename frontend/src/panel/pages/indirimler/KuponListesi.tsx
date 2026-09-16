// Kuponlar listesi — eski CouponsPanel'in verisi ve davranışı, ListePage üzerinde.
// Sunucuda arama/sayfalama ucu yok: liste tek seferde gelir, sayfalama istemcide dilimlenir.
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Dropdown, Tag } from "antd";
import type { MenuProps, TableProps } from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ListePage } from "@/panel/components/ListePage";
import { KuponCekmecesi } from "@/panel/pages/indirimler/KuponCekmecesi";
import { useCoupons, useDeleteCoupon, useUpdateCoupon } from "@/hooks/useStore";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import type { Coupon } from "@/types";
import { onayAc } from "@/panel/components/onayPenceresi";

const VARSAYILAN_BOYUT = 20;

function indirimMetni(k: Coupon): string {
  return k.discount_type === "PERCENT" ? `%${Number(k.discount_value)}` : formatTL(k.discount_value);
}

export function KuponListesi() {
  const { message, modal } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("coupons");
  const sorgu = useCoupons(canView);
  const guncelle = useUpdateCoupon();
  const sil = useDeleteCoupon();
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(VARSAYILAN_BOYUT);
  const [cekmeceAcik, setCekmeceAcik] = useState(false);
  // Senkron kilitler: aynı satırda ikinci PATCH, aynı onayda ikinci DELETE çıkmaz.
  const bekleyenDurumRef = useRef(new Set<number>());
  const silRef = useRef(false);

  const hepsi = useMemo(() => sorgu.data ?? [], [sorgu.data]);
  // Veri azalınca (silme/refetch) sayfa state'i gerçekten son geçerli sayfaya çekilir;
  // veri sonradan artsa da eski yüksek sayfaya sıçranmaz.
  const sonSayfa = Math.max(1, Math.ceil(hepsi.length / boyut));
  useEffect(() => {
    if (sayfa > sonSayfa) setSayfa(sonSayfa);
  }, [sayfa, sonSayfa]);
  const etkinSayfa = Math.min(sayfa, sonSayfa);
  const satirlar = useMemo(() => hepsi.slice((etkinSayfa - 1) * boyut, etkinSayfa * boyut), [hepsi, etkinSayfa, boyut]);

  const etkinlikDegistir = (k: Coupon) => {
    if (bekleyenDurumRef.current.has(k.id)) return;
    bekleyenDurumRef.current.add(k.id);
    guncelle.mutate(
      { id: k.id, payload: { is_active: !k.is_active } },
      {
        onSuccess: () => message.success(k.is_active ? "Kupon devre dışı bırakıldı." : "Kupon etkinleştirildi."),
        onError: (e) => message.error(getErrorDetail(e, "Kupon durumu değiştirilemedi.")),
        onSettled: () => {
          bekleyenDurumRef.current.delete(k.id);
        },
      },
    );
  };

  // Kapanış `onayAc`ın denetiminde: hatada pencere açık kalır ve yeniden denenebilir.
  const silOnayla = (k: Coupon) =>
    onayAc(modal, {
      title: "Kuponu sil",
      content: `${k.code} kuponu silinecek.`,
      okText: "Kuponu sil",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      mesgulMu: () => silRef.current,
      calistir: () => (async () => {
        silRef.current = true;
        try {
          await sil.mutateAsync(k.id);
          message.success("Kupon silindi.");
        } catch (e) {
          message.error(getErrorDetail(e, "Kupon silinemedi."));
          throw e;
        } finally {
          silRef.current = false;
        }
      })(),
    });

  const kolonlar: TableProps<Coupon>["columns"] = [
    { title: "Kod", key: "code", render: (_: unknown, k: Coupon) => <span style={{ fontWeight: 500 }}>{k.code}</span> },
    { title: "İndirim", key: "discount", render: (_: unknown, k: Coupon) => indirimMetni(k) },
    { title: "Minimum sepet", key: "min", render: (_: unknown, k: Coupon) => formatTL(k.min_subtotal) },
    { title: "Kullanım", key: "uses", render: (_: unknown, k: Coupon) => `${k.used_count}${k.max_uses ? ` / ${k.max_uses}` : ""}` },
    { title: "Kişi başı", key: "per_user", render: (_: unknown, k: Coupon) => (k.per_user_limit == null ? "—" : k.per_user_limit) },
    { title: "Durum", key: "status", render: (_: unknown, k: Coupon) => (k.is_active ? <Tag color="success">Aktif</Tag> : <Tag>Pasif</Tag>) },
    ...(canManage
      ? [
          {
            title: "",
            key: "aksiyonlar",
            width: 56,
            render: (_: unknown, k: Coupon) => {
              // Eski panelin gerçek yetenekleri: aktif/pasif ve sil. Düzenleme yüzeyi yok.
              const ogeler: MenuProps["items"] = [
                { key: "durum", label: k.is_active ? "Devre dışı bırak" : "Etkinleştir" },
                { type: "divider" },
                { key: "sil", label: "Sil", danger: true },
              ];
              const sec: MenuProps["onClick"] = ({ key }) => {
                if (key === "durum") etkinlikDegistir(k);
                else if (key === "sil") silOnayla(k);
              };
              return (
                <Dropdown trigger={["click"]} menu={{ items: ogeler, onClick: sec }}>
                  <Button type="text" icon={<MoreOutlined />} aria-label={`${k.code} aksiyonları`} />
                </Dropdown>
              );
            },
          },
        ]
      : []),
  ];

  if (!canView) return <AccessDenied area="Kuponlar" />;

  return (
    <>
      <ListePage<Coupon>
        baslik="Kuponlar"
        // Başlıktaki düğme yalnız dolu listede; boş durumda tek düğme boş durumun kendisinde.
        aksiyonlar={
          canManage && hepsi.length > 0 ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCekmeceAcik(true)}>
              Kupon Ekle
            </Button>
          ) : null
        }
        aciklama={canManage ? undefined : "Bu alanda yalnız görüntüleme yetkiniz var; kupon ekleme, durum değiştirme ve silme kapalı."}
        birimEtiket="Kupon"
        kolonlar={kolonlar}
        veri={satirlar}
        yukleniyor={sorgu.isPending}
        hata={sorgu.isError ? getErrorDetail(sorgu.error, "Kuponlar yüklenemedi.") : null}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
        toplam={hepsi.length}
        sayfa={etkinSayfa}
        sayfaBoyutu={boyut}
        sayfaDegisti={(s, b) => {
          setSayfa(b !== boyut ? 1 : s);
          setBoyut(b);
        }}
        bosBaslik="Henüz kupon yok"
        bosAciklama="Kupon, sepette koda karşılık yüzde ya da sabit tutarlı indirim uygular."
        bosAksiyon={
          canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCekmeceAcik(true)}>
              Kupon Ekle
            </Button>
          ) : undefined
        }
        rowKey={(k) => k.id}
      />
      <KuponCekmecesi acik={cekmeceAcik} kapat={() => setCekmeceAcik(false)} />
    </>
  );
}
