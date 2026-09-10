/**
 * Fotoğrafın ÜSTÜNDE duran dairesel düğme — **TEK KAYNAK**.
 *
 * ## Neden ayrı bir dosya
 *
 * Eğitmen profilinin mobil hero'sunda üç eylem yan yana duruyor: geri, paylaş
 * ve favori. Üçü üç ayrı bileşende yaşıyor (`PlainButton`, `ShareButton`,
 * `BookmarkButton`) ve daire tanımı her birine ayrı ayrı yazılsaydı
 * `DaireDugme`nin doğmasına yol açan hatanın aynısı tekrar ederdi: aynı satırda
 * üç farklı daire.
 *
 * ## Neden `ui/DaireDugme` değil
 *
 * O bileşen gri zeminli bir KAYDIRMA OKU (`bg-slate-100`, `md:h-7 md:w-7`) ve
 * çıktısı `HScroll`/`ScrollableRow` için birebir çıpalanmış durumda
 * (`__guards__/daireDugmeTekligi.test.tsx`). Fotoğraf üstündeki beyaz/buzlu çip
 * onun sözleşmesine girmiyor; oraya bir varyant eklemek iki ayrı işi tek
 * bileşene yıkardı.
 *
 * ## Ölçü
 *
 * 44px — proje dokunma hedefi eşiği (`scripts/anasayfa_mobil_turu.mjs`,
 * `HEDEF_EN_AZ`). Burada kabuk ile görünen daire AYNIDIR (`DaireDugme`deki
 * "kabuk 44 ama zeminsiz" ayrımı yok): düğme fotoğrafın üstünde duruyor ve
 * zemini onu okunur kılan şeyin ta kendisi. Beyazın saydamlığı (`/90`) altındaki
 * fotoğrafı hissettirir ama ikonu her zaman taşır.
 */
export const GORSEL_USTU_DAIRE =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full " +
  "bg-white/90 text-slate-900 shadow-md backdrop-blur-sm transition " +
  "hover:bg-white active:scale-90";
