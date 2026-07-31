// F29 envanter (sayım + hasarlı stok) — sunum tarafı saf mantık.
//
// Kurallar üç ekranda birden kullanılıyor: sayım listesi, sayım detayı ve
// hasar işlemleri. Tek yerde tutmak, üçünün zamanla ayrışmasını engeller
// (`stockMovements.ts` ile aynı gerekçe).
//
// **Kesin karar her zaman backend'dedir.** Buradaki hesap ve kapılar yalnız
// arayüz iyileştirmesidir: servisin reddedeceği butonu hiç göstermemek,
// yanlış sayıyı kullanıcıya "gerçek" diye sunmamak.
//
// **Parasal kavram yoktur.** F29 miktar ve iz tutar, değerleme yapmaz.

export type Bucket = "SALEABLE" | "DAMAGED";
export type CountScope = "ALL" | "CATEGORY" | "MANUAL";
export type CountSessionStatus = "DRAFT" | "IN_PROGRESS" | "REVIEW" | "APPLIED" | "CANCELLED";
export type CountLineStatus = "PENDING" | "COUNTED" | "STALE" | "RESOLVED";
export type DamageKind = "TRANSFER" | "RECOVERY" | "DISPOSAL" | "SUPPLIER_RETURN";
export type DamageReason =
  | "KIRIK"
  | "ISLAK"
  | "BASKI_HATASI"
  | "MUSTERI_IADESI_HASARLI"
  | "DIGER";

/* ════════════════════════ İzin ════════════════════════ */

export interface InventoryAccess {
  canView: boolean;
  canCount: boolean;
  canApply: boolean;
}

/**
 * Envanterin ÜÇ kademeli izni.
 *
 * `adminAreaAccess` burada kullanılamaz: o `.view`/`.manage` ikilisini
 * varsayar, envanterde ise görev ayrılığı için üçüncü bir kademe vardır —
 * **sayan kişi tek başına envanteri değiştiremez**.
 *
 * `permissions` undefined ise fail-open (eski persist edilmiş oturum, `/me`
 * henüz tazelenmedi): `adminAccess.ts` ile aynı sözleşme, backend reddeder.
 */
export function inventoryAccess(permissions: string[] | undefined): InventoryAccess {
  if (!permissions) return { canView: true, canCount: true, canApply: true };
  const canApply = permissions.includes("inventory.apply");
  const canCount = permissions.includes("inventory.count");
  return {
    // apply/count'u olup view'u olmayan rol tanımına karşı: ikisi de
    // görüntülemeyi ima eder.
    canView: canApply || canCount || permissions.includes("inventory.view"),
    canCount,
    canApply,
  };
}

/* ════════════════════════ Sayım FSM'i ════════════════════════ */

export type CountAction = "products" | "start" | "count" | "submit" | "reopen" | "apply" | "cancel";

/**
 * Duruma göre ANLAMLI eylemler.
 *
 * Servisin reddedeceği bir butonu görünür bırakıp yalnız tıklanınca hata
 * göstermek, operatöre yapılabilir olmayan bir şey vaat etmektir. Buradaki
 * liste yine de nihai otorite DEĞİLDİR — backend son sözü söyler.
 */
export function allowedCountActions(status: CountSessionStatus): CountAction[] {
  switch (status) {
    case "DRAFT":
      return ["products", "start", "cancel"];
    case "IN_PROGRESS":
      return ["count", "submit", "cancel"];
    case "REVIEW":
      // Sayım REVIEW'da da açıktır: yeniden sayım oturumu IN_PROGRESS'e
      // döndürür ve onayı temizler (backend `set_counted` sözleşmesi).
      return ["count", "apply", "reopen", "cancel"];
    default:
      return [];
  }
}

/* ════════════════════════ Miktar kavramları ════════════════════════ */

export interface CountLineLike {
  bucket: Bucket;
  status: CountLineStatus;
  system_qty_snapshot: number;
  reserved_qty_snapshot: number | null;
  counted_qty: number | null;
}

