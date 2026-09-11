import { PATHS } from "@/lib/routes";

export type PanelMenuItem = {
  key: string;
  label: string;
  path?: string;
  children?: PanelMenuItem[];
};

export const PANEL_MENU: PanelMenuItem[] = [
  { key: "giris", label: "Giriş", path: PATHS.adminNew },
  {
    key: "urunler",
    label: "Ürünler",
    children: [
      { key: "urun-listesi", label: "Ürünler", path: PATHS.adminNewProducts },
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

type MenuYapragi = { key: string; path: string; ebeveynAnahtarlari: string[] };

/** `path` sahibi tüm yaprakları, üst (submenu) anahtar zinciriyle birlikte düzleştirir. */
function yapraklariDuzlestir(
  items: PanelMenuItem[],
  ebeveynAnahtarlari: string[] = [],
): MenuYapragi[] {
  return items.flatMap((m) => {
    const altEbeveynler = m.children ? [...ebeveynAnahtarlari, m.key] : ebeveynAnahtarlari;
    const kendisi: MenuYapragi[] = m.path ? [{ key: m.key, path: m.path, ebeveynAnahtarlari }] : [];
    const cocuklar = m.children ? yapraklariDuzlestir(m.children, altEbeveynler) : [];
    return [...kendisi, ...cocuklar];
  });
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
  const yapraklar = yapraklariDuzlestir(items);
  const eslesenler = yapraklar.filter(
    (y) => pathname === y.path || pathname.startsWith(`${y.path}/`),
  );
  if (eslesenler.length === 0) return { openKeys: [] };
  const enOzgul = eslesenler.reduce((a, b) => (b.path.length > a.path.length ? b : a));
  return { selectedKey: enOzgul.key, openKeys: enOzgul.ebeveynAnahtarlari };
}
