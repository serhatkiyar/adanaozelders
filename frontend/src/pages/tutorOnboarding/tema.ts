/**
 * İlan sihirbazının görsel teması.
 *
 * ## Karar (5 Eylül 2026, kullanıcı)
 *
 * Sihirbaz Superprof'un ilan oluşturma akışının DÜZENİNİ alıyor: dolgulu
 * bilgi kartı, kalın başlıklar, tek sütun akış. Bu, `docs/tasarim-dili.md`nin
 * iki kuralını (kart enflasyonu yasağı ve "en ağır font-semibold") bu ekranlar
 * için BİLEREK deliyor. Gerekçe orada, "Ek A" bölümünde yazılı.
 *
 * ## RENK ARTIK SİTENİN KENDİSİ (kullanıcı kararı, 7 Eyl 2026)
 *
 * Bu dosya 5 Eyl'de mercan bir hex ailesi (`#F2695E`) taşıyordu; sihirbaz
 * sitenin geri kalanından ayrı bir renk rejimiydi. Kullanıcı ekranı görüp
 * *"orada renkler turuncu değil kırmızı"* dedi ve haklıydı: ilan oluşturma
 * markanın en kritik akışı, orada başka bir marka rengi görünüyordu.
 *
 * Ham hex'lerin tamamı kalktı; her değer marka token'ına bağlandı. Kazanç
 * yalnız görsel değil: bundan sonra `scripts/marka-tonu.mjs` ile yapılan her
 * ton değişimi sihirbaza da uygulanır, ayrıca güncellenmesi gerekmez.
 *
 * `MERCAN` adı çağrı yerlerini kırmamak için KORUNDU; artık "sihirbazın aksan
 * kümesi" anlamına geliyor.
 *
 * Nöbetçi: `src/__guards__/sihirbazMercani.test.ts` — sihirbaz ağacında ham
 * hex kalmadığını ve değerlerin marka token'ı olduğunu çıpalar.
 */

/** Aksan: birincil düğme, ilerleme şeridi, başlıktaki vurgulu sözcük. */
export const MERCAN = {
  /** Dolgu (birincil düğme, ilerleme şeridi). */
  zemin: "bg-marka",
  zeminHover: "hover:bg-marka-hover",
  /** Metin (başlıktaki vurgulu sözcük, ikincil düğme yazısı).
   *  Dolgu token'ı DEĞİL: `--marka` beyaz zeminde 2,38 verir ve okunmaz. */
  metin: "text-marka-metin",
  /** Kenarlık (ikincil/hap düğme). */
  kenar: "border-marka-mid",
  /** Odak halkası: klavye erişimi için görünür kalmalı. */
  halka: "focus-visible:ring-marka-focus",
} as const;

/** Dolgunun ÜSTÜNDEKİ yazı. Turuncu dolgu parlak, yazı koyu (ÜK-1). */
export const DOLGU_YAZI = "text-marka-fg";

/** Seçili segment düğmesi (ders şekli gibi az seçenekli alanlar). */
export const SECILI_SEGMENT =
  "border-marka-mid bg-marka-soft font-medium text-marka-metin";

/** Bilgi kartının yumuşak zemini ve kenarlığı. */
export const BILGI = {
  zemin: "bg-marka-soft",
  kenar: "border-marka-line",
  baslik: "text-marka-metin",
  metin: "text-marka-metin-hover",
} as const;
