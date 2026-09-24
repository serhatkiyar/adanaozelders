/**
 * Kütüphane olanak ikonları — uygulama ikon setinden (Fluent UI System Icons,
 * `components/AppIcon`) ad olarak döner.
 *
 * Tarihçe: önce CDN'den Tabler webfont'u, sonra tree-shakeable Tabler
 * bileşenleri kullanılıyordu. 23 Eyl 2026'da uygulama tek ikon setine (Fluent)
 * geçti; iki setin yan yana yaşaması kullanıcı kararıyla kaldırıldı.
 */
import type { IconName } from "@/components/AppIcon";

const AMENITY_ICONS: Record<string, IconName> = {
  wifi: "wifi",
  sessiz_alan: "speakerMute",
  grup_calisma: "people",
  bireysel_kabin: "couch",
  kafeterya: "drinkCoffee",
  otopark: "vehicleCar",
  priz: "plugConnected",
  klima: "snowflake",
  yemekhane: "food",
  kutuphane: "libraryBooks",
  "7_24": "clock",
  fotokopi: "print",
  erisilebilir: "accessibility",
};

/** Slug için ikon adı; bilinmeyen olanakta kitaplık ikonuna düşer. */
export function amenityIcon(slug: string): IconName {
  return AMENITY_ICONS[slug] ?? "libraryBooks";
}

/** Bir olanağın özel ikonu var mı (test/denetim için). */
export function hasAmenityIcon(slug: string): boolean {
  return slug in AMENITY_ICONS;
}
