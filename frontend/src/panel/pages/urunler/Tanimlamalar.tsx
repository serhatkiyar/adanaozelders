// Tanımlamalar hub'ı — canlı ikas `/admin/product/definitions` kart ızgarası (3 sütun,
// 12px boşluk, kart 80px / radius 8 / padding 8 24 8 8). Yalnız gerçek ekranı olan kartlar bağlantıdır.
import type { ComponentType, CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Typography, theme } from "antd";
import {
  AppstoreOutlined,
  BgColorsOutlined,
  BlockOutlined,
  FormOutlined,
  GroupOutlined,
  LinkOutlined,
  ShopOutlined,
  TagsOutlined,
  TrademarkOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ROUTES } from "@/lib/routes";

type Kart = { baslik: string; aciklama: string; ikon: ComponentType; hedef?: string; izin?: "products" | "suppliers" };

// Başlık/açıklamalar ikas'tan birebir; `hedef` yalnız bizde gerçek ekranı olanlarda.
const KARTLAR: Kart[] = [
  { baslik: "Kategoriler", aciklama: "Ürünlerinizi kategorilere ayırarak ziyaretçilerinizin aradıkları ürünü daha hızlı bulmalarını sağlayın.", ikon: AppstoreOutlined, hedef: ROUTES.adminNewCategories, izin: "products" },
  { baslik: "Markalar", aciklama: "Marka detay sayfalarında aynı marka ürünleri gösterin ve marka bazlı raporlar oluşturun.", ikon: TrademarkOutlined },
  { baslik: "Özel Alanlar", aciklama: "Sezon Bilgisi, Cinsiyet gibi özel alanlar tanımlayarak ürün filtreleri oluşturun ve temanızda gösterin.", ikon: FormOutlined },
  { baslik: "Varyant Türleri", aciklama: "Ürünlerinize beden, renk, boyut gibi varyasyon türleri ekleyerek çeşitlilik sağlayın.", ikon: BlockOutlined },
  { baslik: "Ürün Grupları", aciklama: "Ürünlerinizi belirli kriterlere göre gruplayarak detay sayfasında nasıl görüneceklerini ayarlayın.", ikon: GroupOutlined },
  { baslik: "Tedarikçiler", aciklama: "Tedarikçilerinizin iletişim bilgilerini girerek satın alma sürecini ve ürün tedarik sürecinin yönetimini kolaylaştırın.", ikon: ShopOutlined, hedef: ROUTES.adminNewSuppliers, izin: "suppliers" },
  { baslik: "Ürün Kişiselleştirmeleri", aciklama: "Ürünlerinize yazı, resim yükleme ve renk seçimleri gibi kişiselleştirmeler ekleyin.", ikon: BgColorsOutlined },
  { baslik: "Etiketler", aciklama: "Ürünlerinize etiketler ekleyerek dışa aktarma işlemleri için filtrelemeyi kolaylaştırın.", ikon: TagsOutlined },
  { baslik: "Ürün Birimleri", aciklama: "Servis, adet gibi özel birimler tanımlayarak ürün birim fiyatlarını detay ve satın alma adımlarında gösterin.", ikon: UnorderedListOutlined },
  { baslik: "Sepet Linki", aciklama: "Kullanıcıları doğrudan sepet sayfasına yönlendiren hemen satın al linki oluşturun.", ikon: LinkOutlined },
];

// Canlı ikas kart sözleşmesi: sabit 80px, açıklama en fazla iki satır.
export const KART_STILI = { height: 80, padding: "8px 24px 8px 8px", borderRadius: 8, gap: 12, aciklamaSatir: 2 } as const;

export function Tanimlamalar() {
  const { token } = theme.useToken();
  const urunIzni = useAdminAreaAccess("products");
  const tedarikciIzni = useAdminAreaAccess("suppliers");
  if (!urunIzni.canView && !tedarikciIzni.canView) return <AccessDenied area="Tanımlamalar" />;
  const izinVar = (izin?: Kart["izin"]) => (izin === "products" ? urunIzni.canView : izin === "suppliers" ? tedarikciIzni.canView : false);

  return (
    <div style={{ maxWidth: 1248 }}>
      <Typography.Title level={4} style={{ fontSize: 20, fontWeight: 500, margin: "0 0 24px" }}>Tanımlamalar</Typography.Title>
      <div role="list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: KART_STILI.gap }}>
        {KARTLAR.map((k) => {
          const Ikon = k.ikon;
          const tiklanir = Boolean(k.hedef && izinVar(k.izin));
          // Bağlantı olmayan kart (ekranı yok ya da izin yok) nötr/ikincil görünür.
          const baslikRengi = tiklanir ? token.colorText : token.colorTextTertiary;
          const govde = (
            <>
              <span aria-hidden style={{ width: 64, height: 64, borderRadius: 8, background: token.colorBgLayout, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: baslikRengi, flexShrink: 0 }}>
                <Ikon />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <Typography.Text style={{ fontSize: 16, fontWeight: 500, lineHeight: "20px", color: baslikRengi }}>{k.baslik}</Typography.Text>
                <Typography.Text
                  data-testid="tanim-aciklama"
                  style={{ fontSize: 14, lineHeight: "20px", color: token.colorTextTertiary, display: "-webkit-box", WebkitLineClamp: KART_STILI.aciklamaSatir, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                >
                  {k.aciklama}
                </Typography.Text>
              </span>
            </>
          );
          const { aciklamaSatir: _satir, ...olculer } = KART_STILI;
          const stil: CSSProperties = {
            ...olculer,
            display: "flex",
            alignItems: "center",
            boxSizing: "border-box",
            overflow: "hidden",
            background: tiklanir ? token.colorBgContainer : token.colorBgLayout,
            border: `1px solid ${token.colorBorderSecondary}`,
          };
          return (
            <div role="listitem" key={k.baslik}>
              {tiklanir ? (
                <Link to={k.hedef!} aria-label={k.baslik} data-testid="tanim-karti" style={stil}>{govde}</Link>
              ) : (
                <div aria-label={k.baslik} data-testid="tanim-karti" style={stil}>{govde}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
