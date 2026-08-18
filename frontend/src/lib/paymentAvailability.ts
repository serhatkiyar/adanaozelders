// Ürün kolu bazlı ödeme uygunluğu — saf mantık (test edilebilir, React'sız).
//
// Sunucudaki karşılığı `backend/services/payment_gates.py`. Kollar bilinçli
// olarak bağımsızdır: pazaryeri ödemeleri kapalıyken platformun kendi kitap
// satışı çalışmaya devam eder (o kolda para başkası adına toplanmıyor).
//
// İstemci de FAIL-CLOSED'dır: uygunluk bilgisi henüz yüklenmediyse veya isteği
// patladıysa kol KAPALI sayılır. Aksi hâlde kullanıcı ödeme akışını başlatır,
// sunucu 503 döner ve deneyim "bozuk" görünür — oysa kural belliydi.

export type PaymentBranch = "store" | "tutor_marketplace" | "library_marketplace";

export interface BranchStatus {
  branch: string;
  label?: string;
  open: boolean;
  flag_enabled: boolean;
  blockers: string[];
  message?: string | null;
}

export interface PaymentAvailability {
  branches: BranchStatus[];
  /** Dijital (indirilebilir) ürün satışı açık mı? Kollardan BAĞIMSIZ kapı. */
  digital_products_open?: boolean;
}

/** Mağaza satır satıcı tipi → ödeme kolu (backend `_SELLER_TYPE_BRANCH` ile hizalı). */
const SELLER_TYPE_BRANCH: Record<string, PaymentBranch> = {
  PLATFORM: "store",
  TUTOR: "tutor_marketplace",
};

/** Rapor ve test kararlılığı için deterministik sıra. */
const BRANCH_ORDER: PaymentBranch[] = ["store", "tutor_marketplace", "library_marketplace"];

const CLOSED_MESSAGE: Record<PaymentBranch, string> = {
  store: "Mağaza ödemeleri şu anda geçici olarak kapalı. Kısa süre içinde tekrar açılacak.",
  // Bu kol ders ödemesini VE eğitmenin dijital ürününü kapsar; metin ikisini de
  // karşılamalı (backend `BRANCH_CLOSED_MESSAGE` ile aynı).
  tutor_marketplace:
    "Eğitmenlere yapılan ödemeler henüz açılmadı. Ödeme altyapımız hazır olduğunda ders rezervasyonu ve eğitmen ürünleri satın alınabilecek.",
  library_marketplace:
    "Kütüphane bileti ve çalışma alanı ödemeleri henüz açılmadı. Ödeme altyapımız hazır olduğunda satışa açılacak.",
};

/** Kol açık mı? Bilgi yoksa veya kol tanınmıyorsa **kapalı** sayılır. */
export function isBranchOpen(
  availability: PaymentAvailability | null | undefined,
  branch: PaymentBranch,
): boolean {
  if (!availability?.branches) return false;
  const row = availability.branches.find((b) => b.branch === branch);
  return row?.open === true;
}

/**
 * Sepetteki satıcı tiplerinden kapalı kolları bulur — checkout'a gitmeden önce
 * gösterilir. Bilinmeyen satıcı tipi pazaryeri sayılır (kapı yanlışlıkla açık
 * kalmasın; backend'de aynı kural).
 */
export function blockedBranchesForCart(
  availability: PaymentAvailability | null | undefined,
  sellerTypes: string[],
): PaymentBranch[] {
  const needed = new Set<PaymentBranch>();
  for (const raw of sellerTypes) {
    const key = (raw || "").trim().toUpperCase();
    needed.add(SELLER_TYPE_BRANCH[key] ?? "tutor_marketplace");
  }
  return BRANCH_ORDER.filter((b) => needed.has(b) && !isBranchOpen(availability, b));
}

/**
 * "Ödemeniz emanette tutulur" gibi bir vaat verilebilir mi?
 *
 * Emanet (escrow), paranın sağlayıcıda bloke edilip hizmet gerçekleştikten sonra
 * hak sahibine aktarılmasıdır — yani **alt üye işyeri modeli** çalışıyorsa
 * doğrudur. Kol kapalıyken bu ifadeyi kullanmak yanlış vaattir.
 *
 * Mağaza kolu için hiçbir zaman kullanılmaz: kendi malının satışı doğrudan
 * satıştır, para platformun kendi cirosudur.
 */
export function canPromiseEscrow(
  availability: PaymentAvailability | null | undefined,
  branch: PaymentBranch,
): boolean {
  if (branch === "store") return false;
  return isBranchOpen(availability, branch);
}

/**
 * Dijital ürün satışı açık mı? **Kollardan bağımsız** bir sorudur: platformun
 * kendi dijital ürünü `store` koluna düşer ve o kol varsayılan olarak açıktır —
 * yani kol durumuna bakmak bu soruyu cevaplamaz (tuzağın kökü tam olarak buydu).
 *
 * Bilgi yoksa **kapalı** sayılır (kolların fail-closed kuralıyla aynı). Burada
 * yanlış tarafa düşmenin bedeli ödeme yüzeyindekinden ağır: bayrak kapalıyken
 * oluşturulan dijital ürün satılamaz ve `kind` bir DB trigger'ıyla
 * değiştirilemez olduğu için sonradan DÜZELTİLEMEZ.
 */
export function digitalProductsOpen(
  availability: PaymentAvailability | null | undefined,
): boolean {
  return availability?.digital_products_open === true;
}

/** Kapalı kol için kullanıcıya gösterilecek nötr metin (emanet vaadi içermez). */
export function closedBranchMessage(branch: PaymentBranch): string {
  return CLOSED_MESSAGE[branch];
}