/**
 * Rafta bulunması BEKLENEN fiziksel adet.
 *
 * Satılabilir kovada rezerve de eklenir: ödenmiş ama işletmeden çıkmamış mal
 * hâlâ rafta durur. Hasarlı kovada rezerve kavramı YOKTUR.
 */
export function expectedPhysical(line: CountLineLike): number {
  const rezerve = line.bucket === "SALEABLE" ? (line.reserved_qty_snapshot ?? 0) : 0;
  return line.system_qty_snapshot + rezerve;
}

/** Sayılan − beklenen. Sayılmamışsa `null` — sıfır DEĞİL. */
export function lineDifference(line: CountLineLike): number | null {
  if (line.counted_qty === null || line.counted_qty === undefined) return null;
  return line.counted_qty - expectedPhysical(line);
}

const SAYILMADI = "Henüz sayılmadı";

export function formatCountedQty(line: CountLineLike): string {
  if (line.counted_qty === null || line.counted_qty === undefined) return SAYILMADI;
  return String(line.counted_qty);
}

/**
 * Fark gösterimi.
 *
 * Sayılmamış satırda `0` yazmak "fark yok" demektir; doğrusu "henüz
 * bilinmiyor". İkisini karıştırmak, sayılmamış rafı sayılmış gibi okutur.
 * Eksi işareti defterle aynı karakterden (U+2212) gelir — hizalanır.
 */
export function formatDifference(line: CountLineLike): string {
  const d = lineDifference(line);
  if (d === null) return SAYILMADI;
  if (d > 0) return `+${d}`;
  if (d < 0) return `−${Math.abs(d)}`;
  return "0";
}

/** Hasarlı kovada rezerve "0" değil "uygulanmaz"dır. */
export function reservedDisplay(line: CountLineLike): string {
  if (line.bucket === "DAMAGED") return "Uygulanmaz";
  return String(line.reserved_qty_snapshot ?? 0);
}

/* ════════════════════════ Etiketler ve rozetler ════════════════════════ */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export function bucketLabel(bucket: Bucket): string {
  return bucket === "SALEABLE" ? "Satılabilir" : "Hasarlı";
}

const OTURUM_ROZET: Record<CountSessionStatus, { tone: Tone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Taslak" },
  IN_PROGRESS: { tone: "info", label: "Sayım sürüyor" },
  REVIEW: { tone: "warning", label: "İncelemede" },
  APPLIED: { tone: "success", label: "Uygulandı" },
  CANCELLED: { tone: "neutral", label: "İptal edildi" },
};

export function sessionStatusBadge(status: CountSessionStatus): { tone: Tone; label: string } {
  // Sunucu yeni bir durum eklerse ekran ham enum yazmamalı.
  return OTURUM_ROZET[status] ?? { tone: "neutral", label: "Bilinmeyen durum" };
}

const SATIR_ROZET: Record<CountLineStatus, { tone: Tone; label: string; needsAction: boolean }> = {
  PENDING: { tone: "neutral", label: "Sayılmadı", needsAction: true },
  COUNTED: { tone: "success", label: "Sayıldı", needsAction: false },
  // "Belirsiz" — sayımdan sonra fiziksel etkisi bilinmeyen bir olay geçti.
  STALE: { tone: "danger", label: "Belirsiz", needsAction: true },
  // RESOLVED "çözüldü" DEĞİLDİR: açıklama kayda geçti ama satır hâlâ
  // uygulanamaz. Tek çıkış yeniden sayımdır (backend sözleşmesi).
  RESOLVED: { tone: "warning", label: "Yeniden sayılmalı", needsAction: true },
};

export function lineStatusBadge(status: CountLineStatus): {
  tone: Tone;
  label: string;
  needsAction: boolean;
} {
  return SATIR_ROZET[status] ?? { tone: "neutral", label: "Bilinmeyen durum", needsAction: true };
}

