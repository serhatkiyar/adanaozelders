import type { NavItem } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";

// İki bağımsız yüzey:
//  - "navbar":  sayfanın tepesindeki ikon kısayolları
//  - "sidebar": profil fotoğrafına tıklayınca açılan yan menü
// Her kısayol her iki yüzeyde ayrı ayrı gösterilip gizlenebilir ve sıralanabilir.
export type NavSurface = "navbar" | "sidebar";

// Üst barda VARSAYILAN olarak gizli başlayan rotalar (üst barı sade tutar).
// Bunlar yan menüde varsayılan olarak görünür kalır.
const DEFAULT_NAVBAR_HIDDEN = new Set<string>([
  ROUTES.questions,
  ROUTES.exams,
  ROUTES.calendar,
]);

/** Kullanıcı tercihi yoksa bir öğenin ilgili yüzeydeki varsayılan görünürlüğü. */
export function defaultVisible(surface: NavSurface, item: NavItem): boolean {
  if (surface === "navbar") return !DEFAULT_NAVBAR_HIDDEN.has(item.to);
  return true; // yan menüde her şey varsayılan görünür
}

export interface SurfacePrefs {
  /** `to` (rota) sırası — kullanıcının düzenlediği sıra. */
  order: string[];
  /** `to` -> görünür mü? (yalnız varsayılandan sapanlar tutulur). */
  visible: Record<string, boolean>;
}

export interface RoleNavPrefs {
  navbar: SurfacePrefs;
  sidebar: SurfacePrefs;
}

export interface ResolvedNavItem extends NavItem {
  visible: boolean;
}

/**
 * Koddaki kanonik nav listesini bir yüzeyin kullanıcı tercihleriyle birleştirir.
 * - Sıra: önce kayıtlı sıradakiler (order), kalanlar kanonik sırada eklenir
 *   (kodda yeni eklenen öğeler tercih sıfırlanmadan da görünür).
 * - Görünürlük: tercih varsa o, yoksa defaultVisible.
 * Saf fonksiyon — store'dan bağımsız, test edilebilir.
 */
export function resolveSurface(
  canonical: NavItem[],
  prefs: SurfacePrefs | undefined,
  surface: NavSurface
): ResolvedNavItem[] {
  const order = prefs?.order ?? [];
  const visible = prefs?.visible ?? {};

  const orderIndex = (to: string) => {
    const i = order.indexOf(to);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  const sorted = [...canonical].sort((a, b) => {
    const ia = orderIndex(a.to);
    const ib = orderIndex(b.to);
    if (ia !== ib) return ia - ib;
    return canonical.indexOf(a) - canonical.indexOf(b);
  });

  return sorted.map((item) => ({
    ...item,
    visible: visible[item.to] ?? defaultVisible(surface, item),
  }));
}
