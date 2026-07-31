/**
 * Kütüphane olanak ikonları — tree-shakeable Tabler bileşenleri.
 *
 * Önceden ikonlar `index.html`'de bir CDN webfont'undan geliyordu:
 *   <link href="https://cdn.jsdelivr.net/npm/@tabler/icons@latest/...">
 * Üç sorunu vardı: (1) 150 KB render-blocking CSS + ayrı font indirmesi,
 * (2) `@latest` — pinlenmemiş üçüncü taraf, SRI yok (paket ele geçirilirse her
 * sayfada keyfi CSS), (3) ayrı origin → ek DNS+TLS.
 *
 * Webfont'un npm sürümü de çözüm değildi: tüm ikon seti 205 KB CSS. Burada
 * yalnız KULLANILAN ikonlar import edilir; Rollup gerisini eler.
 */
import {
  IconAccessible,
  IconArmchair,
  IconBooks,
  IconCar,
  IconClock,
  IconCoffee,
  IconPlug,
  IconPrinter,
  IconSnowflake,
  IconToolsKitchen2,
  IconUsers,
  IconVolumeOff,
  IconWifi,
  type IconProps,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

export type AmenityIcon = ComponentType<IconProps>;

const AMENITY_ICONS: Record<string, AmenityIcon> = {
  wifi: IconWifi,
  sessiz_alan: IconVolumeOff,
  grup_calisma: IconUsers,
  bireysel_kabin: IconArmchair,
  kafeterya: IconCoffee,
  otopark: IconCar,
  priz: IconPlug,
  klima: IconSnowflake,
  yemekhane: IconToolsKitchen2,
  kutuphane: IconBooks,
  "7_24": IconClock,
  fotokopi: IconPrinter,
  erisilebilir: IconAccessible,
};

/** Slug için ikon bileşeni; bilinmeyen olanakta kitaplık ikonuna düşer. */
export function amenityIcon(slug: string): AmenityIcon {
  return AMENITY_ICONS[slug] ?? IconBooks;
}

/** Bir olanağın özel ikonu var mı (test/denetim için). */
export function hasAmenityIcon(slug: string): boolean {
  return slug in AMENITY_ICONS;
}
