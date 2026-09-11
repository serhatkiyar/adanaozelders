import { adminAreaAccess } from "@/lib/adminAccess";
import { PATHS } from "@/lib/routes";

/**
 * Menü ikonları — `docs/ikas-panel-referans.md` §7 "Sider menüsü — İKİNCİ TUR
 * ÖLÇÜM": ikon YALNIZ kök öğelerde var, alt öğelerde YOK (16 anahtar, 17 kök
 * öğeye karşılık gelir — bkz. `PANEL_MENU`). Bu dosya `.ts` (JSX yok,
 * `panel/layout/PanelShell.tsx`in aksine): ikon BİLEŞENİ değil, ANAHTARI
 * taşınır. Gerçek `@ant-design/icons` bileşenine çevirme işi
 * `PanelShell.tsx`teki `PANEL_MENU_ICONS` sözlüğünündür — menü verisi
 * AntD'yi hiç bilmez (mevcut mimari: bu dosya saf veri, dönüşüm
 * `menuyuAntdyeCevir`de).
 */
export type PanelMenuIconKey =
  | "home"
  | "shopping"
  | "container"
  | "team"
  | "percentage"
  | "inbox"
  | "notification"
  | "barchart"
  | "appstore-add"
  | "setting"
  | "shop"
  | "car"
  | "read"
  | "solution"
  | "book"
  | "safety"
  | "wallet";

export type PanelMenuItem = {
  key: string;
  label: string;
  path?: string;
  children?: PanelMenuItem[];
  /**
   * ikas referansı §7 "Sider menüsü — İKİNCİ TUR ÖLÇÜM": ikon YALNIZ kök
   * öğelerde var (16×16), alt öğelerde YOK — canlı panelden ölçüldü. Bu
   * yüzden yalnız kök seviyedeki öğelere verilir; alt öğelerde BİLİNÇLİ
   * OLARAK boş bırakılır (opsiyonel — yanlışlıkla eklenmesin diye zorunlu
   * tutulmuyor, `panelShell.test.tsx` bu ayrımı sınar).
   */
  icon?: PanelMenuIconKey;
  /**
   * İzin alanı öneki — `lib/adminAccess.ts`teki `adminAreaAccess`e aynen
   * geçer (`"products"` → `products.view`/`products.manage`). Yalnız gerçek
   * bir ekrana bağlı (`path` sahibi) öğelerde anlamlıdır.
   *
   * Bağlanmamış (yer tutucu, `path`siz) öğelere BİLİNÇLİ OLARAK verilmez:
   * henüz gerçek bir ekranları yok, dolayısıyla gösterilmeleri veri sızıntısı
   * DEĞİL — tıklanamaz, zaten `disabled`. Onlara bugünden var olmayan bir
   * izin kodu uydurmak (ör. "orders") gelecekte o modül gerçek izinle
   * bağlandığında burada sessizce unutulma riski taşır. Bağlandıkları anda
   * kendi `requiredPermission`'ları eklenmelidir.
   */
  requiredPermission?: string;
};

/**
 * `docs/ikas-panel-referans.md` §1 — ikas'ın 11 kök öğesi BİREBİR bu sırayla
 * ve bu adlarla, ardından bizim projemize özgü 6 modül (Dağıtım, Dersler,
 * Eğitmenler, Kütüphaneler, Moderasyon, Finans) kendi grubu olarak altına
 * eklenir (referans §5/1 ve görev metni: "onları ikas öğelerinin altına,
 * kendi grubu olarak ekle"). Karşılığı bugün var olan üç modül (Ürünler,
 * Siparişler, Müşteriler) gerçek yola + izne bağlanır; ikas'a özgü, bizde
 * karşılığı olmayanlar (Gelen Kutusu, Pazarlama, Uygulamalar, Satış
 * Kanalları) yolsuz yer tutucu kalır (referans §6).
 *
 * Kural: **ikas'ın öğeleri + bizim öğelerimiz = menü**, hiçbir yetenek
 * düşmez. Ürünler alt menüsünde de aynı kural: ikas'ta olup bizde olmayanlar
 * (Transferler, Fiyat Listesi, Ürün Barkod Etiketi) yer tutucu kalır;
 * bizde olup ikas'ta olmayanlar (Stok Hareketleri — append-only defter,
 * Hasarlı Stok) `docs/superpowers/specs/2026-09-11-admin-panel-ikas-yeniden-
 * tasarim-design.md` §4'teki onaylı yerlerinde durur (Stok Sayımı'ndan
 * sonra, Tanımlamalar'dan önce).
 */
