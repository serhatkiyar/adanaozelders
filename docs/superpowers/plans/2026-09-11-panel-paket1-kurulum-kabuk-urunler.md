# Panel Paket 1 — Kurulum, Kabuk ve Ürünler Pilotu

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ikas tarzı yeni ADMIN panelinin temelini (Ant Design kurulumu + panel kabuğu + ortak liste/form bileşenleri) kurup, Ürünler modülünü pilot olarak uçtan uca çalışır hale getirmek.

**Architecture:** Yeni panel `frontend/src/panel/` altında yaşar ve geçici olarak `/yonetim-yeni` kökünde servis edilir; mevcut `/yonetim` bozulmadan çalışmaya devam eder. Ant Design v5 yalnız bu ağaçta kullanılır (storefront Tailwind'de kalır). Ortak bileşenler (`ListePage`, `FormPage`, `YanPencere`, `TipSecimi`, `Matris`) bir kez yazılır; tüm modüller bunları tüketir. Backend API'leri, React Query hook'ları ve yetki sistemi **olduğu gibi** kullanılır.

**Tech Stack:** React 18.3, TypeScript 5.6, Vite 5.4, React Router 7.18, @tanstack/react-query 5.59, **antd 5 + @ant-design/icons + dayjs (yeni)**, Vitest 2.1 + @testing-library/react 16.3, Tailwind 3.4 (yalnız storefront).

**Spec:** `docs/superpowers/specs/2026-09-11-admin-panel-ikas-yeniden-tasarim-design.md`

## Global Constraints

- Bileşen kütüphanesi **Ant Design v5**, yalnız `frontend/src/panel/` ağacında. Storefront dosyalarına dokunulmaz.
- `ConfigProvider` daima `locale={trTR}` ile sarılır; tüm arayüz metinleri **Türkçe**.
- Aksan rengi **`#C2410C`**; tema yalnız `frontend/src/panel/theme.ts` içinde tanımlanır (başka yerde renk sabiti yazılmaz).
- Mobil zorunlu; AntD kırılımları **576 / 768 / 992 / 1200**. `<768px` sol menü `Drawer` olur.
- Rota tanımları **tek kaynak** `frontend/src/lib/routes.ts` (`PATHS` + `ROUTES`). Bileşenlerde çıplak yol dizgisi yazılmaz.
- Geliştirme kökü **`/yonetim-yeni`**. Mevcut `/yonetim` ve `components/admin/**` **değiştirilmez**.
- Backend API, `src/api/store.ts`, `src/hooks/useStore.ts` ve yetki sistemi (`lib/adminAccess.ts`) yeniden yazılmaz; tüketilir.
- Test komutu: `npm test` (= `vitest run`), dosya deseni `src/**/*.test.tsx`, ortam jsdom, alias `@` → `src`.
- Her task sonunda commit. Commit mesajları Türkçe, `feat(panel):` / `test(panel):` önekli. **Commit mesajlarına AI imzası eklenmez.**

---

## Dosya Yapısı

| Dosya | Sorumluluk |
|---|---|
| `frontend/src/panel/theme.ts` | AntD token teması (aksan, radius, spacing, koyu Sider) — tek renk kaynağı |
| `frontend/src/panel/PanelProvider.tsx` | `ConfigProvider` + `StyleProvider` + `locale` sarmalayıcı |
| `frontend/src/panel/layout/PanelShell.tsx` | Sider + Header + Content; `<768px` Drawer davranışı |
| `frontend/src/panel/layout/menu.ts` | Sol menü ağacı verisi (modül/alt modül, ikon, rota) |
| `frontend/src/panel/components/ListePage.tsx` | Liste iskeleti: başlık+aksiyonlar, arama, tablo, sayfalama, boş durum |
| `frontend/src/panel/components/FormPage.tsx` | Form iskeleti: üst bar + `Tabs` + `Card` bölümleri |
| `frontend/src/panel/components/YanPencere.tsx` | `Drawer` sarmalayıcı (sağdan, mobilde tam ekran, alt aksiyon çubuğu) |
| `frontend/src/panel/components/TipSecimi.tsx` | `Modal` + seçenek kartları (Basit/Varyantlı) |
| `frontend/src/panel/components/Matris.tsx` | Varyant kombinasyon tablosu (satır içi düzenlenebilir) |
| `frontend/src/panel/pages/urunler/UrunListesi.tsx` | Ürün listesi ekranı (`useAdminProducts`) |
| `frontend/src/panel/pages/urunler/UrunFormu.tsx` | Ürün ekle/düzenle (sekmeli, `createProduct`/`updateProduct`) |
| `frontend/src/panel/pages/urunler/VaryantPenceresi.tsx` | Varyant ekseni ekleme drawer'ı (`fetchVariantConfig`) |
| `frontend/src/lib/routes.ts` (değişiklik) | `PATHS.adminNew` ve alt rotalar |
| `frontend/src/App.tsx` (değişiklik, ~606) | `/yonetim-yeni` route bloğu + lazy `PanelShell` |

---

### Task 1: Ant Design kurulumu ve Tailwind çakışma kapısı

**Files:**
- Modify: `frontend/package.json` (bağımlılık)
- Create: `frontend/src/panel/theme.ts`
- Create: `frontend/src/panel/PanelProvider.tsx`
- Test: `frontend/src/panel/panelKurulum.test.tsx`

**Interfaces:**
- Consumes: —
- Produces: `panelTheme: ThemeConfig` (theme.ts), `PanelProvider({ children }: { children: React.ReactNode }): JSX.Element`

- [ ] **Step 1: Bağımlılıkları kur**

```bash
cd frontend
npm install antd@^5 @ant-design/icons@^5 dayjs@^1
```

- [ ] **Step 2: Başarısız testi yaz**

`frontend/src/panel/panelKurulum.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { Button } from "antd";
import { PanelProvider } from "@/panel/PanelProvider";
import { panelTheme } from "@/panel/theme";

describe("panel kurulumu", () => {
  it("aksan rengi tek kaynakta ve marka turuncusu", () => {
    expect(panelTheme.token?.colorPrimary).toBe("#C2410C");
  });

  it("AntD butonu Türkçe locale ile ve kendi sınıfıyla render olur", () => {
    render(
      <PanelProvider>
        <Button type="primary">Kaydet</Button>
      </PanelProvider>,
    );
    const btn = screen.getByRole("button", { name: "Kaydet" });
    // Tailwind preflight AntD sınıfını ezmemeli: AntD kendi sınıfını korumalı
    expect(btn.className).toMatch(/ant-btn/);
  });
});
```

- [ ] **Step 3: Testi çalıştır, düştüğünü gör**

Run: `cd frontend && npx vitest run src/panel/panelKurulum.test.tsx`
Expected: FAIL — `Cannot find module '@/panel/PanelProvider'`

- [ ] **Step 4: Temayı yaz**

`frontend/src/panel/theme.ts`:

```ts
import type { ThemeConfig } from "antd";

/** Panelin TEK renk/ölçü kaynağı. Başka dosyada renk sabiti yazılmaz. */
export const panelTheme: ThemeConfig = {
  token: {
    colorPrimary: "#C2410C",
    borderRadius: 8,
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: { siderBg: "#111827", headerBg: "#ffffff" },
    Menu: { darkItemBg: "#111827", darkItemSelectedBg: "#1f2937" },
  },
};
```

- [ ] **Step 5: Sarmalayıcıyı yaz**

`frontend/src/panel/PanelProvider.tsx`:

```tsx
import { ConfigProvider } from "antd";
import trTR from "antd/locale/tr_TR";
import { StyleProvider } from "@ant-design/cssinjs";
import type { ReactNode } from "react";
import { panelTheme } from "@/panel/theme";

/**
 * Panelin kökü. `hashPriority="high"` AntD stillerinin Tailwind
 * preflight'ına yenilmemesi için gereklidir (spec §6).
 */
export function PanelProvider({ children }: { children: ReactNode }) {
  return (
    <StyleProvider hashPriority="high">
      <ConfigProvider locale={trTR} theme={panelTheme}>
        {children}
      </ConfigProvider>
    </StyleProvider>
  );
}
```

- [ ] **Step 6: Testi çalıştır, geçtiğini gör**

Run: `cd frontend && npx vitest run src/panel/panelKurulum.test.tsx`
Expected: PASS (2 test)

- [ ] **Step 7: Tarayıcıda görsel çakışma kapısı**

Run: `cd frontend && npm run dev`
Geçici olarak herhangi bir sayfada `<PanelProvider><Button type="primary">Test</Button></PanelProvider>` render edip tarayıcıda kontrol et: buton AntD görünümünde (turuncu, yuvarlak köşe), yazı tipi bozuk değil, konsolda stil uyarısı yok. **Bozuksa** spec §6 sırasını uygula: (a) AntD stillerini `@layer` içine al, (b) son çare `tailwind.config.js`'e `corePlugins: { preflight: false }` **yalnızca panel derlemesi için** ekle ve bunu spec'e not düş. Geçici render kodunu sil.

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/panel/theme.ts frontend/src/panel/PanelProvider.tsx frontend/src/panel/panelKurulum.test.tsx
git commit -m "feat(panel): Ant Design kurulumu, tema tokenı ve Tailwind çakışma kapısı"
```

---

### Task 2: Panel kabuğu (Sider + Header + Content, mobil Drawer)

**Files:**
- Create: `frontend/src/panel/layout/menu.ts`
- Create: `frontend/src/panel/layout/PanelShell.tsx`
- Modify: `frontend/src/lib/routes.ts` (PATHS + ROUTES)
- Modify: `frontend/src/App.tsx` (~88 lazy import, ~606 route bloğunun yanına)
- Test: `frontend/src/panel/layout/panelShell.test.tsx`

**Interfaces:**
- Consumes: `PanelProvider`, `panelTheme` (Task 1)
- Produces: `PANEL_MENU: PanelMenuItem[]` where `PanelMenuItem = { key: string; label: string; path?: string; children?: PanelMenuItem[] }`; `PanelShell(): JSX.Element` (react-router `<Outlet/>` barındırır)

- [ ] **Step 1: Başarısız testi yaz**

`frontend/src/panel/layout/panelShell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PanelShell } from "@/panel/layout/PanelShell";
import { PANEL_MENU } from "@/panel/layout/menu";

