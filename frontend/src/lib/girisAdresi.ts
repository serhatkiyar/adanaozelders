/**
 * Giriş/kayıt penceresini açan arama dizesini üretir — MEVCUT SORGU KORUNARAK.
 *
 * ## Ölçülmüş kusur (canlıydı)
 *
 * Kapı sekiz ayrı yerde `<Link to="?modal=login">` ya da
 * `navigate("?modal=login")` ile elle kuruluyordu. React Router'da search-only
 * bir `to`, mevcut sorguyu **birleştirmez, DEĞİŞTİRİR**. Yani
 * `/egitmenler?ders=Matematik&ilce=Seyhan&sirala=puan` sayfasında kalbe basmak
 * üç filtreyi de siliyordu: kullanıcı giriş yapıp pencereyi kapattığında
 * filtresiz listeye düşüyordu. Hata yok, uyarı yok — yalnız yanlış liste.
 *
 * Filtreler 9 Eyl 2026'da URL şemasına taşındığı için (`lib/aramaUrl.ts`) bu
 * kusur her yeni filtreyle biraz daha pahalı hâle gelmişti.
 *
 * ## Sözleşme
 *
 * Dönen değer `?` ile başlayan bir ARAMA dizesidir; YOL değişmez. Çağıran onu
 * `navigate()` ya da `<Link to>`ya verir, kullanıcı bulunduğu sayfada kalır.
 * `AuthModal` (App.tsx, `Routes` DIŞINDA, tek montaj) bu parametreyi görüp
 * kendini açar; kapı asla kendi modalını mount etmez.
 */

/** Bu modül, giriş penceresi parametrelerini kuran TEK yerdir. */
export type GirisModu = "login" | "register";
export type GirisRolu = "client" | "tutor";

export function girisAdresi(
  mevcut: URLSearchParams,
  mod: GirisModu = "login",
  rol?: GirisRolu
): string {
  // Kopya üzerinden gidilir: `URLSearchParams` mutable'dır ve çağıranın
  // `useSearchParams()` nesnesini yerinde değiştirmek sessiz bir bug'dır.
  const p = new URLSearchParams(mevcut);
  p.set("modal", mod);
  if (rol) p.set("role", rol);
  else p.delete("role");
  // Eski bir Google giriş hatası yeni pencerede yaşamaya devam etmesin:
  // kullanıcı hata mesajını bir kez gördü, ikinci açılış temiz başlamalı.
  p.delete("hata");
  return `?${p.toString()}`;
}
