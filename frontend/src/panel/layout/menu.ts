import { adminAreaAccess } from "@/lib/adminAccess";
import { PATHS } from "@/lib/routes";

export type PanelMenuItem = {
  key: string;
  label: string;
  path?: string;
  children?: PanelMenuItem[];
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

export const PANEL_MENU: PanelMenuItem[] = [
  { key: "giris", label: "Giriş", path: PATHS.adminNew },
  {
    key: "urunler",
    label: "Ürünler",
    children: [
      {
        key: "urun-listesi",
        label: "Ürünler",
        path: PATHS.adminNewProducts,
        requiredPermission: "products",
      },
      { key: "satin-alma", label: "Satın Alma" },
      { key: "stok-sayimi", label: "Stok Sayımı" },
      { key: "stok-hareketleri", label: "Stok Hareketleri" },
      { key: "hasarli-stok", label: "Hasarlı Stok" },
      { key: "tanimlamalar", label: "Tanımlamalar" },
    ],
  },
  {
    key: "siparisler",
    label: "Siparişler",
    path: PATHS.adminNewOrders,
    requiredPermission: "orders",
  },
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
