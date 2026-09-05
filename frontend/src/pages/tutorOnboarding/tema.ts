/**
 * İlan sihirbazının görsel teması — YALNIZ bu sayfa için.
 *
 * ## Karar (5 Eylül 2026, kullanıcı)
 *
 * Sihirbaz Superprof'un ilan oluşturma akışının görünüşünü alıyor: mercan
 * aksan, dolgulu bilgi kartı, kalın başlıklar. Bu, `docs/tasarim-dili.md`nin
 * iki kuralını (kart enflasyonu yasağı ve "en ağır font-semibold") bu ekranlar
 * için BİLEREK deliyor. Gerekçe orada, "Ek A" bölümünde yazılı.
 *
 * ## Renk neden Tailwind token'ı DEĞİL
 *
 * `tailwind.config.js`e bir `mercan` ailesi eklemek rengi tüm siteden
 * erişilebilir kılardı ve panel token ailesiyle (`panel-accent` = marka
 * laciverti) karışırdı. Karar tek sayfalık; kapsamı da tek dosyada tutuyoruz.
 * Sınıflar TAM DİZE olarak yazılır (parçalanmış `bg-[${x}]` Tailwind'in
 * tarayıcısı tarafından görülmez ve sessizce hiçbir şey üretmez).
 *
 * Sızmanın nöbetçisi: `src/__guards__/sihirbazMercani.test.ts` — bu hex'in
 * her geçtiği yer `src/pages/tutorOnboarding/` altında olmak zorunda.
 */

/** Aksan — birincil düğme, ilerleme şeridi, başlıktaki vurgulu sözcük. */
export const MERCAN = {
  /** Dolgu (birincil düğme, ilerleme şeridi). */
  zemin: "bg-[#F2695E]",
  zeminHover: "hover:bg-[#E05548]",
  /** Metin (başlıktaki vurgulu sözcük, ikincil düğme yazısı). */
  metin: "text-[#F2695E]",
  /** Kenarlık (ikincil/hap düğme). */
  kenar: "border-[#F2695E]",
  /** Odak halkası — klavye erişimi için görünür kalmalı. */
  halka: "focus-visible:ring-[#F2695E]",
} as const;

/** Seçili segment düğmesi (ders şekli gibi az seçenekli alanlar). */
export const SECILI_SEGMENT =
  "border-[#F2695E] bg-[#FDEFEE] font-medium text-[#B33A2E]";

/** Bilgi kartının yumuşak pembe zemini ve kenarlığı. */
export const BILGI = {
  zemin: "bg-[#FDEFEE]",
  kenar: "border-[#FBDCD9]",
  baslik: "text-[#B33A2E]",
  metin: "text-[#7A3B34]",
} as const;
