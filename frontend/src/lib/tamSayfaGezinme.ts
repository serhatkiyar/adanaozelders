/**
 * TAM SAYFA gezinme — yalnız canlı ders (Zoom) sayfasına giriş ve çıkış için.
 *
 * `frontend/CLAUDE.md` "sayfa yenileten gezinme ekleme" der; bu, o kuralın
 * BİLİNÇLİ ve tek istisnasıdır. Gerekçe: Zoom UI Toolkit'in CSS'i kapsamsız
 * bir Tailwind preflight taşır (`*`, `html`, `body`, `button`, `h1-6`, `img`)
 * ve ~9 MB'lık paket kendi React kopyasını, küresel `window.UIToolkit`'i ve
 * kapatılamayan dinleyicileri sayfaya bırakır. SPA içinde girip çıkılsaydı bu
 * stiller ve durum sitenin geri kalanına sızardı. Tam sayfa yüklemesi hem
 * girişte temiz bir belge (ileride ayrı CSP: `nginx` `/canli-ders/` kolu) hem
 * çıkışta toolkit'ten arınmış bir site verir.
 *
 * Ayrı modül olmasının nedeni test edilebilirlik: jsdom `location.assign`'ı
 * uygulamaz; testler bu modülü `vi.mock` ile taklit eder.
 */
export function tamSayfaGit(adres: string): void {
  window.location.assign(adres);
}
