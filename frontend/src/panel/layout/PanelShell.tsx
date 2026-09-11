import { useState } from "react";
import { Layout, Menu, Drawer, Button, Grid } from "antd";
import type { MenuProps } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { PanelProvider } from "@/panel/PanelProvider";
import { PANEL_MENU, seciliMenuDurumu, type PanelMenuItem } from "@/panel/layout/menu";
import { PANEL_SIDER_BG } from "@/panel/theme";

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
  const { md } = Grid.useBreakpoint();
  const mobil = md === false;
  const { selectedKey, openKeys } = seciliMenuDurumu(PANEL_MENU, konum.pathname);

  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={selectedKey ? [selectedKey] : []}
      defaultOpenKeys={openKeys}
      items={menuyuAntdyeCevir(PANEL_MENU)}
      onClick={({ key }) => {
        const yol = yolBul(PANEL_MENU, key);
        if (yol) {
          navigate(yol);
          setMobilAcik(false);
        }
      }}
    />
  );

  return (
    <PanelProvider>
      <Layout style={{ minHeight: "100vh" }}>
        {!mobil && (
          <Sider width={224} role="navigation">
            {menu}
          </Sider>
        )}
        <Layout>
          <Header style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {mobil && (
              <Button aria-label="Menü" icon={<MenuOutlined />} onClick={() => setMobilAcik(true)} />
            )}
            <span style={{ fontWeight: 600 }}>Adana Özel Ders</span>
          </Header>
          <Content style={{ padding: mobil ? 16 : 24 }}>
            <Outlet />
          </Content>
        </Layout>
        <Drawer
          open={mobilAcik}
          onClose={() => setMobilAcik(false)}
          placement="left"
          width={240}
          styles={{ body: { padding: 0, background: PANEL_SIDER_BG } }}
        >
          <nav role="navigation">{menu}</nav>
        </Drawer>
      </Layout>
    </PanelProvider>
  );
}
