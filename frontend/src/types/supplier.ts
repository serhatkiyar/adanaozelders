/**
 * Tedarikçi senkronu (Yıldırım B2B) — `backend/schemas/supplier.py` karşılığı.
 *
 * ## D-5: token TİPTE DE YOKTUR
 *
 * `SupplierOut` bir `api_token` alanı taşımaz; panel token'ın **varlığını**
 * (`has_token`) ve **vadesini** (`token_expires_at`) bilir, değerini asla
 * görmez. Alanı tipe eklemek, "bir gün sunucu döndürürse ekrana basalım"
 * kapısını açmak olurdu — sızıntının en ucuz hâli.
 *
 * ## D-6: maliyet YALNIZ admin yüzeyinde
 *
 * `ProductSupplierOut` public `ProductSearchOut` yanıtlarında **null**dur.
 * Tipte `| null` olması bu sözleşmenin istemci tarafındaki hatırlatıcısıdır:
 * maliyet gösteren her yer önce null kontrolü yapmak zorunda kalır.
 *
 * ## Para ve stok DİZGİDİR
 *
 * `Decimal` JSON'da `number`a çevrilirse kuruş hatası üretir. Sunucu bu
 * alanları dizgi olarak döndürür (`stock_qty: "12.500"`), istemci de dizgi
 * olarak taşır; biçimlendirme `lib/money`de yapılır.
 */

/** Elle senkronun kapsamı (`SyncIn.scope`). */
export type SyncScope = "stock" | "price" | "both";

/** Bağın nasıl kurulduğu: barkod eşleşmesi mi, yönetici kararı mı. */
export type SupplierLinkSource = "AUTO" | "MANUAL";

/** Ürünün vitrindeki karşılanma yolu (`ProductSearchOut.fulfillment`). */
export type ProductFulfillment = "OWN" | "SUPPLIER" | "NONE" | "DIGITAL";

/** Panelin gördüğü tedarikçi durumu. */
export interface SupplierOut {
  id: number;
  provider: string;
  name: string;
  is_enabled: boolean;
  base_url: string;
  /** Token'ın DEĞERİ değil, VARLIĞI. */
  has_token: boolean;
  token_expires_at?: string | null;

  stock_interval_seconds: number;
  price_interval_seconds: number;
  next_stock_sync_at?: string | null;
  next_price_sync_at?: string | null;

  last_stock_sync_ok_at?: string | null;
  last_price_sync_ok_at?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
  consecutive_failures: number;
  cooldown_until?: string | null;
  last_sync_stats?: Record<string, unknown> | null;

  linked_count: number;
  unmatched_count: number;
}

/**
 * Kısmi ayar güncellemesi + ZORUNLU gerekçe.
 *
 * Alanların hepsi opsiyoneldir (`exclude_unset`); `reason` değildir çünkü
 * kayıt `audit_logs`'a düşer ve gerekçesiz denetim kaydı yalnız bir zaman
 * damgasıdır (D-10).
 */
export interface SupplierSettingsIn {
  is_enabled?: boolean;
  name?: string;
  /** Alt sınır 30 sn (`MIN_STOCK_INTERVAL_SECONDS`). */
  stock_interval_seconds?: number;
  /** Alt sınır 3600 sn (`MIN_PRICE_INTERVAL_SECONDS`). */
  price_interval_seconds?: number;
  /** Gönderilmezse MEVCUT token korunur; boş kutu HİÇ gönderilmez. */
  api_token?: string;
  reason: string;
}

export interface SyncReportOut {
  scope: string;
  favorites: number;
  new: number;
  updated: number;
  unfavorited: number;
  auto_linked: number;
  priced: number;
  notified: number;
}

/** Bağlı ürünün panelde gösterilen özeti. */
export interface LinkedProductBrief {
  id: number;
  title: string;
  sku?: string | null;
  price: string;
  stock?: number | null;
  supplier_backed: boolean;
}

/** Tedarikçi kataloğundaki tek satır (YÖNETİM yüzeyi). */
export interface SupplierProductOut {
  id: number;
  external_id: number;
  external_code: string;
  name: string;
  brand?: string | null;
  category_path?: string | null;
  barcode?: string | null;
  barcode_valid: boolean;

  /** Birim adı OLMADAN stok sayısı yanıltıcıdır: "12,5" düzine 150 defterdir. */
  unit_name?: string | null;
  /** DİZGİ — kesirli olabilir (ölçümde 12.5). */
  stock_qty: string;
  stockless: boolean;

  list_price?: string | null;
  cost_net?: string | null;
  cost_gross?: string | null;
  cost_breakdown_name?: string | null;
  /** ORAN (0.20), yüzde değil — `Product.tax_rate` ile aynı birim. */
  vat_rate?: string | number | null;
  currency_ok: boolean;
  campaign: boolean;
  quarantine_flags: string[];
  image_url?: string | null;

  product_id?: number | null;
  product?: LinkedProductBrief | null;
  link_source?: SupplierLinkSource | null;
  linked_at?: string | null;

  is_favorite: boolean;
  unfavorited_at?: string | null;
  stock_synced_at?: string | null;
  price_synced_at?: string | null;
}

/**
 * Ürün listesinde gösterilen tedarikçi özeti — **YALNIZ ADMIN** (D-6).
 *
 * Public yanıtta bu blok `null`dur: maliyet ve marj ticari sırdır.
 */
export interface ProductSupplierOut {
  supplier_product_id: number;
  external_code: string;
  unit_name?: string | null;
  stock_qty: string;
  cost_net?: string | null;
  cost_gross?: string | null;
  margin_absolute?: string | null;
  margin_percent?: string | null;
  below_cost: boolean;
  link_source?: SupplierLinkSource | null;
  is_favorite: boolean;
  quarantine_flags: string[];
  stock_synced_at?: string | null;
  price_synced_at?: string | null;
}

export interface SupplierLinkIn {
  product_id: number;
  reason: string;
}

export interface SupplierUnlinkIn {
  reason: string;
}

/**
 * Karantina bayraklarının Türkçe karşılıkları (sözleşme §4).
 *
 * Bilinmeyen bayrak HAM basılır: sessizce gizlemek, sunucuya yeni bir bayrak
 * eklendiğinde yöneticinin uyarıyı hiç görmemesi demektir.
 */
export const KARANTINA_ETIKETLERI: Record<string, string> = {
  KIRILIM_YOK: "Fiyat kırılımı yok",
  SIFIR_FIYAT: "Fiyat sıfır",
  DOVIZ_TL_DEGIL: "Para birimi TL değil",
  KDV_SIFIR_SUPHELI: "KDV sıfır (şüpheli)",
  NET_TABANDAN_YUKSEK: "Net, tabandan yüksek",
  BARKOD_BOZUK: "Barkod geçersiz",
  BARKOD_YOK: "Barkod yok",
  BIRIM_ADET_DEGIL: "Birim adet değil",
  GORSEL_YOK: "Görsel yok",
  COKLU_ESLESME: "Birden çok ürünle eşleşti",
  URUN_ZATEN_BAGLI: "Ürün başka satıra bağlı",
  FAVORI_DISI: "Favoriden çıkarılmış",
};

/** Bayrağın insan diline çevrilmiş hâli; bilinmiyorsa ham kod. */
export function karantinaEtiketi(kod: string): string {
  return KARANTINA_ETIKETLERI[kod] ?? kod;
}