/** Belirsizliğin sebebi (backend `stale_reason` = hareket/olay adı). */
export function staleReasonLabel(code: string | null): string {
  if (!code) return "Sebep kayıtlı değil";
  const map: Record<string, string> = {
    ORDER_SHIPPED: "Sayımdan sonra sipariş sevk edildi",
    ORDER_DELIVERED: "Sayımdan sonra sipariş teslim edildi",
    ORDER_REFUNDED: "Sayımdan sonra sipariş iade edildi",
    RETURN_ACCEPTED: "Sayımdan sonra iade kabul edildi",
    ADMIN_ADJUSTMENT: "Sayımdan sonra yönetici düzeltmesi yapıldı",
    SALE_CANCEL: "Sayımdan sonra satış iptali işlendi",
  };
  return map[code] ?? `Sayımdan sonra bir olay geçti (${code})`;
}

/* ════════════════════════ APPLY engelleri ════════════════════════ */

/**
 * APPLY'i engelleyen sebepler — insan cümlesi olarak.
 *
 * Disabled bir buton sessiz kalmamalı: operatör NEDEN uygulayamadığını ve NE
 * yapması gerektiğini ekranda görmeli.
 */
export function applyBlockers(lines: CountLineLike[]): string[] {
  const sebepler: string[] = [];
  const stale = lines.filter((l) => l.status === "STALE").length;
  const resolved = lines.filter((l) => l.status === "RESOLVED").length;
  const sayilmamis = lines.filter((l) => l.status === "PENDING" || l.counted_qty === null).length;

  if (stale > 0) {
    sebepler.push(
      `${stale} satırda sayımdan sonra fiziksel etki oluştu — uygulamadan önce yeniden sayılmalı.`
    );
  }
  if (resolved > 0) {
    sebepler.push(
      `${resolved} satıra açıklama yazıldı ama yeniden sayılmadı — açıklama tek başına yeterli değil.`
    );
  }
  if (sayilmamis > 0) {
    sebepler.push(`${sayilmamis} satır henüz sayılmadı.`);
  }
  return sebepler;
}

/* ════════════════════════ Hasar işlemleri ════════════════════════ */

export interface DamageKindOption {
  value: DamageKind;
  /** Kullanıcıya gösterilen FİİL — API enum'u ekranda görünmez. */
  label: string;
  description: string;
}

export const DAMAGE_KINDS: DamageKindOption[] = [
  {
    value: "TRANSFER",
    label: "Hasara ayır",
    description: "Satılabilir raftan düşer, hasarlı rafa eklenir. Toplam mevcut değişmez.",
  },
  {
    value: "RECOVERY",
    label: "Satılabilir duruma döndür",
    description: "Hasarlı raftan düşer, satılabilir rafa eklenir. Toplam mevcut değişmez.",
  },
  {
    value: "DISPOSAL",
    label: "İmha et",
    description: "Hasarlı raftan fiziksel çıkış; mal stoktan tamamen düşer.",
  },
  {
    value: "SUPPLIER_RETURN",
    label: "Tedarikçiye iade et",
    description: "Seçilen raftan fiziksel çıkış. Kaynak raf açıkça seçilir.",
  },
];

export function damageKindLabel(kind: DamageKind): string {
  return DAMAGE_KINDS.find((k) => k.value === kind)?.label ?? "Bilinmeyen işlem";
}

/** Geçmiş kaydında geçmiş zaman kullanılır: buton "yap" der, kayıt "yapıldı" der.
 *  Aynı metin ikisinde de kullanılırsa liste satırı tıklanabilir bir eylem gibi okunur. */
const GECMIS_ETIKET: Record<DamageKind, string> = {
  TRANSFER: "Hasara ayrıldı",
  RECOVERY: "Satılabilir duruma döndürüldü",
  DISPOSAL: "İmha edildi",
  SUPPLIER_RETURN: "Tedarikçiye iade edildi",
};

