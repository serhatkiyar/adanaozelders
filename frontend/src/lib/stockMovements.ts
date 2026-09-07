// Stok hareket defteri — sunum tarafı saf mantık.
//
// Kurallar üç yerde kullanılıyor: ürün detayındaki "Stok hareketleri" bölümü,
// genel envanter hareketleri tablosu ve gerekçeli stok düzenleme formu. Tek
// yerde tutmak, üçünün zamanla ayrışmasını engeller (`orderItems.ts` ile aynı
// gerekçe).

export type StockMovementType =
  | "OPENING_BALANCE"
  | "INITIAL"
  | "SALE"
  | "SALE_CANCEL"
  | "RETURN"
  | "ADMIN_ADJUSTMENT"
  // F29: sayim ve hasarli stok hareketleri (backend `StockMovementType`).
  | "COUNT_ADJUSTMENT"
  | "DAMAGE_TRANSFER"
  | "DAMAGE_RECOVERY"
  | "DAMAGE_DISPOSAL"
  | "SUPPLIER_RETURN";

export type AdminReasonCode =
  | "SAYIM_FARKI"
  | "HASAR"
  | "KAYIP"
  | "HATALI_GIRIS"
  | "TEDARIK"
  | "DIGER";

/** Backend beyaz listesiyle BİREBİR aynı sıra ve içerik.
 *  Ayrışırsa kullanıcı seçtiği gerekçeyle 400 alır. */
export const ADMIN_REASON_OPTIONS: { value: AdminReasonCode; label: string }[] = [
  { value: "SAYIM_FARKI", label: "Sayım farkı" },
  { value: "HASAR", label: "Hasar" },
  { value: "KAYIP", label: "Kayıp" },
  { value: "HATALI_GIRIS", label: "Hatalı giriş" },
  { value: "TEDARIK", label: "Tedarik / mal kabul" },
  { value: "DIGER", label: "Diğer" },
];

const TYPE_LABELS: Record<StockMovementType, string> = {
  OPENING_BALANCE: "Açılış bakiyesi",
  INITIAL: "İlk stok",
  SALE: "Satış",
  SALE_CANCEL: "İptal / iade geri yükleme",
  RETURN: "Kısmi iade",
  ADMIN_ADJUSTMENT: "Yönetici düzeltmesi",
  COUNT_ADJUSTMENT: "Sayım düzeltmesi",
  DAMAGE_TRANSFER: "Hasara ayrıldı",
  DAMAGE_RECOVERY: "Hasardan kurtarıldı",
  DAMAGE_DISPOSAL: "İmha edildi",
  SUPPLIER_RETURN: "Tedarikçiye iade edildi",
};

const REASON_LABELS: Record<string, string> = {
  MIGRATION_OPENING: "Defter devreye alındı",
  PRODUCT_CREATE: "Ürün oluşturuldu",
  CSV_IMPORT: "CSV içe aktarma",
  ORDER_PAID: "Sipariş ödendi",
  ORDER_CANCELLED: "Sipariş iptal edildi",
  ORDER_REFUNDED: "Sipariş iade edildi",
  RETURN_ACCEPTED: "İade kabul edildi",
  // F29 gerekçe kodları (sayım yönü + hasar nedeni).
  SAYIM_FAZLA: "Sayımda fazla çıktı",
  SAYIM_EKSIK: "Sayımda eksik çıktı",
  KIRIK: "Kırık",
  ISLAK: "Islak / nem",
  BASKI_HATASI: "Baskı hatası",
  MUSTERI_IADESI_HASARLI: "Müşteri iadesi: hasarlı geldi",
  ...Object.fromEntries(ADMIN_REASON_OPTIONS.map((o) => [o.value, o.label])),
};

/** Delta gösterimi. Eksi işareti TEK kaynaktan (U+2212 — tire değil, hizalanır). */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return "0";
}

export function movementTypeLabel(type: StockMovementType): string {
  // Sunucu yeni bir tür eklerse ekran ham enum ya da "undefined" yazmamalı.
  return TYPE_LABELS[type] ?? "Bilinmeyen hareket";
}

export function reasonLabel(code: string): string {
  if (!code) return "Gerekçe kayıtlı değil";
  return REASON_LABELS[code] ?? code;
}

export function requiresNote(reason: AdminReasonCode | null): boolean {
  return reason === "DIGER";
}

export interface StockEditInput {
  current: number;
  next: number;
  reason: AdminReasonCode | null;
  note: string | null;
}

export interface StockEditResult {
  ok: boolean;
  /** `false` ise sunucuya `stock` alanı HİÇ gönderilmez (no-op). */
  submitStock: boolean;
  error?: string;
  payload?: { stock: number; stock_reason_code: string; stock_note: string | null };
}

/**
 * Stok düzenleme formunun doğrulaması.
 *
 * İstemci **hedefi** gönderir, delta değil: delta sunucuda ürün satırı kilitli
 * iken hesaplanır. İki istemci aynı deltayı gönderseydi hangisinin hangi tabana
 * uygulandığı belirsiz kalırdı.
 */
export function validateStockEdit(input: StockEditInput): StockEditResult {
  const { current, next, reason, note } = input;

  if (next === current) {
    // Aynı hedefin tekrarı bir "işlem" değildir: sunucu sıfır delta üretir ve
    // hareket yazmaz. Gerekçe istemek kullanıcıyı boşa zorlamak olurdu.
    return { ok: true, submitStock: false };
  }
  if (!Number.isInteger(next) || next < 0) {
    return {
      ok: false,
      submitStock: false,
      error: "Stok negatif olamaz.",
    };
  }
  if (!reason) {
    return {
      ok: false,
      submitStock: false,
      error: "Gerekçe seçmeden stok değiştirilemez.",
    };
  }
  if (!ADMIN_REASON_OPTIONS.some((o) => o.value === reason)) {
    return { ok: false, submitStock: false, error: "Geçersiz gerekçe." };
  }
  if (requiresNote(reason) && !(note ?? "").trim()) {
    return {
      ok: false,
      submitStock: false,
      error: "“Diğer” gerekçesinde açıklama zorunlu.",
    };
  }
  return {
    ok: true,
    submitStock: true,
    payload: {
      stock: next,
      stock_reason_code: reason,
      stock_note: requiresNote(reason) ? (note ?? "").trim() : null,
    },
  };
}

export interface VerificationLike {
  consistent: boolean;
  current_stock: number | null;
  ledger_stock: number | null;
  first_divergent_id: number | null;
}

export interface ConsistencyBadge {
  tone: "neutral" | "warning";
  label: string;
}

/**
 * Defter tutarlılık rozeti.
 *
 * `null` (doğrulama yüklenemedi) SESSİZ geçilmez: "tutarlı" ile "bilinmiyor"
 * karıştırılırsa operatör olmayan bir güvenceye dayanır.
 */
export function consistencyBadge(v: VerificationLike | null): ConsistencyBadge {
  if (!v) {
    return { tone: "warning", label: "Defter durumu bilinmiyor" };
  }
  if (v.consistent) {
    return { tone: "neutral", label: "Defter tutarlı" };
  }
  return {
    tone: "warning",
    label: `Sapma var: ürün stoğu ${v.current_stock}, defter ${v.ledger_stock}`,
  };
}
