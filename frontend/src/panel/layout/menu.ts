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