export function damageKindPastLabel(kind: DamageKind): string {
  return GECMIS_ETIKET[kind] ?? "Bilinmeyen işlem";
}

export interface DamageEffect {
  from: Bucket | null;
  to: Bucket | null;
  text: string;
  irreversible: boolean;
}

/**
 * İşlemin iki kova üzerindeki etkisi — onaydan ÖNCE, rakamla.
 *
 * Yön burada tek yerde tanımlıdır: kurtarmanın transferin tersi olduğunu
 * operatör metinden okur, ezberden değil.
 */
export function damageEffect(
  kind: DamageKind,
  qty: number,
  sourceBucket: Bucket | null = null
): DamageEffect {
  const adet = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const sayi = adet > 0 ? String(adet) : "—";

  switch (kind) {
    case "TRANSFER":
      return {
        from: "SALEABLE",
        to: "DAMAGED",
        text: `Satılabilir raf −${sayi}, Hasarlı raf +${sayi}. Toplam fiziksel mevcut aynı kalır.`,
        irreversible: false,
      };
    case "RECOVERY":
      return {
        from: "DAMAGED",
        to: "SALEABLE",
        text: `Hasarlı raf −${sayi}, Satılabilir raf +${sayi}. Toplam fiziksel mevcut aynı kalır.`,
        irreversible: false,
      };
    case "DISPOSAL":
      return {
        from: "DAMAGED",
        to: null,
        // Geri alınamazlık uyarısı TEK yerde durur (formdaki uyarı kutusu);
        // burada tekrarlanırsa aynı cümle ekranda iki kez görünür.
        text: `Hasarlı raf −${sayi}. Satılabilir raf etkilenmez.`,
        irreversible: true,
      };
    case "SUPPLIER_RETURN":
      if (!sourceBucket) {
        return {
          from: null,
          to: null,
          text: "Kaynak raf seçilmeden etki hesaplanamaz.",
          irreversible: true,
        };
      }
      return {
        from: sourceBucket,
        to: null,
        text: `${bucketLabel(sourceBucket)} raf −${sayi}. Diğer rafa sessizce aktarılmaz.`,
        irreversible: true,
      };
    default:
      return { from: null, to: null, text: "Bilinmeyen işlem.", irreversible: true };
  }
}

/** Backend `DAMAGE_REASONS` beyaz listesiyle BİREBİR aynı sıra ve içerik. */
export const DAMAGE_REASON_OPTIONS: { value: DamageReason; label: string }[] = [
  { value: "KIRIK", label: "Kırık" },
  { value: "ISLAK", label: "Islak / nem" },
  { value: "BASKI_HATASI", label: "Baskı hatası" },
  { value: "MUSTERI_IADESI_HASARLI", label: "Müşteri iadesi — hasarlı geldi" },
  { value: "DIGER", label: "Diğer" },
];

export function damageReasonLabel(code: string): string {
  return DAMAGE_REASON_OPTIONS.find((o) => o.value === code)?.label ?? code;
}

export function requiresDamageNote(reason: DamageReason | null): boolean {
  return reason === "DIGER";
}

/* ════════════════════════ Hasar formu doğrulaması ════════════════════════ */

export interface DamageFormInput {
  productId: number | null;
  kind: DamageKind;
  qty: number;
  reason: DamageReason | null;
  note: string;
  bucket: Bucket | null;
  idempotencyKey: string;
}

export interface DamagePayload {
  product_id: number;
  kind: DamageKind;
  qty: number;
  reason_code: DamageReason;
  note: string | null;
  idempotency_key: string;
  bucket?: Bucket;
}

export interface DamageFormResult {
  ok: boolean;
  error?: string;
  payload?: DamagePayload;
}

