// Bilinen YASAL METİN BORCU kütüğü — takip edilebilir engelleyici kaydı.
//
// Neden ayrı bir dosya: `legalContent.ts` içindeki metinler **avukat onayına
// tabidir** ve tek taraflı düzeltilmemeleri gerekir (bkz. plan §14b-9). Ama
// "düzeltmeyeceğiz" ile "unuttuk" arasındaki fark görünür olmak zorundadır.
// Bu kütük her bilinen tutarsızlığı, sebebini ve hangi paketin kapatacağını
// makine-okunur biçimde tutar; `legalDebt.test.ts` metnin hâlâ tam olarak bu
// hâlde olduğunu doğrular.
//
// Sözleşme: buradaki bir kayıt yalnız iki durumda değişir —
//   (a) avukat onayıyla metin düzeltildi (kayıt SİLİNİR), ya da
//   (b) metin başka bir sebeple değişti (kayıt GÜNCELLENİR ve gerekçe yazılır).
// Kayıt eskirse test kırılır; sessizce eskiyemez.

export interface LegalDebtEntry {
  /** Kütük anahtarı (kararlı). */
  id: string;
  /** Hangi yasal doküman (`legalContent` `LegalDoc.id`). */
  doc: string;
  /** Metnin bulunduğu bölüm id'si. */
  sectionId: string;
  /** Metnin bugünkü hâlinden ayırt edici bir alıntı (birebir eşleşmeli). */
  currentSnippet: string;
  /** Neden yanlış / eksik. */
  problem: string;
  /** Kim onaylamadan düzeltilmez. */
  blockedBy: string;
  /** Hangi paket kapatacak. */
  owner: string;
  /** Lansmanı engelliyor mu? */
  launchBlocker: boolean;
}

export const LEGAL_DEBT: LegalDebtEntry[] = [
  {
    id: "escrow-tum-odemeler",
    doc: "refund",
    sectionId: "genel",
    currentSnippet: "Platformdaki tüm ödemeler önce emanete alınır",
    problem:
      "Ödeme kolları artık bağımsız (PK-1). Bugün açık olan tek kol mağaza — " +
      "platformun KENDİ malının satışı, yani doğrudan satış: para platformun " +
      "kendi cirosudur, emanet edilmez. Pazaryeri kolları (eğitmen dersi/ürünü, " +
      "kütüphane bileti) iyzico Pazaryeri entegrasyonu (PK-2) devreye girene " +
      "kadar kapalı. Dolayısıyla 'tüm ödemeler emanete alınır' cümlesi bugün " +
      "hiçbir kol için doğru değil ve tüketiciye yerine getirilmeyen bir " +
      "koruma vaadi veriyor.",
    blockedBy: "Avukat onayı (plan §14b-9: cayma/iade metinleri)",
    owner: "PK-7 (ETAHS uyum paketi) — metin kol bazlı ayrılacak",
    launchBlocker: true,
  },
];

/** Lansmanı engelleyen açık borçlar. */
export function launchBlockingLegalDebt(): LegalDebtEntry[] {
  return LEGAL_DEBT.filter((d) => d.launchBlocker);
}
