import { useState, type ReactNode } from "react";
import { Layout, Menu, Drawer, Button } from "antd";
import type { MenuProps } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AccessDenied } from "@/components/admin/AccessState";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { adminAreaAccess } from "@/lib/adminAccess";
import { PanelProvider } from "@/panel/PanelProvider";
import {
  PANEL_MENU,
  menuyuIzneGoreSuz,
  rotaIzniBul,
  seciliMenuDurumu,
  type PanelMenuItem,
} from "@/panel/layout/menu";
import { YukleniyorDurumu } from "@/panel/components/Durum";
import { PANEL_SIDER_BG } from "@/panel/theme";
import { useAuthStore } from "@/store/authStore";

const { Sider, Header, Content } = Layout;

function menuyuAntdyeCevir(items: PanelMenuItem[]): MenuProps["items"] {
  return items.map((m) => ({
    key: m.key,
    label: m.label,
    disabled: !m.path && !m.children,
    children: m.children ? menuyuAntdyeCevir(m.children) : undefined,
  }));
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
  const izinliMi =
    !rotaBilgisi?.requiredPermission ||
    adminAreaAccess(permissions, rotaBilgisi.requiredPermission).canView;

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
        {!mobil && (
          <Sider
            width={224}
            role="navigation"
            style={{ position: "sticky", top: 0, height: "100vh", overflow: "auto" }}
          >
            {menu}
          </Sider>
        )}
        <Layout>
          <Header
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              position: "sticky",
              top: 0,
              zIndex: 1,
            }}
          >
            {mobil && (
              <Button
                aria-label="Menü"
                icon={<MenuOutlined />}
                size="large"
                onClick={() => setMobilAcik(true)}
              />
            )}
            <span style={{ fontWeight: 600 }}>Adana Özel Ders</span>
          </Header>
          <Content style={{ padding: mobil ? 16 : 24 }}>
            {icerik}
          </Content>
        </Layout>
        <Drawer
          open={mobilAcik}
          onClose={() => setMobilAcik(false)}
          placement="left"
          width={240}
          styles={{ body: { padding: 0, background: PANEL_SIDER_BG, overflow: "auto" } }}
        >
          <nav role="navigation">{menu}</nav>
        </Drawer>
      </Layout>
    </PanelProvider>
  );
}