export function validateDamageForm(input: DamageFormInput): DamageFormResult {
  const { productId, kind, qty, reason, note, bucket, idempotencyKey } = input;

  if (!productId || !Number.isInteger(productId) || productId <= 0) {
    return { ok: false, error: "Ürün seçilmeden işlem yapılamaz." };
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    return { ok: false, error: "Miktar sıfırdan büyük bir tam sayı olmalı." };
  }
  if (!reason) {
    return { ok: false, error: "Neden seçmeden işlem yapılamaz." };
  }
  if (requiresDamageNote(reason) && !note.trim()) {
    return { ok: false, error: "“Diğer” nedeninde açıklama zorunlu." };
  }
  if (kind === "SUPPLIER_RETURN" && !bucket) {
    return { ok: false, error: "Tedarikçi iadesinde kaynak kova seçilmeli." };
  }
  if (!idempotencyKey) {
    // Anahtarsız gönderim, ağ tekrarında ikinci kez stok düşürebilirdi.
    return { ok: false, error: "İşlem anahtarı üretilemedi; pencereyi kapatıp yeniden açın." };
  }

  const payload: DamagePayload = {
    product_id: productId,
    kind,
    qty,
    reason_code: reason,
    note: requiresDamageNote(reason) ? note.trim() : null,
    idempotency_key: idempotencyKey,
  };
  // `bucket` YALNIZ tedarikçi iadesinde anlamlı; diğerlerinde göndermek
  // sunucuda `extra=forbid` yüzünden 422 üretmez ama anlamsız veri taşır.
  if (kind === "SUPPLIER_RETURN" && bucket) payload.bucket = bucket;
  return { ok: true, payload };
}

/**
 * Tek gönderim niyeti boyunca SABİT kalan işlem anahtarı.
 *
 * Her render'da yenilenirse ağ tekrarında sunucu iki ayrı iş görür ve stok
 * iki kez düşer. Anahtar formun açılışında üretilir, işlem başarıyla
 * tamamlanınca yenilenir.
 */
export function newIdempotencyKey(): string {
  const rastgele =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
  return `ui-${rastgele}`;
}

/* ════════════════════════ Hata eşlemesi ════════════════════════ */

/**
 * Envanter hataları için mesaj.
 *
 * `getErrorMessage` 409'da backend `detail`'ini ATAR ve genel bir "çakışma
 * oluştu" döner. Envanterde 409, "hangi anahtarla uygulandı" ya da "defter
 * bütünlüğü bozuk" gibi **eyleme dönük** bilgi taşır; bunu yutmak operatörü
 * kör bırakır. Ham DB/traceback metni ise hiçbir koşulda gösterilmez.
 */
export function inventoryErrorMessage(error: unknown, fallback = "İşlem tamamlanamadı."): string {
  const yanit = (error as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  const status = yanit?.status;
  const detail = typeof yanit?.data?.detail === "string" ? yanit.data.detail : null;

  if (detail && detail.includes("LEDGER_INVARIANT")) {
    // Arayüz otomatik onarım İDDİA ETMEZ: servis bilinçli olarak onarmıyor.
    return (
      "Defter bütünlüğü bozuk: bu olayın beklenen defter kayıtları eşleşmiyor. " +
      "Hiçbir şey yazılmadı ve kendiliğinden düzelmez — envanter sorumlusuna bildirin."
    );
  }
  if (status === 409 && detail) {
    return `${detail} Sayfayı yenileyip güncel durumu görün.`;
  }
  if (status === 422) {
    return "Gönderilen bilgi geçersiz. Alanları kontrol edip yeniden deneyin.";
  }
  if (status === 403) {
    return "Bu işlem için yetkiniz yok. Rolünüzde ilgili envanter izni tanımlı değil.";
  }
  if (status === 404) {
    return "Kayıt bulunamadı. Başka biri silmiş ya da adres yanlış olabilir.";
  }
  if (status === 400 && detail) return detail;
  if (status && status >= 500) {
    return "Sunucu hatası. Kayıt değişmedi; biraz sonra yeniden deneyin.";
  }
  return detail ?? fallback;
}
