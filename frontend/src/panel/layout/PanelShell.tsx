import { useState, type ComponentType, type ReactNode } from "react";
import { Avatar, Layout, Menu, Drawer, Button } from "antd";
import type { MenuProps } from "antd";
import {
  AppstoreAddOutlined,
  BarChartOutlined,
  BookOutlined,
  CarOutlined,
  ContainerOutlined,
  HomeOutlined,
  InboxOutlined,
  MenuOutlined,
  NotificationOutlined,
  PercentageOutlined,
  ReadOutlined,
  SafetyOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingOutlined,
  SolutionOutlined,
  TeamOutlined,
  UserOutlined,
  WalletOutlined,
  GiftOutlined,
} from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AccessDenied } from "@/components/admin/AccessState";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { rolEtiketi } from "@/lib/roles";
import { PanelProvider } from "@/panel/PanelProvider";
import {
  PANEL_MENU,
  izinBeyaniniKarsilarMi,
  menuyuIzneGoreSuz,
  rotaIzniBul,
  seciliMenuDurumu,
  type PanelMenuIconKey,
  type PanelMenuItem,
} from "@/panel/layout/menu";
import { YukleniyorDurumu } from "@/panel/components/Durum";
import { PANEL_SIDER_BG } from "@/panel/theme";
import { useAuthStore } from "@/store/authStore";
import type { UserOut } from "@/types";

const { Sider, Content } = Layout;

/**
 * `menu.ts`teki `PanelMenuIconKey` → gerçek `@ant-design/icons` bileşeni.
 * Çeviri BURADA yapılır: menü verisi (`menu.ts`) AntD'yi hiç bilmez, `.ts`
 * dosyasında JSX kurulamaz — bkz. `menu.ts` dosya başı notu.
 */
const PANEL_MENU_ICONS: Record<PanelMenuIconKey, ComponentType> = {
  home: HomeOutlined,
  shopping: ShoppingOutlined,
  container: ContainerOutlined,
  team: TeamOutlined,
  percentage: PercentageOutlined,
  inbox: InboxOutlined,
  notification: NotificationOutlined,
  barchart: BarChartOutlined,
  "appstore-add": AppstoreAddOutlined,
  setting: SettingOutlined,
  shop: ShopOutlined,
  car: CarOutlined,
  read: ReadOutlined,
  solution: SolutionOutlined,
  book: BookOutlined,
  safety: SafetyOutlined,
  wallet: WalletOutlined,
  gift: GiftOutlined,
};

/**
 * ikas referansı §7 "İKİNCİ TUR ÖLÇÜM": ikon yalnız kök öğelerde (`m.icon`
 * doluysa) render edilir, alt öğelerde `icon` hiç ayarlanmaz — AntD `Menu`
 * `icon` prop'unu boş bırakınca kendisi hiçbir şey çizmiyor (elle `<span>`
 * sarmalamaya gerek yok). AntD'nin ikon bileşenleri SVG'yi zaten
 * `aria-hidden="true"` ile çiziyor — erişilebilir ad menü etiketinin
 * metninden gelir, ikona ayrı `aria-label` eklenmez.
 */
function menuyuAntdyeCevir(items: PanelMenuItem[]): MenuProps["items"] {
  return items.map((m) => {
    const Icon = m.icon ? PANEL_MENU_ICONS[m.icon] : undefined;
    return {
      key: m.key,
      label: m.label,
      icon: Icon ? <Icon /> : undefined,
      disabled: !m.path && !m.children,
      children: m.children ? menuyuAntdyeCevir(m.children) : undefined,
    };
  });
}