export const PANEL_MENU: PanelMenuItem[] = [
  { key: "giris", label: "Giriş", path: PATHS.adminNew, icon: "home" },
  {
    key: "urunler",
    label: "Ürünler",
    icon: "shopping",
    children: [
      {
        key: "urun-listesi",
        label: "Ürünler",
        path: PATHS.adminNewProducts,
        requiredPermission: "products",
      },
      { key: "satin-alma", label: "Satın Alma" },
      { key: "transferler", label: "Transferler" },
      {
        key: "stok-sayimi",
        label: "Stok Sayımı",
        path: PATHS.adminNewStockCounts,
        requiredPermission: "inventory",
      },
      // Bize özgü (ikas'ta karşılığı yok) — spec §4'te onaylı, ikas'ın
      // Stok Sayımı öğesinden hemen sonra, Tanımlamalar'dan önce durur.
      { key: "stok-hareketleri", label: "Stok Hareketleri" },
      { key: "hasarli-stok", label: "Hasarlı Stok" },
      { key: "tanimlamalar", label: "Tanımlamalar" },
      { key: "fiyat-listesi", label: "Fiyat Listesi" },
      { key: "urun-barkod-etiketi", label: "Ürün Barkod Etiketi" },
    ],
  },
  {
    key: "siparisler",
    label: "Siparişler",
    path: PATHS.adminNewOrders,
    requiredPermission: "orders",
    icon: "container",
  },
  {
    key: "musteriler",
    label: "Müşteriler",
    path: PATHS.adminNewCustomers,
    // Eski panelin `adminNavigation.ts`teki "Kullanıcılar" girdisiyle AYNI
    // izin öneki (`users.view`/`users.manage`) — bkz. `AdminUsersPage.tsx`.
    requiredPermission: "users",
    icon: "team",
  },
  { key: "indirimler", label: "İndirimler", icon: "percentage" },
  { key: "gelen-kutusu", label: "Gelen Kutusu", icon: "inbox" },
  { key: "pazarlama", label: "Pazarlama", icon: "notification" },
  { key: "raporlar", label: "Raporlar", icon: "barchart" },
  { key: "uygulamalar", label: "Uygulamalar", icon: "appstore-add" },
  { key: "ayarlar", label: "Ayarlar", icon: "setting" },
  { key: "satis-kanallari", label: "Satış Kanalları", icon: "shop" },
  // ── Bizim projemize özgü modüller (ikas'ta karşılığı yok) ──
  { key: "dagitim", label: "Dağıtım", icon: "car" },
  { key: "dersler", label: "Dersler", icon: "read" },
  { key: "egitmenler", label: "Eğitmenler", icon: "solution" },
  { key: "kutuphaneler", label: "Kütüphaneler", icon: "book" },
  { key: "moderasyon", label: "Moderasyon", icon: "safety" },
  { key: "finans", label: "Finans", icon: "wallet" },
];

type MenuYapragi = {
  key: string;
  path: string;
  label: string;
  ebeveynAnahtarlari: string[];
  requiredPermission?: string;
};

