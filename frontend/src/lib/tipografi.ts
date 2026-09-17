/**
 * Sayfa başlığı — TEK KAYNAK (kullanıcı kararı, 16 Eyl 2026).
 *
 * Sayfalar arasında gezerken başlıklar farklı boydaydı: Favoriler 3xl/4xl
 * extrabold, Rezervasyonlar 2xl/3xl bold, Siparişlerim 2xl semibold, Takvim
 * xl semibold. Her sayfa kendi sınıfını yazınca sürüklenme kaçınılmazdı.
 *
 * Sayfaya özgü boşluk (`mb-*`, `mt-*`) burada DEĞİL; sayfa kendi ritmini
 * ekler. Bölüm başlıkları (vitrin şeridi, kart başlıkları) bu sabiti
 * kullanmaz — onlar sayfa başlığından bilerek küçüktür.
 */
export const SAYFA_BASLIGI =
  // 17 Eyl 2026: masaüstü ölçüsü Preply'dan (32px / 36px, 700); telefonda 24px.
  "text-2xl font-bold leading-8 tracking-tight text-slate-900 sm:text-[32px] sm:leading-9";
