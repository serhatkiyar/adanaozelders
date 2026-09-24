/**
 * TAM SAYFA gezinme — yalnız canlı ders (Zoom) sayfasına giriş ve çıkış için.
 *
 * `frontend/CLAUDE.md` "sayfa yenileten gezinme ekleme" der; bu, o kuralın
 * BİLİNÇLİ ve tek istisnasıdır. Gerekçe iki katlı:
 *
 *   1. CSP kolu: `nginx.conf`taki `map $request_uri` belgenin İLK isteğine
 *      bakar; `/canli-ders/` kolu Zoom CDN'ine ve WASM'a izin verir. SPA
 *      geçişinde belge site kolunun katı politikasıyla kalır ve Zoom hiç
 *      yüklenmez.
 *   2. SDK küresel durumu: Zoom Video SDK tekil istemci, web bileşenleri
 *      (`video-player`), işçiler ve kapatılamayan dinleyiciler bırakır. Tam
 *      sayfa yüklemesi girişte temiz bir belge, çıkışta SDK'dan arınmış bir
 *      site verir.
 *
 * Ayrı modül olmasının nedeni test edilebilirlik: jsdom `location.assign`'ı
 * uygulamaz; testler bu modülü `vi.mock` ile taklit eder.
 */
export function tamSayfaGit(adres: string): void {
  window.location.assign(adres);
}
