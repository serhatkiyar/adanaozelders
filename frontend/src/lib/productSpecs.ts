import type { BookSpecFields, ProductAttributeChip } from "@/types";

/**
 * Ürün künyesini "Ürün Özellikleri" tablosuna çevirir. Yalnız **dolu** alanlar
 * döner (boş satır gösterilmez). Saf mantık → Vitest'li.
 *
 * ## NEDEN GRUPLU
 *
 * Ölçümlerde künye tablolarının dörtte biri hiç gruplanmıyor ve sonuç bir
 * "özellik duvarı" oluyor: kullanıcı aradığı satırı bulamıyor. Alt başlıklı
 * bölümler taramayı kurtaran tek düzenleme.
 *
 * ## SIRALAMA
 *
 * Gruplar "kimlik → doğrulama" yönünde: satın alma kararını veren alanlar
 * (yazar, yayınevi) üstte; sicil bilgisi (ISBN) altta. Kullanıcı ISBN'i satın
 * almadan önce nadiren okur ama BULUNMADIĞINDA güven düşer.
 */
export type SpecGroupKey = "eser" | "basim" | "fizik" | "ozellik" | "kimlik";

export interface SpecRow {
  key: string;
  label: string;
  value: string;
}

export interface SpecGroup {
  key: SpecGroupKey;
  title: string;
  rows: SpecRow[];
}

const GRUP_BASLIKLARI: Record<SpecGroupKey, string> = {
  eser: "Eser",
  basim: "Basım",
  fizik: "Fiziksel özellikler",
  ozellik: "Özellikler",
  kimlik: "Kimlik",
};

const SPEC_ORDER: {
  key: keyof BookSpecFields;
  label: string;
  group: SpecGroupKey;
}[] = [
  { key: "author", label: "Yazar", group: "eser" },
  { key: "publisher", label: "Yayınevi", group: "eser" },
  { key: "language", label: "Dil", group: "eser" },
  { key: "publication_year", label: "Basım yılı", group: "basim" },
  { key: "edition", label: "Baskı", group: "basim" },
  { key: "page_count", label: "Sayfa sayısı", group: "basim" },
  { key: "dimensions", label: "Ebat", group: "fizik" },
  { key: "cover_type", label: "Kapak tipi", group: "fizik" },
  // ISBN ile BARKOD bu kod tabanında bilinçli olarak AYRI kimliklerdir
  // (`models/store.py`: ISBN barkoda asla kopyalanmaz). Etiketi "ISBN / Barkod"
  // yazmak, depo ve kasa tarafında ayrı tutulan iki numarayı vitrinde
  // birmiş gibi gösteriyordu.
  { key: "isbn", label: "ISBN", group: "kimlik" },
];

/** Düz satır listesi (sıra korunur) — kompakt "öne çıkan künye" bunu kullanır. */
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

/**
 * Gruplanmış künye — tam tablo bunu kullanır.
 *
 * ``attributes`` yönetilen ürün nitelikleridir ("Kağıt Cinsi: 80 gr"). Bunlar
 * uzun süredir yönetimden GİRİLEBİLİYORDU ama vitrine hiç çıkmıyordu:
 * kırtasiye ürününde künye tablosu yalnız kitap alanlarından besleniyor ve
 * bomboş kalıyordu.
 */
export function buildSpecGroups(
  product: BookSpecFields,
  attributes: ProductAttributeChip[] = []
): SpecGroup[] {
  const satirlar = buildSpecRows(product);
  const grupSirasi: SpecGroupKey[] = ["eser", "basim", "fizik", "ozellik", "kimlik"];
  const grupOf = new Map(SPEC_ORDER.map((s) => [s.key as string, s.group]));

  const gruplar: SpecGroup[] = [];
  for (const key of grupSirasi) {
    const rows =
      key === "ozellik"
        ? attributes.map((a) => ({
            key: `attr-${a.definition_name}-${a.label}`,
            label: a.definition_name,
            value: a.label,
          }))
        : satirlar.filter((r) => grupOf.get(r.key) === key);
    if (rows.length) {
      gruplar.push({ key, title: GRUP_BASLIKLARI[key], rows });
    }
  }
  return gruplar;
}

export function hasSpecs(product: BookSpecFields): boolean {
  return buildSpecRows(product).length > 0;
}
