/**
 * Harita döşeme (tile) sağlayıcısı — TEK KAYNAK.
 *
 * Neden soyutlandı: döşeme adresi altı ayrı bileşende gömülüydü ve üçü ürünün
 * kritik yüzeyleri (kütüphane haritası, checkout adres pin'i, canlı kurye
 * takibi). `tile.openstreetmap.org` OSMF kullanım politikası gereği ticari
 * kullanıma kapalıdır; engellendiği gün bu üç yüzey **aynı anda** çöker.
 * Sağlayıcı kararı (Protomaps self-host / MapTiler) verilmemiş olsa da, adresi
 * env'e bağlamak geçişi altı dosyalık bir değişiklikten tek satıra indirir —
 * `core/payments`, `core/mail`, `core/routing` ile aynı desen.
 *
 * Geçiş yapılırken yalnız `.env` doldurulur:
 *   VITE_MAP_TILE_URL=https://tiles.ornek.com/{z}/{x}/{y}.png
 *   VITE_MAP_TILE_ATTRIBUTION=&copy; Örnek
 */

export type MapLayer = "street" | "satellite";

export interface TileSource {
  url: string;
  attribution: string;
  maxZoom?: number;
}

const OSM: TileSource = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

/**
 * Uydu görünümü: Esri World Imagery.
 *
 * Eskiden `MapPicker` burada Google'ın resmî OLMAYAN uç noktasını
 * (`http://mt0.google.com/vt/...`) kullanıyordu. İki ayrı sebeple kaldırıldı:
 * kullanım koşullarına aykırı olması bir yana, adres **http://** idi — HTTPS
 * sayfada karışık içerik (mixed content) sayılıp tarayıcıda engellenir, ayrıca
 * CSP'deki `img-src https:` kuralına da takılırdı. Yani üretimde uydu katmanı
 * hiç çalışmayacaktı ve hata sessiz olurdu (boş gri harita).
 */
const SATELLITE: TileSource = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles &copy; Esri. Source: Esri, Maxar, Earthstar Geographics",
  maxZoom: 19,
};

const streetOverride = import.meta.env.VITE_MAP_TILE_URL as string | undefined;
const streetAttribution = import.meta.env.VITE_MAP_TILE_ATTRIBUTION as
  | string
  | undefined;

export const TILE_SOURCES: Record<MapLayer, TileSource> = {
  street: streetOverride
    ? { url: streetOverride, attribution: streetAttribution ?? "" }
    : OSM,
  satellite: SATELLITE,
};

/** Katman için döşeme kaynağı (varsayılan: sokak haritası). */
export function tileSource(layer: MapLayer = "street"): TileSource {
  return TILE_SOURCES[layer];
}
