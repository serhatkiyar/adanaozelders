/**
 * Google girişinden sonra dönülecek SİTE İÇİ yolu doğrular.
 *
 * ## Neden istemcide de var
 *
 * Otorite sunucudadır (`services/google_oauth_service.guvenli_donus_yolu`) ve
 * değer oraya imzalı çerezde taşınır. Buradaki kontrol ikinci hattır ve süs
 * değil: `navigate()`e verilen `//evil.example` react-router'da origin dışına
 * çıkar. Yani dönüş adresi URL'den okunup doğrudan `navigate()`e verilseydi,
 * sunucu tarafı ne yaparsa yapsın açık yönlendirme burada yeniden doğardı.
 *
 * Kural sunucudakiyle AYNI tutulmalı; ayrışırsa kullanıcı sunucunun kabul edip
 * istemcinin reddettiği (ya da tersi) bir adreste takılır.
 *
 * Reddedilenlerin her biri gerçek bir saldırı biçimi:
 * - `//evil.example`  tarayıcı bunu protokol-göreli MUTLAK adres sayar
 * - `/\evil.example`  bazı tarayıcılar ters bölüyü bölü gibi çözümler
 * - `https://…`       düpedüz dış adres
 * - `\r\n`            başlık/URL enjeksiyonu
 * - `/api/…`          site içi ama kullanıcı yüzeyi değil (ham JSON)
 *
 * `null` döner ve çağıran varsayılana düşer; akış hata ile KESİLMEZ.
 */
const UZUNLUK_SINIRI = 512;

export function guvenliDonusYolu(deger: string | null | undefined): string | null {
  if (!deger || typeof deger !== "string") return null;
  if (deger.length > UZUNLUK_SINIRI) return null;
  if (/[\r\n\t\s\0]/.test(deger)) return null;
  if (!deger.startsWith("/")) return null;
  if (deger.startsWith("//") || deger.startsWith("/\\")) return null;
  if (deger === "/api" || deger.startsWith("/api/")) return null;
  return deger;
}

/**
 * Google düğmesine basıldığında geri dönülecek adres.
 *
 * Modal parametreleri TEMİZLENİR: `?modal=login` ile dönülseydi kullanıcı
 * girişi tamamladıktan sonra giriş penceresi yeniden açılırdı. `role` de
 * modalın başlangıç sekmesidir, dönüşte anlamı kalmaz.
 */
export function donusAdresiUret(pathname: string, search: string): string {
  const parametreler = new URLSearchParams(search);
  for (const anahtar of ["modal", "role", "durum", "git", "mod", "hata"]) {
    parametreler.delete(anahtar);
  }
  const kalan = parametreler.toString();
  return guvenliDonusYolu(kalan ? `${pathname}?${kalan}` : pathname) ?? "/";
}