function yolBul(items: PanelMenuItem[], key: string): string | undefined {
  for (const m of items) {
    if (m.key === key) return m.path;
    if (m.children) {
      const found = yolBul(m.children, key);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Sider altındaki sabit kullanıcı kartı (referans §1: "yuvarlak avatar + ad +
 * mağaza/rol satırı"). Bizde mağaza kavramı yok (admin panelinde hesap bir
 * mağazaya değil bir role bağlı) — ikinci satır GERÇEK oturumun rol etiketi
 * (`rolEtiketi`, `lib/roles.ts` tek kaynağı). "Hak Edişler" bloğu bilinçli
 * olarak YOK: admin panelinde karşılığı olan bir tutar yok, uydurma veri
 * eklenmez (referans §6).
 */
function PanelKullaniciKarti({ user }: { user: UserOut }) {
  return (
    <div
      data-testid="panel-kullanici-karti"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        borderTop: "1px solid rgba(255, 255, 255, 0.12)",
        flexShrink: 0,
      }}
    >
      <Avatar src={user.avatar_url ?? undefined} icon={<UserOutlined />} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: "#ffffff",
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {user.full_name}
        </div>
        <div style={{ color: "rgba(255, 255, 255, 0.65)", fontSize: 12 }}>
          {rolEtiketi(user.role_id)}
        </div>
      </div>
    </div>
  );
}

export function PanelShell() {
  const [mobilAcik, setMobilAcik] = useState(false);
  const navigate = useNavigate();
  const konum = useLocation();
  // AntD'nin `Grid.useBreakpoint()` yerine deponun kendi hook'u kullanılıyor:
  // useBreakpoint ilk senkron render'da `{}` döner (md === undefined), bu da
  // dar ekranda ilk render'ın yanlışlıkla masaüstü (Sider) dalını seçmesine
  // yol açar. `useMobil`, değeri `useState` başlatıcısında `matchMedia` ile
  // senkron okur — aynı 768px eşiğini korur (bkz. useMedyaSorgusu.ts).
  const mobil = useMobil();

  // İzin kapısı (kök CLAUDE.md: yetkilendirme role değil sahipliğe/izinlere
  // de bakar). `user` `/auth/me` çözülene kadar `null`dur — bu panel gerçek
  // akışta hep `ProtectedRoute`un ARDINDA render olur (`user` orada zaten
  // garanti), ama kabuk kendi başına da (test, doğrudan mount) render
  // edilebilir; o yüzden FAIL-CLOSED kendi başına da doğru olmalı: izin
  // bilgisi yoksa (`user` henüz gelmediyse) hem menü öğesi hem içerik kapalı
  // kalır — `lib/adminAccess.ts`teki `undefined` sözleşmesiyle aynı yön.
  const user = useAuthStore((s) => s.user);
  const permissions = user?.admin_permissions;
  const izinYukleniyor = !user;

  const gorunurMenu = menuyuIzneGoreSuz(PANEL_MENU, permissions);
  const { selectedKey, openKeys } = seciliMenuDurumu(gorunurMenu, konum.pathname);

  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={selectedKey ? [selectedKey] : []}
      defaultOpenKeys={openKeys}
      items={menuyuAntdyeCevir(gorunurMenu)}
      onClick={({ key }) => {
        const yol = yolBul(gorunurMenu, key);
        if (yol) {
          navigate(yol);
          setMobilAcik(false);
        }
      }}
    />
  );

  // İçerik alanı: rota tam olarak PANEL_MENU'deki (izinden bağımsız TAM)
  // ağaçtan bulunur — menüde gizlenmiş olması gerekli izni bilmemizi
  // engellemez, aksi hâlde yetkisiz bir kullanıcı deep-link ile gelince
  // gereken izin hiç bilinemez ve kapı sessizce açık kalırdı.
  const rotaBilgisi = rotaIzniBul(PANEL_MENU, konum.pathname);
  // Beyan yoksa açık; tek izin aynen; çoklu izinde herhangi biri yeter.
  const izinliMi = !rotaBilgisi || izinBeyaniniKarsilarMi(permissions, rotaBilgisi);

  let icerik: ReactNode;
  if (izinYukleniyor) {
    // Panelin TEK yükleniyor dili `YukleniyorDurumu`dur (bkz. `components/Durum.tsx`).
    // Burada elle kurulmuş bir `Spin` vardı; bu ekran ortak bileşen eklenirken
    // paralel yazıldığı için onu görmemişti. 15 modül bu kabuğu örnek alacak,
    // ikinci bir dil bırakılmaz. Metinsiz dönen çark ekran okuyucuya da bir şey
    // söylemiyordu; etiket bağlama özgü.
    icerik = (
      <div
        data-testid="panel-icerik-yukleniyor"
        style={{ display: "flex", justifyContent: "center", padding: 48 }}
      >
        <YukleniyorDurumu etiket="Yetkiler denetleniyor…" />
      </div>
    );
  } else if (!izinliMi) {
    icerik = <AccessDenied area={rotaBilgisi?.label ?? "Bu alan"} />;
  } else {
    icerik = <Outlet />;
  }

  return (
    <PanelProvider>
      <Layout style={{ minHeight: "100vh" }}>
        {/* ikas referansı §5/4: üst bar yok. §7 "Sider": genişlik ölçüldü
            224px (önceki 172px tahmini yanlıştı — daraltılmış hâlin 72px'i
            yanlış okunmuştu, bkz. referans §7 sonu). Menünün altına sabit
            kullanıcı kartı (gerçek oturum, uydurma yok). */}
        {!mobil && (
          <Sider
            width={224}
            role="navigation"
            style={{
              position: "sticky",
              top: 0,
              height: "100vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ flex: 1, overflow: "auto" }}>{menu}</div>
            {user && <PanelKullaniciKarti user={user} />}
          </Sider>
        )}
        <Layout>
          {/* Canlı ikas: içerik 0 24px yatay dolgu, başlık satırı y=16'dan
              başlar (ölçüm 11 Eyl 2026). */}
          <Content style={{ padding: mobil ? 16 : "16px 24px 0" }}>
            {/* ikas referansı §5/4: üst bar kaldırıldı, ama mobil çekmeceyi
                açan TEK giriş (menü düğmesi) kalmalı — içeriğin üstünde, sol
                üstte. */}
            {mobil && (
              <div style={{ marginBottom: 16 }}>
                <Button
                  aria-label="Menü"
                  icon={<MenuOutlined />}
                  size="large"
                  onClick={() => setMobilAcik(true)}
                />
              </div>
            )}
            {icerik}
          </Content>
        </Layout>
        <Drawer
          open={mobilAcik}
          onClose={() => setMobilAcik(false)}
          placement="left"
          width={240}
          styles={{
            body: {
              padding: 0,
              background: PANEL_SIDER_BG,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              height: "100%",
            },
          }}
        >
          <nav role="navigation" style={{ flex: 1, overflow: "auto" }}>
            {menu}
          </nav>
          {user && <PanelKullaniciKarti user={user} />}
        </Drawer>
      </Layout>
    </PanelProvider>
  );
}
