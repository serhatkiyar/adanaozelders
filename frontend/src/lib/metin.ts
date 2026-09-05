/**
 * Metin kalite ölçüleri — sunucudaki `core/text.py` ile TEK sözleşme.
 *
 * Neden ayrı dosya: kelime sayımı ve başlık eşiği önce yalnız
 * `TutorSettings.tsx` içinde, satır içi ve elle kopyalanmış bir sabitle
 * yaşıyordu. İlan sihirbazı aynı kuralı üçüncü kez kopyalayacaktı; iki kopya
 * sessizce ayrıştığında kullanıcı formu doldurup gönderirken 422 yer ve
 * ekranda neden reddedildiğini gösteren bir iz kalmaz.
 */

/** `core/text.py::HEADLINE_MIN_WORDS` ile aynı olmalı. */
export const BASLIK_EN_AZ_KELIME = 10;

/**
 * `core/text.py::count_words`'ün eşleniği.
 *
 * Sunucu `text.split()` kullanır (tüm boşluk çeşitleri, baş/son boşluk
 * yutulur); `trim().split(/\s+/)` bunun birebir karşılığıdır.
 */
export function kelimeSay(metin: string | null | undefined): number {
  const t = (metin ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Alan altındaki canlı sayaç metni.
 *
 * Superprof'un ilan sihirbazında her uzun metin alanının altında bir kelime
 * sayacı var ("En az N sözcük") — kullanıcı reddedilmeden önce ne kadar
 * eksiği olduğunu görüyor. Aynı geri bildirimi veriyoruz.
 */
export function kelimeSayaci(
  metin: string,
  enAz: number,
  ipucu?: string,
): { yeterli: boolean; sayi: number; metin: string } {
  const sayi = kelimeSay(metin);
  const yeterli = sayi >= enAz;
  return {
    yeterli,
    sayi,
    // "gerekli" DEĞİL "öneriyoruz": 5 Eyl 2026'dan beri kelime eşiği ilerlemeyi
    // kesmiyor (kullanıcı kararı). Kesmeyen bir kuralı zorunlulukmuş gibi
    // yazmak, kullanıcıyı olmayan bir duvara karşı hazırlar.
    metin: yeterli
      ? `${sayi} sözcük`
      : `${sayi} sözcük — en az ${enAz} öneriyoruz.${ipucu ? ` ${ipucu}` : ""}`,
  };
}
