import type { AdminProductQuery } from "@/api/store";

/**
 * Yönetim ürün listesinin URL durumu.
 *
 * Desen `parseAdminUserQuery`'nin aynısıdır ve bilinçli olarak kopyalanmaz,
 * TEKRARLANIR: iki listenin parametre adları farklı (`stok`/`yayinevi` vs
 * `role`/`active`) ve tek bir genel çözümleyici, beyaz listenin sağladığı
 * "bilinmeyen değer sessizce düşer" güvencesini kaybettirirdi.
 *
 * Ayrım: **veri seçimi URL'de** yaşar (filtre, arama, sayfa, sıralama) —
 * böylece filtreli liste linki paylaşılabilir, geri tuşu çalışır, sayfa
 * yenilendiğinde seçim korunur. Kişisel tercih (kolon görünürlüğü gibi)
 * ileride kalıcı depoya gidebilir; o ayrım korunmalı.
 */

/** Stok kovaları. `kritik` = `tukendi` + `azalan` (dashboard kartının kümesi). */
export const STOK_FILTRELERI = ["tukendi", "azalan", "var", "kritik"] as const;
export type StokFiltresi = (typeof STOK_FILTRELERI)[number];

export const URUN_SIRALARI = ["title", "price", "stock", "created_at"] as const;
export type UrunSirasi = (typeof URUN_SIRALARI)[number];

export type SiraYonu = "asc" | "desc";

const SAYFA_BOYUTLARI = [10, 25, 50];

export interface UrunSorguDurumu {
  page: number;
  pageSize: number;
  q: string;
  stok?: StokFiltresi;
  yayinevi: string;
  yazar: string;
  sort: UrunSirasi;
  order: SiraYonu;
}

function pozitifTamsayi(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseUrunSorgusu(params: URLSearchParams): UrunSorguDurumu {
  const hamStok = params.get("stok") as StokFiltresi | null;
  const hamSort = params.get("sirala") as UrunSirasi | null;
  const hamBoyut = pozitifTamsayi(params.get("limit"), 25);

  return {
    page: pozitifTamsayi(params.get("sayfa"), 1),
    pageSize: SAYFA_BOYUTLARI.includes(hamBoyut) ? hamBoyut : 25,
    // Sorgu uzunluğu sunucudaki `max_length=200` ile hizalı: istemci daha
    // uzununu göndermeye çalışırsa 422 alırdı.
    q: (params.get("q") ?? "").slice(0, 200),
    stok:
      hamStok && (STOK_FILTRELERI as readonly string[]).includes(hamStok)
        ? hamStok
        : undefined,
    yayinevi: (params.get("yayinevi") ?? "").slice(0, 200),
    yazar: (params.get("yazar") ?? "").slice(0, 200),
    sort:
      hamSort && (URUN_SIRALARI as readonly string[]).includes(hamSort)
        ? hamSort
        : "created_at",
    order: params.get("yon") === "asc" ? "asc" : "desc",
  };
}

/** URL durumunu sunucu parametrelerine çevirir (adlar burada eşlenir). */
export function urunSorgusundanIstek(durum: UrunSorguDurumu): AdminProductQuery {
  return {
    q: durum.q || undefined,
    stok: durum.stok,
    publisher: durum.yayinevi || undefined,
    author: durum.yazar || undefined,
    sort: durum.sort,
    order: durum.order,
    limit: durum.pageSize,
    offset: (durum.page - 1) * durum.pageSize,
  };
}

/** Listeyi daraltan bir seçim var mı? "kayıt yok" ile "sonuç yok" ayrımı buna bakar. */
export function filtreVarMi(durum: UrunSorguDurumu): boolean {
  return Boolean(durum.q || durum.stok || durum.yayinevi || durum.yazar);
}
