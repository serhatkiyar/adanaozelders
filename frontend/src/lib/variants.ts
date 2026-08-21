/** Varyant yardımcıları (saf — Vitest'li).
 *
 * Kitap tespiti backend kuralının aynasıdır (`variant_service.is_book_category`):
 * kategori ata zincirinde `book_root_slugs`'tan biri varsa üründe varyant
 * kapalıdır. Slug sözlüğü İSTEMCİDE SABİT TUTULMAZ — `/store/admin/variant-config`
 * verir; buradaki fonksiyonlar yalnız zinciri yürütür.
 */

export interface KategoriDugumu {
  id: number;
  parent_id?: number | null;
  slug: string;
}

/** Kategorinin ata zinciri (kendisi dahil), yapraktan köke. Döngü korumalı. */
export function categoryChain(
  categories: KategoriDugumu[],
  categoryId: number | null | undefined
): KategoriDugumu[] {
  if (categoryId == null) return [];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const chain: KategoriDugumu[] = [];
  const seen = new Set<number>();
  let node = byId.get(categoryId);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    chain.push(node);
    node = node.parent_id != null ? byId.get(node.parent_id) : undefined;
  }
  return chain;
}

/** Zincirde kitap kökü var mı? (Kategorisiz ürün kitap sayılmaz.) */
export function isBookCategory(
  categories: KategoriDugumu[],
  categoryId: number | null | undefined,
  bookRootSlugs: readonly string[]
): boolean {
  const set = new Set(bookRootSlugs);
  return categoryChain(categories, categoryId).some((c) => set.has(c.slug));
}

/** Türetilen varyantın önerilen başlığı ("Grup Adı - Sarı / A4"). */
export function suggestedVariantTitle(
  groupTitle: string,
  option1Value: string,
  option2Value?: string | null
): string {
  const degerler = [option1Value, option2Value].filter(Boolean).join(" / ");
  return degerler ? `${groupTitle} - ${degerler}` : groupTitle;
}