function setViewport(width: number) {
  window.innerWidth = width;
  window.matchMedia = ((query: string) => ({
    matches: /max-width:\s*767/.test(query) ? width < 768 : width >= 768,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("PanelShell", () => {
  it("menü ağacı ikas modüllerini içerir", () => {
    const kokler = PANEL_MENU.map((m) => m.label);
    expect(kokler).toEqual(
      expect.arrayContaining(["Ürünler", "Siparişler", "Dağıtım", "Dersler", "Ayarlar"]),
    );
  });

  it("masaüstünde sol menü görünür", () => {
    setViewport(1280);
    render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByText("Ürünler")).toBeVisible();
  });

  it("mobilde menü düğmesi çıkar", () => {
    setViewport(390);
    render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /menü/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Testi çalıştır, düştüğünü gör**

Run: `cd frontend && npx vitest run src/panel/layout/panelShell.test.tsx`
Expected: FAIL — `Cannot find module '@/panel/layout/PanelShell'`

- [ ] **Step 3: Menü verisini yaz**

`frontend/src/panel/layout/menu.ts` — spec §4'teki 15 modül. Pilotta yalnız Ürünler'in alt rotaları bağlıdır; diğerleri `path` almadan görünür (sonraki paketlerde bağlanacak).

```ts
export type PanelMenuItem = {
  key: string;
  label: string;
  path?: string;
  children?: PanelMenuItem[];
};

export const PANEL_MENU: PanelMenuItem[] = [
  { key: "giris", label: "Giriş", path: "/yonetim-yeni" },
  {
    key: "urunler",
    label: "Ürünler",
    children: [
      { key: "urun-listesi", label: "Ürünler", path: "/yonetim-yeni/urunler" },
      { key: "satin-alma", label: "Satın Alma" },
      { key: "stok-sayimi", label: "Stok Sayımı" },
      { key: "stok-hareketleri", label: "Stok Hareketleri" },
      { key: "hasarli-stok", label: "Hasarlı Stok" },
      { key: "tanimlamalar", label: "Tanımlamalar" },
    ],
  },
  { key: "siparisler", label: "Siparişler" },
  { key: "dagitim", label: "Dağıtım" },
  { key: "musteriler", label: "Müşteriler" },
  { key: "dersler", label: "Dersler" },
  { key: "egitmenler", label: "Eğitmenler" },
  { key: "kutuphaneler", label: "Kütüphaneler" },
  { key: "indirimler", label: "İndirimler" },
  { key: "moderasyon", label: "Moderasyon" },
  { key: "finans", label: "Finans" },
  { key: "raporlar", label: "Raporlar" },
  { key: "satis-kanali", label: "Satış Kanalı" },
  { key: "ayarlar", label: "Ayarlar" },
];
```

- [ ] **Step 4: Kabuğu yaz**

`frontend/src/panel/layout/PanelShell.tsx`:

```tsx
import { useState } from "react";
import { Layout, Menu, Drawer, Button, Grid } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { PanelProvider } from "@/panel/PanelProvider";
import { PANEL_MENU, type PanelMenuItem } from "@/panel/layout/menu";

const { Sider, Header, Content } = Layout;

function menuyuAntdyeCevir(items: PanelMenuItem[]) {
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

  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[konum.pathname]}
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
          <Sider width={224} breakpoint="md" collapsedWidth={0} role="navigation">
            {menu}
          </Sider>
        )}
        <Layout>
          <Header style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {mobil && (
              <Button aria-label="Menü" icon={<MenuOutlined />} onClick={() => setMobilAcik(true)} />
            )}
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
          styles={{ body: { padding: 0, background: "#111827" } }}
        >
          <nav role="navigation">{menu}</nav>
        </Drawer>
      </Layout>
    </PanelProvider>
  );
}
```

- [ ] **Step 5: Rotaları tanımla**

`frontend/src/lib/routes.ts` — `PATHS` nesnesine (satır 21 sonrası uygun yere) ekle:

```ts
  /** Yeni ikas-tarzı panel (geçici kök; tamamlanınca /yonetim devralınır). */
  adminNew: "/yonetim-yeni",
  adminNewProducts: "/yonetim-yeni/urunler",
  adminNewProductNew: "/yonetim-yeni/urunler/yeni",
  adminNewProductEdit: "/yonetim-yeni/urunler/:id",
```

Aynı dosyadaki `ROUTES` nesnesine ekle:

```ts
  adminNew: PATHS.adminNew,
  adminNewProducts: PATHS.adminNewProducts,
  adminNewProductNew: PATHS.adminNewProductNew,
  adminNewProductEdit: (id: string | number) => `/yonetim-yeni/urunler/${id}`,
```

- [ ] **Step 6: App.tsx'e route bloğunu ekle**

`frontend/src/App.tsx` — lazy importlar arasına (satır ~88 civarı):

```tsx
const PanelShell = lazy(() => import("@/panel/layout/PanelShell").then((m) => ({ default: m.PanelShell })));
```

Mevcut `<Route path={PATHS.admin} element={<AdminLayout />}>` bloğunun **hemen ardına**, aynı koruma sarmalayıcısı içinde:

```tsx
            <Route path={PATHS.adminNew} element={<PanelShell />}>
              <Route index element={<div>Panel kuruldu.</div>} />
            </Route>
```

- [ ] **Step 7: Testi çalıştır, geçtiğini gör**

Run: `cd frontend && npx vitest run src/panel/layout/panelShell.test.tsx`
Expected: PASS (3 test)

- [ ] **Step 8: Tüm suite kırılmadı mı**

Run: `cd frontend && npm test`
Expected: Mevcut testlerin hepsi geçmeye devam eder (yeni testler eklenmiş olur).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/panel/layout frontend/src/lib/routes.ts frontend/src/App.tsx
git commit -m "feat(panel): panel kabuğu (sol menü, mobil drawer) ve /yonetim-yeni kökü"
```

---

### Task 3: Ortak liste iskeleti (ListePage)

**Files:**
- Create: `frontend/src/panel/components/ListePage.tsx`
- Test: `frontend/src/panel/components/listePage.test.tsx`

**Interfaces:**
- Consumes: `PanelProvider` (Task 1)
- Produces:
```ts
type ListePageProps<T> = {
  baslik: string;
  aksiyonlar?: React.ReactNode;
  aramaDegeri: string;
  aramaDegisti: (v: string) => void;
  kolonlar: import("antd").TableProps<T>["columns"];
  veri: T[] | undefined;
  yukleniyor: boolean;
  toplam?: number;
  sayfa: number;
  sayfaBoyutu: number;
  sayfaDegisti: (sayfa: number, boyut: number) => void;
  bosBaslik: string;
  bosAciklama: string;
  bosAksiyon?: React.ReactNode;
  rowKey: (kayit: T) => string | number;
};
function ListePage<T>(props: ListePageProps<T>): JSX.Element
```

- [ ] **Step 1: Başarısız testi yaz**

`frontend/src/panel/components/listePage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListePage } from "@/panel/components/ListePage";
import { PanelProvider } from "@/panel/PanelProvider";

type Satir = { id: number; ad: string };

function kur(veri: Satir[], yukleniyor = false, aramaDegisti = () => {}) {
  return render(
    <PanelProvider>
      <ListePage<Satir>
        baslik="Ürünler"
        aramaDegeri=""
        aramaDegisti={aramaDegisti}
        kolonlar={[{ title: "Ürün", dataIndex: "ad", key: "ad" }]}
        veri={veri}
        yukleniyor={yukleniyor}
        toplam={veri.length}
        sayfa={1}
        sayfaBoyutu={20}
        sayfaDegisti={() => {}}
        bosBaslik="İlk Ürününüzü Yükleyin!"
        bosAciklama="Ürünlerinizi yükleyin ve satışa başlayın."
        rowKey={(k) => k.id}
      />
    </PanelProvider>,
  );
}

describe("ListePage", () => {
  it("başlığı ve satırları gösterir", () => {
    kur([{ id: 1, ad: "9. Sınıf Matematik" }]);
    expect(screen.getByRole("heading", { name: "Ürünler" })).toBeInTheDocument();
    expect(screen.getByText("9. Sınıf Matematik")).toBeInTheDocument();
  });

  it("veri yokken boş durumu gösterir", () => {
    kur([]);
    expect(screen.getByText("İlk Ürününüzü Yükleyin!")).toBeInTheDocument();
  });

  it("aramaya yazınca geri çağrıyı tetikler", async () => {
    const araması = vi.fn();
    kur([], false, araması);
    await userEvent.type(screen.getByPlaceholderText("Tabloda arama yapın"), "kalem");
    expect(araması).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Testi çalıştır, düştüğünü gör**

Run: `cd frontend && npx vitest run src/panel/components/listePage.test.tsx`
Expected: FAIL — `Cannot find module '@/panel/components/ListePage'`

- [ ] **Step 3: Bileşeni yaz**

`frontend/src/panel/components/ListePage.tsx`:

```tsx
import { Card, Empty, Flex, Input, Table, Typography } from "antd";
import type { TableProps } from "antd";
import type { ReactNode } from "react";

export type ListePageProps<T> = {
  baslik: string;
  aksiyonlar?: ReactNode;
  aramaDegeri: string;
  aramaDegisti: (v: string) => void;
  kolonlar: TableProps<T>["columns"];
  veri: T[] | undefined;
  yukleniyor: boolean;
  toplam?: number;
  sayfa: number;
  sayfaBoyutu: number;
  sayfaDegisti: (sayfa: number, boyut: number) => void;
  bosBaslik: string;
  bosAciklama: string;
  bosAksiyon?: ReactNode;
  rowKey: (kayit: T) => string | number;
};

export function ListePage<T extends object>({
  baslik, aksiyonlar, aramaDegeri, aramaDegisti, kolonlar, veri, yukleniyor,
  toplam, sayfa, sayfaBoyutu, sayfaDegisti, bosBaslik, bosAciklama, bosAksiyon, rowKey,
}: ListePageProps<T>) {
  const bos = !yukleniyor && (veri?.length ?? 0) === 0;

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {baslik}
        </Typography.Title>
        <Flex gap={8} wrap>{aksiyonlar}</Flex>
      </Flex>

      <Card>
        <Flex justify="space-between" wrap gap={12} style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="Tabloda arama yapın"
            allowClear
            value={aramaDegeri}
            onChange={(e) => aramaDegisti(e.target.value)}
            style={{ maxWidth: 320 }}
          />
        </Flex>

        {bos ? (
          <Empty
            description={
              <Flex vertical gap={4} align="center">
                <Typography.Text strong>{bosBaslik}</Typography.Text>
                <Typography.Text type="secondary">{bosAciklama}</Typography.Text>
              </Flex>
            }
          >
            {bosAksiyon}
          </Empty>
        ) : (
          <Table<T>
            columns={kolonlar}
            dataSource={veri}
            loading={yukleniyor}
            rowKey={rowKey}
            scroll={{ x: "max-content" }}
            pagination={{
              current: sayfa,
              pageSize: sayfaBoyutu,
              total: toplam,
              showSizeChanger: true,
              onChange: sayfaDegisti,
              showTotal: (t, [bas, son]) => `${bas}-${son} / ${t} kayıt`,
            }}
          />
        )}
      </Card>
    </Flex>
  );
}
```

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `cd frontend && npx vitest run src/panel/components/listePage.test.tsx`
Expected: PASS (3 test)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panel/components/ListePage.tsx frontend/src/panel/components/listePage.test.tsx
git commit -m "feat(panel): ortak liste iskeleti (arama, tablo, sayfalama, boş durum)"
```

---

### Task 4: Ürün listesi ekranı (gerçek API)

**Files:**
- Create: `frontend/src/panel/pages/urunler/UrunListesi.tsx`
- Modify: `frontend/src/App.tsx` (`/yonetim-yeni` bloğuna alt rota)
- Test: `frontend/src/panel/pages/urunler/urunListesi.test.tsx`

**Interfaces:**
- Consumes: `ListePage` (Task 3); mevcut `useAdminProducts(query, enabled)` → `@/hooks/useStore` (dönüş: React Query sonucu; `data` = `storeApi.listProductsAdmin` çıktısı)
- Produces: `UrunListesi(): JSX.Element`

- [ ] **Step 1: `listProductsAdmin` dönüş şeklini doğrula**

Run: `cd frontend && grep -nA14 "export async function listProductsAdmin" src/api/store.ts`
Dönüşün sayfalı mı (`{ items, total }`) yoksa dizi mi olduğunu **oku ve not et**; sonraki adımdaki test ve bileşen bu şekle göre yazılır. (Aşağıdaki kod `{ items, total }` varsayar; dizi ise `veri={data}` ve `toplam={data?.length}` olarak uyarlanır.)

- [ ] **Step 2: Başarısız testi yaz**

`frontend/src/panel/pages/urunler/urunListesi.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UrunListesi } from "@/panel/pages/urunler/UrunListesi";

vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: () => ({
    data: { items: [{ id: 1, title: "9. Sınıf Matematik Soru Bankası", price: 250, stock: 50 }], total: 1 },
    isLoading: false,
  }),
}));

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UrunListesi />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UrunListesi", () => {
  it("ürün adını ve fiyatını listeler", () => {
    kur();
    expect(screen.getByText("9. Sınıf Matematik Soru Bankası")).toBeInTheDocument();
    expect(screen.getByText(/250/)).toBeInTheDocument();
  });

  it("ürün ekle aksiyonu bulunur", () => {
    kur();
    expect(screen.getByRole("button", { name: /Ürün Ekle/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Testi çalıştır, düştüğünü gör**

Run: `cd frontend && npx vitest run src/panel/pages/urunler/urunListesi.test.tsx`
Expected: FAIL — `Cannot find module '@/panel/pages/urunler/UrunListesi'`

- [ ] **Step 4: Ekranı yaz**

`frontend/src/panel/pages/urunler/UrunListesi.tsx`:

```tsx
import { useState } from "react";
import { Button } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { ListePage } from "@/panel/components/ListePage";
import { useAdminProducts } from "@/hooks/useStore";
import { ROUTES } from "@/lib/routes";

type UrunSatiri = { id: number; title: string; price: number; stock?: number };

export function UrunListesi() {
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);
  const navigate = useNavigate();

  const { data, isLoading } = useAdminProducts({ search: arama || undefined, page: sayfa, size: boyut });
  const satirlar = (data as { items?: UrunSatiri[] } | undefined)?.items ?? [];
  const toplam = (data as { total?: number } | undefined)?.total ?? satirlar.length;

  return (
    <ListePage<UrunSatiri>
      baslik="Ürünler"
      aksiyonlar={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(ROUTES.adminNewProductNew)}>
          Ürün Ekle
        </Button>
      }
      aramaDegeri={arama}
      aramaDegisti={(v) => { setArama(v); setSayfa(1); }}
      kolonlar={[
        { title: "Ürün", dataIndex: "title", key: "title" },
        {
          title: "Satış Fiyatı", dataIndex: "price", key: "price",
          render: (v: number) => `₺ ${Number(v).toFixed(2)}`,
        },
        {
          title: "Envanter", dataIndex: "stock", key: "stock",
          render: (v?: number) => (v == null ? "—" : `${v} adet`),
        },
      ]}
      veri={satirlar}
      yukleniyor={isLoading}
      toplam={toplam}
      sayfa={sayfa}
      sayfaBoyutu={boyut}
      sayfaDegisti={(s, b) => { setSayfa(s); setBoyut(b); }}
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
```

**Not:** Step 1'de okunan gerçek dönüş şekli `{ items, total }` değilse bu dosyadaki `satirlar`/`toplam` satırlarını ve `useAdminProducts` çağrısının query alanlarını (`search`/`page`/`size`) gerçek `AdminProductQuery` alan adlarıyla değiştir.

- [ ] **Step 5: Rotayı bağla**

`frontend/src/App.tsx` — `/yonetim-yeni` bloğunu güncelle:

```tsx
            <Route path={PATHS.adminNew} element={<PanelShell />}>
              <Route index element={<div>Panel kuruldu.</div>} />
              <Route path="urunler" element={<UrunListesi />} />
            </Route>
```

lazy import ekle (diğer lazy importların yanına):

```tsx
const UrunListesi = lazy(() => import("@/panel/pages/urunler/UrunListesi").then((m) => ({ default: m.UrunListesi })));
```

- [ ] **Step 6: Testi çalıştır, geçtiğini gör**

Run: `cd frontend && npx vitest run src/panel/pages/urunler/urunListesi.test.tsx`
Expected: PASS (2 test)

- [ ] **Step 7: Gerçek veriyle tarayıcı kontrolü**

Run: `cd frontend && npm run dev` → `/yonetim-yeni/urunler` adresini ADMIN hesabıyla aç. Gerçek ürünler listelenmeli, arama çalışmalı, sayfalama görünmeli. Konsolda hata olmamalı.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/panel/pages/urunler frontend/src/App.tsx
git commit -m "feat(panel): ürün listesi ekranı (arama, sayfalama, gerçek API)"
```

---

### Task 5: Tip seçimi modalı (Ürün Ekle: Basit / Varyantlı)

**Files:**
- Create: `frontend/src/panel/components/TipSecimi.tsx`
- Modify: `frontend/src/panel/pages/urunler/UrunListesi.tsx`
- Test: `frontend/src/panel/components/tipSecimi.test.tsx`

**Interfaces:**
- Consumes: `PanelProvider` (Task 1)
- Produces:
```ts
type TipSecenegi = { anahtar: string; baslik: string; aciklama: string };
type TipSecimiProps = {
  acik: boolean;
  baslik: string;
  secenekler: TipSecenegi[];
  kapat: () => void;
  secildi: (anahtar: string) => void;
};
function TipSecimi(props: TipSecimiProps): JSX.Element
```

- [ ] **Step 1: Başarısız testi yaz**

`frontend/src/panel/components/tipSecimi.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TipSecimi } from "@/panel/components/TipSecimi";
import { PanelProvider } from "@/panel/PanelProvider";

describe("TipSecimi", () => {
  it("seçenekleri gösterir ve seçimi bildirir", async () => {
    const secildi = vi.fn();
    render(
      <PanelProvider>
        <TipSecimi
          acik
          baslik="Ürün Ekle"
          secenekler={[
            { anahtar: "basit", baslik: "Basit Ürün", aciklama: "Tek parça olarak bir ürün ekleyin" },
            { anahtar: "varyantli", baslik: "Varyantlı Ürün", aciklama: "Renk, boyut gibi seçeneklerle ekleyin" },
          ]}
          kapat={() => {}}
          secildi={secildi}
        />
      </PanelProvider>,
    );
    expect(screen.getByText("Basit Ürün")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Varyantlı Ürün"));
    expect(secildi).toHaveBeenCalledWith("varyantli");
  });
});
```

- [ ] **Step 2: Testi çalıştır, düştüğünü gör**

Run: `cd frontend && npx vitest run src/panel/components/tipSecimi.test.tsx`
Expected: FAIL — modül bulunamadı

- [ ] **Step 3: Bileşeni yaz**

`frontend/src/panel/components/TipSecimi.tsx`:

```tsx
import { Card, Flex, Modal, Typography } from "antd";

export type TipSecenegi = { anahtar: string; baslik: string; aciklama: string };

export type TipSecimiProps = {
  acik: boolean;
  baslik: string;
  secenekler: TipSecenegi[];
  kapat: () => void;
  secildi: (anahtar: string) => void;
};

export function TipSecimi({ acik, baslik, secenekler, kapat, secildi }: TipSecimiProps) {
  return (
    <Modal open={acik} title={baslik} onCancel={kapat} footer={null} destroyOnClose>
      <Flex vertical gap={12}>
        {secenekler.map((s) => (
          <Card key={s.anahtar} hoverable onClick={() => secildi(s.anahtar)}>
            <Typography.Text strong>{s.baslik}</Typography.Text>
            <br />
            <Typography.Text type="secondary">{s.aciklama}</Typography.Text>
          </Card>
        ))}
      </Flex>
    </Modal>
  );
}
```

- [ ] **Step 4: Ürün listesine bağla**

`frontend/src/panel/pages/urunler/UrunListesi.tsx` içinde: `const [tipAcik, setTipAcik] = useState(false);` ekle; her iki "Ürün Ekle" butonunun `onClick`'ini `() => setTipAcik(true)` yap; bileşenin dönüşünü `<>` ile sar ve `ListePage`'in ardına ekle:

```tsx
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
```

- [ ] **Step 5: Testleri çalıştır, geçtiğini gör**

Run: `cd frontend && npx vitest run src/panel/components/tipSecimi.test.tsx src/panel/pages/urunler/urunListesi.test.tsx`
Expected: PASS (3 test)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panel/components/TipSecimi.tsx frontend/src/panel/components/tipSecimi.test.tsx frontend/src/panel/pages/urunler/UrunListesi.tsx
git commit -m "feat(panel): ürün tipi seçim modalı (basit/varyantlı)"
```

---

### Task 6: Ortak form iskeleti (FormPage)

**Files:**
- Create: `frontend/src/panel/components/FormPage.tsx`
- Test: `frontend/src/panel/components/formPage.test.tsx`

**Interfaces:**
- Consumes: `PanelProvider` (Task 1)
- Produces:
```ts
type FormBolumu = { anahtar: string; baslik: string; icerik: React.ReactNode };
type FormPageProps = {
  baslik: string;
  geriTiklandi: () => void;
  bolumler: FormBolumu[];
  kaydet: () => void;
  kaydediyor?: boolean;
  ikincilAksiyon?: React.ReactNode;
};
function FormPage(props: FormPageProps): JSX.Element
```

- [ ] **Step 1: Başarısız testi yaz**

`frontend/src/panel/components/formPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormPage } from "@/panel/components/FormPage";
import { PanelProvider } from "@/panel/PanelProvider";

describe("FormPage", () => {
  it("bölümleri sekme olarak gösterir ve kaydet'i tetikler", async () => {
    const kaydet = vi.fn();
    render(
      <PanelProvider>
        <FormPage
          baslik="Basit Ürün Ekle"
          geriTiklandi={() => {}}
          kaydet={kaydet}
          bolumler={[
            { anahtar: "temel", baslik: "Temel Bilgi", icerik: <div>temel alanlar</div> },
            { anahtar: "envanter", baslik: "Envanter", icerik: <div>envanter alanları</div> },
          ]}
        />
      </PanelProvider>,
    );
    expect(screen.getByText("Basit Ürün Ekle")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Temel Bilgi" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Envanter" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(kaydet).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Testi çalıştır, düştüğünü gör**

Run: `cd frontend && npx vitest run src/panel/components/formPage.test.tsx`
Expected: FAIL — modül bulunamadı

- [ ] **Step 3: Bileşeni yaz**

`frontend/src/panel/components/FormPage.tsx`:

```tsx
import { Button, Card, Flex, Tabs, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

export type FormBolumu = { anahtar: string; baslik: string; icerik: ReactNode };

export type FormPageProps = {
  baslik: string;
  geriTiklandi: () => void;
  bolumler: FormBolumu[];
  kaydet: () => void;
  kaydediyor?: boolean;
  ikincilAksiyon?: ReactNode;
};

export function FormPage({
  baslik, geriTiklandi, bolumler, kaydet, kaydediyor, ikincilAksiyon,
}: FormPageProps) {
  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12}>
        <Flex align="center" gap={12}>
          <Button aria-label="Geri" icon={<ArrowLeftOutlined />} onClick={geriTiklandi} />
          <Typography.Title level={4} style={{ margin: 0 }}>{baslik}</Typography.Title>
        </Flex>
        <Flex gap={8} wrap>
          {ikincilAksiyon}
          <Button type="primary" loading={kaydediyor} onClick={kaydet}>Kaydet</Button>
        </Flex>
      </Flex>

      <Tabs
        items={bolumler.map((b) => ({
          key: b.anahtar,
          label: b.baslik,
          children: <Card>{b.icerik}</Card>,
        }))}
      />
    </Flex>
  );
}
```

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `cd frontend && npx vitest run src/panel/components/formPage.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panel/components/FormPage.tsx frontend/src/panel/components/formPage.test.tsx
git commit -m "feat(panel): ortak form iskeleti (üst bar + sekmeler)"
```

---

### Task 7: Ürün formu — kaydetme uçtan uca

**Files:**
- Create: `frontend/src/panel/pages/urunler/UrunFormu.tsx`
- Modify: `frontend/src/App.tsx` (yeni/düzenle rotaları)
- Test: `frontend/src/panel/pages/urunler/urunFormu.test.tsx`

**Interfaces:**
- Consumes: `FormPage` (Task 6); `createProduct`, `updateProduct`, `fetchProductAdmin` → `@/api/store`
- Produces: `UrunFormu(): JSX.Element`

- [ ] **Step 1: `createProduct` imzasını doğrula**

Run: `cd frontend && grep -nA12 "export async function createProduct" src/api/store.ts`
Zorunlu alanları (ör. `title`, `price`, `kind`) **oku ve not et**; test ve bileşen bu alan adlarını kullanır.

- [ ] **Step 2: Başarısız testi yaz**

`frontend/src/panel/pages/urunler/urunFormu.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UrunFormu } from "@/panel/pages/urunler/UrunFormu";

const createProduct = vi.fn().mockResolvedValue({ id: 7 });
vi.mock("@/api/store", () => ({
  createProduct: (...a: unknown[]) => createProduct(...a),
  updateProduct: vi.fn(),
  fetchProductAdmin: vi.fn(),
}));

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UrunFormu />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UrunFormu", () => {
  it("zorunlu alanlar boşken kaydetmez", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("ad ve fiyat girilince createProduct çağrılır", async () => {
    kur();
    await userEvent.type(screen.getByLabelText("Ürün Adı"), "Deneme Kalem Seti");
    await userEvent.type(screen.getByLabelText("Satış Fiyatı"), "120");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Deneme Kalem Seti", price: 120 }),
    );
  });
});
```

- [ ] **Step 3: Testi çalıştır, düştüğünü gör**

Run: `cd frontend && npx vitest run src/panel/pages/urunler/urunFormu.test.tsx`
Expected: FAIL — modül bulunamadı

- [ ] **Step 4: Formu yaz**

`frontend/src/panel/pages/urunler/UrunFormu.tsx`:

```tsx
import { useState } from "react";
import { Form, Input, InputNumber, Select, message } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { FormPage } from "@/panel/components/FormPage";
import { createProduct, updateProduct } from "@/api/store";
import { ROUTES } from "@/lib/routes";

type UrunFormDegerleri = {
  title: string;
  price: number;
  compare_at_price?: number;
  kind?: string;
  sku?: string;
  barcode?: string;
  slug?: string;
  seo_title?: string;
};

export function UrunFormu() {
  const [form] = Form.useForm<UrunFormDegerleri>();
  const [kaydediyor, setKaydediyor] = useState(false);
  const navigate = useNavigate();
  const { id } = useParams();

  async function kaydet() {
    let degerler: UrunFormDegerleri;
    try {
      degerler = await form.validateFields();
    } catch {
      return; // doğrulama hatası: AntD alan altında gösterir
    }
    setKaydediyor(true);
    try {
      if (id) await updateProduct(Number(id), degerler);
      else await createProduct(degerler);
      message.success("Ürün kaydedildi.");
      navigate(ROUTES.adminNewProducts);
    } catch {
      message.error("Ürün kaydedilemedi.");
    } finally {
      setKaydediyor(false);
    }
  }

  return (
    <Form form={form} layout="vertical" requiredMark>
      <FormPage
        baslik={id ? "Ürünü Düzenle" : "Basit Ürün Ekle"}
        geriTiklandi={() => navigate(ROUTES.adminNewProducts)}
        kaydet={kaydet}
        kaydediyor={kaydediyor}
        bolumler={[
          {
            anahtar: "temel",
            baslik: "Temel Bilgi",
            icerik: (
              <>
                <Form.Item label="Ürün Adı" name="title" rules={[{ required: true, message: "Ürün adı zorunludur." }]}>
                  <Input />
                </Form.Item>
                <Form.Item label="Satış Fiyatı" name="price" rules={[{ required: true, message: "Fiyat zorunludur." }]}>
                  <InputNumber min={0} prefix="₺" style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="İndirimli Fiyat" name="compare_at_price">
                  <InputNumber min={0} prefix="₺" style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="Ürün Türü" name="kind">
                  <Select
                    options={[
                      { value: "PHYSICAL", label: "Fiziksel" },
                      { value: "DIGITAL", label: "Dijital" },
                    ]}
                  />
                </Form.Item>
              </>
            ),
          },
          {
            anahtar: "envanter",
            baslik: "Envanter",
            icerik: (
              <>
                <Form.Item label="SKU" name="sku"><Input /></Form.Item>
                <Form.Item label="Barkod" name="barcode"><Input /></Form.Item>
              </>
            ),
          },
          {
            anahtar: "seo",
            baslik: "SEO",
            icerik: (
              <>
                <Form.Item label="Slug" name="slug"><Input /></Form.Item>
                <Form.Item label="Sayfa Başlığı" name="seo_title"><Input /></Form.Item>
              </>
            ),
          },
        ]}
      />
    </Form>
  );
}
```

**Not:** Step 1'de okunan gerçek alan adları farklıysa (`compare_at_price`, `kind`, `sku`, `barcode`, `slug`, `seo_title`) hem testteki hem formdaki adları gerçek API sözleşmesine göre düzelt.

- [ ] **Step 5: Rotaları bağla**

`frontend/src/App.tsx` — `/yonetim-yeni` bloğuna:

```tsx
              <Route path="urunler/yeni" element={<UrunFormu />} />
              <Route path="urunler/:id" element={<UrunFormu />} />
```

lazy import:

```tsx
const UrunFormu = lazy(() => import("@/panel/pages/urunler/UrunFormu").then((m) => ({ default: m.UrunFormu })));
```

- [ ] **Step 6: Testi çalıştır, geçtiğini gör**

Run: `cd frontend && npx vitest run src/panel/pages/urunler/urunFormu.test.tsx`
Expected: PASS (2 test)

- [ ] **Step 7: Gerçek uçtan uca kontrol**

`npm run dev` → `/yonetim-yeni/urunler` → "Ürün Ekle" → Basit Ürün → ad+fiyat gir → Kaydet. Ürün listeye düşmeli; `/yonetim` (eski panel) ürün listesinde de görünmeli (aynı API). Sonra oluşturduğun deneme ürününü eski panelden sil.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/panel/pages/urunler/UrunFormu.tsx frontend/src/panel/pages/urunler/urunFormu.test.tsx frontend/src/App.tsx
git commit -m "feat(panel): sekmeli ürün formu ve ürün kaydetme"
```

---

### Task 8: Varyant penceresi ve kombinasyon matrisi

**Files:**
- Create: `frontend/src/panel/components/YanPencere.tsx`
- Create: `frontend/src/panel/pages/urunler/VaryantPenceresi.tsx`
- Create: `frontend/src/panel/components/Matris.tsx`
- Modify: `frontend/src/panel/pages/urunler/UrunFormu.tsx` (Varyant sekmesi)
- Test: `frontend/src/panel/pages/urunler/varyant.test.tsx`

**Interfaces:**
- Consumes: `FormPage` (Task 6); `fetchVariantConfig` → `@/api/store` (eksen sözlüğü)
- Produces:
```ts
type YanPencereProps = { acik: boolean; baslik: string; kapat: () => void; kaydet: () => void; children: React.ReactNode };
function YanPencere(props: YanPencereProps): JSX.Element
type VaryantEkseni = { ad: string; degerler: string[] };
function VaryantPenceresi(props: { acik: boolean; kapat: () => void; eklendi: (eksen: VaryantEkseni) => void }): JSX.Element
type MatrisSatiri = { anahtar: string; kombinasyon: string; price?: number; sku?: string; barcode?: string; stock?: number };
function Matris(props: { satirlar: MatrisSatiri[]; degisti: (anahtar: string, alan: keyof MatrisSatiri, deger: string | number) => void }): JSX.Element
```

- [ ] **Step 1: `fetchVariantConfig` dönüşünü doğrula**

Run: `cd frontend && grep -nA10 "export async function fetchVariantConfig" src/api/store.ts && grep -nA10 "VariantConfig" src/types/index.ts 2>/dev/null | head -20`
Eksen sözlüğünün (VARIANT_AXES) hangi alanda geldiğini **oku ve not et**.

- [ ] **Step 2: Başarısız testi yaz**

`frontend/src/panel/pages/urunler/varyant.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VaryantPenceresi } from "@/panel/pages/urunler/VaryantPenceresi";
import { Matris } from "@/panel/components/Matris";
import { PanelProvider } from "@/panel/PanelProvider";

vi.mock("@/api/store", () => ({
  fetchVariantConfig: vi.fn().mockResolvedValue({ axes: ["Renk", "Ebat"] }),
}));

describe("varyant akışı", () => {
  it("eksen adı ve değerler girilip eklenebilir", async () => {
    const eklendi = vi.fn();
    render(
      <PanelProvider>
        <VaryantPenceresi acik kapat={() => {}} eklendi={eklendi} />
      </PanelProvider>,
    );
    await userEvent.type(screen.getByLabelText("Varyant Türü Adı"), "Renk");
    await userEvent.type(screen.getByLabelText("Varyantlar"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(eklendi).toHaveBeenCalledWith({ ad: "Renk", degerler: ["Kırmızı", "Mavi"] });
  });

  it("matris her kombinasyon için düzenlenebilir alan gösterir", async () => {
    const degisti = vi.fn();
    render(
      <PanelProvider>
        <Matris
          satirlar={[
            { anahtar: "k1", kombinasyon: "Kırmızı", price: 100 },
            { anahtar: "k2", kombinasyon: "Mavi", price: 100 },
          ]}
          degisti={degisti}
        />
      </PanelProvider>,
    );
    expect(screen.getByText("Kırmızı")).toBeInTheDocument();
    expect(screen.getByText("Mavi")).toBeInTheDocument();
    const sku = screen.getAllByLabelText(/SKU/i)[0];
    await userEvent.type(sku, "ABC");
    expect(degisti).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Testi çalıştır, düştüğünü gör**

Run: `cd frontend && npx vitest run src/panel/pages/urunler/varyant.test.tsx`
Expected: FAIL — modüller bulunamadı

- [ ] **Step 4: YanPencere'yi yaz**

`frontend/src/panel/components/YanPencere.tsx`:

```tsx
import { Button, Drawer, Flex, Grid } from "antd";
import type { ReactNode } from "react";

export type YanPencereProps = {
  acik: boolean;
  baslik: string;
  kapat: () => void;
  kaydet: () => void;
  children: ReactNode;
};

export function YanPencere({ acik, baslik, kapat, kaydet, children }: YanPencereProps) {
  const { md } = Grid.useBreakpoint();
  return (
    <Drawer
      open={acik}
      title={baslik}
      onClose={kapat}
      placement="right"
      width={md === false ? "100%" : 480}
      footer={
        <Flex justify="flex-end" gap={8}>
          <Button onClick={kapat}>Vazgeç</Button>
          <Button type="primary" onClick={kaydet}>Kaydet</Button>
        </Flex>
      }
    >
      {children}
    </Drawer>
  );
}
```

- [ ] **Step 5: VaryantPenceresi'ni yaz**

`frontend/src/panel/pages/urunler/VaryantPenceresi.tsx`:

```tsx
import { useState } from "react";
import { Form, Input, Radio } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";

export type VaryantEkseni = { ad: string; degerler: string[] };

export function VaryantPenceresi({
  acik, kapat, eklendi,
}: { acik: boolean; kapat: () => void; eklendi: (eksen: VaryantEkseni) => void }) {
  const [ad, setAd] = useState("");
  const [degerler, setDegerler] = useState("");
  const [stil, setStil] = useState<"liste" | "renk">("liste");

  function kaydet() {
    const parcalar = degerler.split(",").map((d) => d.trim()).filter(Boolean);
    if (!ad.trim() || parcalar.length === 0) return;
    eklendi({ ad: ad.trim(), degerler: parcalar });
    setAd(""); setDegerler(""); setStil("liste");
    kapat();
  }

  return (
    <YanPencere acik={acik} baslik="Varyant Ekle" kapat={kapat} kaydet={kaydet}>
      <Form layout="vertical">
        <Form.Item label="Varyant Türü Adı" required>
          <Input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="ör. Renk, Ebat" />
        </Form.Item>
        <Form.Item label="Seçim Stili">
          <Radio.Group value={stil} onChange={(e) => setStil(e.target.value)}>
            <Radio value="liste">Liste</Radio>
            <Radio value="renk">Renk / Görsel</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item label="Varyantlar" required help="Virgülle ayırın: Kırmızı,Mavi">
          <Input value={degerler} onChange={(e) => setDegerler(e.target.value)} placeholder="Kırmızı,Mavi" />
        </Form.Item>
      </Form>
    </YanPencere>
  );
}
```

- [ ] **Step 6: Matris'i yaz**

`frontend/src/panel/components/Matris.tsx`:

```tsx
import { Input, InputNumber, Table } from "antd";

export type MatrisSatiri = {
  anahtar: string;
  kombinasyon: string;
  price?: number;
  sku?: string;
  barcode?: string;
  stock?: number;
};

export function Matris({
  satirlar, degisti,
}: {
  satirlar: MatrisSatiri[];
  degisti: (anahtar: string, alan: keyof MatrisSatiri, deger: string | number) => void;
}) {
  return (
    <Table<MatrisSatiri>
      rowKey="anahtar"
      dataSource={satirlar}
      pagination={false}
      scroll={{ x: "max-content" }}
      columns={[
        { title: "Varyantlar", dataIndex: "kombinasyon", key: "kombinasyon" },
        {
          title: "Satış Fiyatı", key: "price",
          render: (_, k) => (
            <InputNumber
              aria-label={`Fiyat ${k.kombinasyon}`}
              value={k.price}
              min={0}
              onChange={(v) => degisti(k.anahtar, "price", Number(v ?? 0))}
            />
          ),
        },
        {
          title: "SKU", key: "sku",
          render: (_, k) => (
            <Input
              aria-label={`SKU ${k.kombinasyon}`}
              value={k.sku}
              onChange={(e) => degisti(k.anahtar, "sku", e.target.value)}
            />
          ),
        },
        {
          title: "Barkod", key: "barcode",
          render: (_, k) => (
            <Input
              aria-label={`Barkod ${k.kombinasyon}`}
              value={k.barcode}
              onChange={(e) => degisti(k.anahtar, "barcode", e.target.value)}
            />
          ),
        },
        {
          title: "Stok", key: "stock",
          render: (_, k) => (
            <InputNumber
              aria-label={`Stok ${k.kombinasyon}`}
              value={k.stock}
              min={0}
              onChange={(v) => degisti(k.anahtar, "stock", Number(v ?? 0))}
            />
          ),
        },
      ]}
    />
  );
}
```

- [ ] **Step 7: Ürün formuna Varyant sekmesini ekle**

`frontend/src/panel/pages/urunler/UrunFormu.tsx` — state ekle:

```tsx
const [eksenler, setEksenler] = useState<VaryantEkseni[]>([]);
const [varyantAcik, setVaryantAcik] = useState(false);
const [matris, setMatris] = useState<MatrisSatiri[]>([]);
```

`bolumler` dizisine (SEO'dan önce) ekle:

```tsx
          {
            anahtar: "varyant",
            baslik: "Varyant",
            icerik: (
              <>
                <Button onClick={() => setVaryantAcik(true)} style={{ marginBottom: 16 }}>
                  Varyant Ekle
                </Button>
                {matris.length > 0 && (
                  <Matris
                    satirlar={matris}
                    degisti={(anahtar, alan, deger) =>
                      setMatris((onceki) =>
                        onceki.map((s) => (s.anahtar === anahtar ? { ...s, [alan]: deger } : s)),
                      )
                    }
                  />
                )}
                <VaryantPenceresi
                  acik={varyantAcik}
                  kapat={() => setVaryantAcik(false)}
                  eklendi={(eksen) => {
                    const yeniEksenler = [...eksenler, eksen];
                    setEksenler(yeniEksenler);
                    // Kombinasyonları kartezyen çarpımla üret
                    const kombinasyonlar = yeniEksenler.reduce<string[][]>(
                      (acc, e) => acc.flatMap((onek) => e.degerler.map((d) => [...onek, d])),
                      [[]],
                    );
                    setMatris(
                      kombinasyonlar.map((k) => ({ anahtar: k.join("|"), kombinasyon: k.join(" / ") })),
                    );
                  }}
                />
              </>
            ),
          },
```

Gerekli importları ekle: `Button` (antd), `Matris`, `MatrisSatiri`, `VaryantPenceresi`, `VaryantEkseni`.

- [ ] **Step 8: Testleri çalıştır, geçtiğini gör**

Run: `cd frontend && npx vitest run src/panel/pages/urunler/varyant.test.tsx src/panel/pages/urunler/urunFormu.test.tsx`
Expected: PASS (4 test)

- [ ] **Step 9: Commit**

```bash
git add frontend/src/panel/components/YanPencere.tsx frontend/src/panel/components/Matris.tsx frontend/src/panel/pages/urunler/VaryantPenceresi.tsx frontend/src/panel/pages/urunler/varyant.test.tsx frontend/src/panel/pages/urunler/UrunFormu.tsx
git commit -m "feat(panel): varyant yan penceresi ve kombinasyon matrisi"
```

---

### Task 9: Mobil ve tam suite kapısı

**Files:**
- Test: `frontend/src/panel/panelMobil.test.tsx`

**Interfaces:**
- Consumes: `PanelShell` (Task 2), `UrunListesi` (Task 4)
- Produces: —

- [ ] **Step 1: Mobil testini yaz**

`frontend/src/panel/panelMobil.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PanelShell } from "@/panel/layout/PanelShell";

function mobilYap() {
  window.innerWidth = 390;
  window.matchMedia = ((query: string) => ({
    matches: /max-width:\s*(575|767)/.test(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("panel mobil davranışı", () => {
  it("390px'te menü düğmesiyle çekmece açılır", async () => {
    mobilYap();
    render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /menü/i }));
    expect(screen.getAllByText("Ürünler").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Testi çalıştır**

Run: `cd frontend && npx vitest run src/panel/panelMobil.test.tsx`
Expected: PASS (1 test). Düşerse `PanelShell`'deki `Grid.useBreakpoint()` yerine `md === false` koşulunu `window.innerWidth < 768` ile destekleyip tekrar dene.

- [ ] **Step 3: Tam suite**

Run: `cd frontend && npm test`
Expected: Tüm testler geçer (mevcut + yeni ~13 test). Kırmızı varsa **mevcut testleri bozmuş olabilirsin** — düzelt, atlama.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: Hata yok.

- [ ] **Step 5: Gerçek tarayıcı duman turu**

`npm run dev` → `/yonetim-yeni/urunler`: masaüstünde liste+arama+sayfalama; pencereyi 390px'e küçültüp menü düğmesi→çekmece; "Ürün Ekle"→tip modalı→form sekmeleri→varyant drawer→matris. Konsol temiz olmalı.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panel/panelMobil.test.tsx
git commit -m "test(panel): mobil çekmece davranışı ve paket kapısı"
```

---

## Spec'ten bilinçli sapma

Spec §7 pilot kapsamında **Medya** sekmesini (görsel/video yükleme) da sayıyor; bu plan onu **kapsam dışında** bırakır. Gerekçe: görsel yükleme kendi başına bir akış (`uploadProductCover`, `uploadProductImages`, `reorderProductImages`, `deleteProductImage` — dördü birlikte sıralama ve silme UI'ı gerektirir) ve pilotun asıl amacı olan "kabuk + ortak bileşenler + sekmeli form + varyant" doğrulamasını geciktirir. **Medya sekmesi Paket 2'nin ilk işidir** ve aynı `FormPage` iskeletine eklenecektir. Ürün formu Paket 1 sonunda Medya olmadan da kaydedilebilir durumdadır.

## Paket sonrası

Bu paket bittiğinde elde: AntD tabanlı panel kabuğu, ortak liste/form/drawer/matris bileşenleri ve uçtan uca çalışan Ürünler modülü (`/yonetim-yeni/urunler`).

**Kullanıcıya gösterilir ve onay alınır** (proje kuralı: paket paket onay). Onaydan sonra sıradaki paketler aynı bileşenleri tüketerek yazılır: Siparişler → Dağıtım → Dersler → Eğitmenler → Kütüphaneler → kalanlar. Tüm modüller bittiğinde `/yonetim-yeni` → `/yonetim` devri yapılır ve eski panel kodu silinir (spec §2).
