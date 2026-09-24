/**
 * Öğretmen/kütüphane kartı liste ızgarasının SÜTUN kuralı — tek kaynak.
 *
 * Kart kendi genişliğini taşımaz (eskiden `mx-auto max-w-[310px]`); hücresini
 * doldurur ve genişliği bu ızgara belirler (kullanıcı kararı, 24 Eyl 2026 ·
 * docs/DESIGN.md §11/§15). Eşikler hücreyi ~200–340px aralığında tutar:
 * telefonda (<480px) tek sütun tam genişlik, 480–767 iki, 768+ üç sütun.
 * Eski `sm:grid-cols-2 lg:grid-cols-3` 360–639px'te tek sütunda 568px'e,
 * 704–1023px'te iki sütunda 460px'e varan hücre açıyordu; 310px'lik kart da
 * bu hücrelerde ortalanıp sayaç/başlıkla hizasız yüzüyordu.
 *
 * Boşluk da burada (32px): iskelet ile gerçek ızgara, öğretmen ile kütüphane
 * sekmesi aynı aralığı kullanır — `gap-6`/`gap-8` karışıklığında yükleme
 * bitince sütunlar kayıyordu.
 */
export const KART_IZGARASI =
  "grid grid-cols-1 gap-8 min-[480px]:grid-cols-2 md:grid-cols-3";
