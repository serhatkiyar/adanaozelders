/**
 * Google giriş akışının hata kodlarını kullanıcıya gösterilecek metne çevirir.
 *
 * Sunucu bilerek yalnız bir KOD döndürür (`?durum=dogrulama` gibi): hangi
 * denetimin düştüğünü ayrıntısıyla söylemek saldırgana geri bildirim verir.
 * Metin bu yüzden istemcide seçilir.
 *
 * Tek kaynak: hem dönüş sayfası (`pages/GoogleDonus.tsx`) hem giriş penceresi
 * (`components/AuthModal.tsx`) buradan okur. İki ayrı tablo tutulsaydı aynı kod
 * iki farklı cümleye çevrilirdi.
 */
const METIN: Record<string, string> = {
  iptal: "Google ile giriş iptal edildi.",
  suresi_doldu: "Giriş isteğinin süresi doldu. Lütfen tekrar dene.",
  dogrulama: "Google girişi doğrulanamadı. Lütfen tekrar dene.",
  saglayici: "Google'a şu anda ulaşılamıyor. Lütfen biraz sonra tekrar dene.",
  hesap_yok: "Bu Google hesabıyla eşleşen bir üyelik yok. Önce kayıt olabilirsin.",
  pasif: "Hesabın şu anda etkin değil.",
  kayit_kapali: "Yeni üye kaydı şu anda kapalı.",
  baska_google_bagli: "Bu üyeliğe zaten başka bir Google hesabı bağlı.",
};

export const GOOGLE_GENEL_HATA =
  "Google girişi tamamlanamadı. Lütfen tekrar dene.";

export function googleHataMetni(kod: string | null | undefined): string | null {
  if (!kod) return null;
  return METIN[kod] ?? GOOGLE_GENEL_HATA;
}
