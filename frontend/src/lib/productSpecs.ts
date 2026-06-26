import type { BookSpecFields } from "@/types";

/**
 * Kitap künyesini ürün detayındaki "Ürün Özellikleri" tablosuna çevirir.
 * Yalnız **dolu** alanları, D&R/Kitapseç künye düzenindeki sırayla döndürür
 * (lib/amenities.ts AMENITY_LABELS deseninin kardeşi). Saf mantık → Vitest'li.
 */
export interface SpecRow {
  key: keyof BookSpecFields;
  label: string;
  value: string;
}

const SPEC_ORDER: { key: keyof BookSpecFields; label: string }[] = [
  { key: "author", label: "Yazar" },
  { key: "publisher", label: "Yayınevi" },
  { key: "isbn", label: "ISBN / Barkod" },
  { key: "page_count", label: "Sayfa sayısı" },
  { key: "dimensions", label: "Ebat" },
  { key: "publication_year", label: "Basım yılı" },
  { key: "edition", label: "Baskı" },
  { key: "language", label: "Dil" },
  { key: "cover_type", label: "Kapak tipi" },
];

export function buildSpecRows(product: BookSpecFields): SpecRow[] {
  const rows: SpecRow[] = [];
  for (const { key, label } of SPEC_ORDER) {
    const raw = product[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (value === "") continue;
    rows.push({ key, label, value });
  }
  return rows;
}

export function hasSpecs(product: BookSpecFields): boolean {
  return buildSpecRows(product).length > 0;
}