/** `path` sahibi tüm yaprakları, üst (submenu) anahtar zinciriyle birlikte düzleştirir. */
function yapraklariDuzlestir(
  items: PanelMenuItem[],
  ebeveynAnahtarlari: string[] = [],
): MenuYapragi[] {
  return items.flatMap((m) => {
    const altEbeveynler = m.children ? [...ebeveynAnahtarlari, m.key] : ebeveynAnahtarlari;
    const kendisi: MenuYapragi[] = m.path
      ? [
          {
            key: m.key,
            path: m.path,
            label: m.label,
            ebeveynAnahtarlari,
            requiredPermission: m.requiredPermission,
          },
        ]
      : [];
    const cocuklar = m.children ? yapraklariDuzlestir(m.children, altEbeveynler) : [];
    return [...kendisi, ...cocuklar];
  });
}

/** `pathname`e en uzun (en özgül) eşleşen yaprağı bulur (kısa yol uzun yolu yemesin). */
function enOzgulEslesenYaprak(
  items: PanelMenuItem[],
  pathname: string,
): MenuYapragi | undefined {
  const yapraklar = yapraklariDuzlestir(items);
  const eslesenler = yapraklar.filter(
    (y) => pathname === y.path || pathname.startsWith(`${y.path}/`),
  );
  if (eslesenler.length === 0) return undefined;
  return eslesenler.reduce((a, b) => (b.path.length > a.path.length ? b : a));
}

/**
 * Verilen `pathname`'e en uzun (en özgül) eşleşen menü öğesini bulur.
 * `/yonetim-yeni` ile `/yonetim-yeni/urunler` gibi iç içe yolların
 * birbirini seçili göstermesini (kısa yol uzun yolu yemesini) önler.
 */
export function seciliMenuDurumu(
  items: PanelMenuItem[],
  pathname: string,
): { selectedKey?: string; openKeys: string[] } {
  const enOzgul = enOzgulEslesenYaprak(items, pathname);
  if (!enOzgul) return { openKeys: [] };
  return { selectedKey: enOzgul.key, openKeys: enOzgul.ebeveynAnahtarlari };
}

/**
 * `pathname`in bağlı olduğu menü yaprağının izin gereksinimini döndürür
 * (izin kapısı: içerik alanının Outlet mı, "yetkiniz yok" ekranı mı, yoksa
 * hiçbiri — yükleniyor durumu mu göstereceğine `PanelShell` burada karar verir).
 * Menüde HİÇ yer almayan bir yola denk gelinirse `undefined` döner (bugün
 * için kapsam dışı — `PANEL_MENU`de olmayan bir rota yok).
 */
export function rotaIzniBul(
  items: PanelMenuItem[],
  pathname: string,
): { label: string; requiredPermission?: string } | undefined {
  const enOzgul = enOzgulEslesenYaprak(items, pathname);
  if (!enOzgul) return undefined;
  return { label: enOzgul.label, requiredPermission: enOzgul.requiredPermission };
}

/**
 * Menü ağacını izne göre süzer: bağlı (path sahibi) bir öğenin izni yoksa
 * öğe menüden TAMAMEN düşer (disabled değil — hiç görünmez). Bağlanmamış
 * (path'siz) yer tutucular `requiredPermission` taşımaz, dolayısıyla her
 * zaman kalır (bkz. `PanelMenuItem.requiredPermission` yorumu). Tüm alt
 * öğeleri süzülen bir grup da (kendi path'i yoksa) elenir.
 */
export function menuyuIzneGoreSuz(
  items: PanelMenuItem[],
  permissions: string[] | undefined,
): PanelMenuItem[] {
  return items.reduce<PanelMenuItem[]>((acc, item) => {
    if (item.requiredPermission && !adminAreaAccess(permissions, item.requiredPermission).canView) {
      return acc;
    }
    if (!item.children) {
      acc.push(item);
      return acc;
    }
    const children = menuyuIzneGoreSuz(item.children, permissions);
    if (children.length === 0 && !item.path) return acc;
    acc.push({ ...item, children });
    return acc;
  }, []);
}
