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

// KAPANAN BORÇ — `escrow-tum-odemeler` (17 Ağu 2026)
//
// İptal ve iade politikasının 1. bölümü "Platformdaki tüm ödemeler önce
// emanete alınır" diyordu; ödeme kolları bağımsızlaştıktan sonra (PK-1) bu
// cümle hiçbir kol için doğru değildi ve tüketiciye yerine getirilmeyen bir
// koruma vaadi veriyordu. Kayıt, "avukat onayı gelmeden dokunulmaz" gerekçesiyle
// açık tutuluyordu.
//
// Kapanma sebebi: sanal POS başvurusunda platformun eğitim hizmeti satmadığı,
// üçüncü kişi adına tahsilat yapmadığı ve emanet modeliyle çalışmadığı BEYAN
// EDİLDİ. Yasal metnin bu beyanla birebir uyuşması bir tercih değil zorunluluk
// hâline geldiği için bölüm yeniden yazıldı: ödemenin doğrudan işletmeye
// yapıldığı ve emanet uygulanmadığı açıkça söyleniyor. Borcun sebebi olan cümle
// artık metinde yok, dolayısıyla kayıt SİLİNDİ (kütük sözleşmesi §(a)).
//
// Kütük yapısı ve nöbetçi testi BİLEREK duruyor: bir sonraki bilinen
// tutarsızlık çıktığında buraya kayıt eklenir.

export const LEGAL_DEBT: LegalDebtEntry[] = [];

/** Lansmanı engelleyen açık borçlar. */
export function launchBlockingLegalDebt(): LegalDebtEntry[] {
  return LEGAL_DEBT.filter((d) => d.launchBlocker);
}
