/**
 * Canlı ders odasının düğme varyantları — Meet `buttonRecipe` karşılığı
 * (La Suite Meet, MIT — DINUM/Etalab). Panda/cva yok; `as const` eşlemeler
 * ve `ders-*` Tailwind token'ları. Oda yüzeyi koyudur ama bu bir tema değil:
 * `dark:` varyantı kullanılmaz.
 */
export const DUGME_TABANI =
  "inline-flex shrink-0 items-center justify-center gap-2 border border-transparent font-medium transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marka-focus disabled:cursor-default disabled:opacity-60";

/** Oda içi (kontrol çubuğu): kare, 4px köşe, 46px (Meet `size: default` + `square`). */
export const ODA_DUGMESI = {
  boyut: "h-[46px] w-[46px] rounded",
  /** Meet `primaryDark` */
  acik: "bg-ders-dugme text-white hover:bg-ders-hover",
  /** Meet `error2` — cihaz kapalı */
  kapali: "bg-ders-hata text-ders-hata-fg hover:bg-ders-hata-hover",
  /** Meet `danger` — Ayrıl */
  tehlike: "bg-ders-tehlike text-white hover:bg-ders-tehlike-hover",
  /** Meet `primaryDark` + `isSelected` — etkin geçiş (ör. ekran paylaşılıyor) */
  secili: "bg-ders-secili text-ders-secili-fg hover:bg-white",
  /** Meet `primaryTextDark` — çekmece öğeleri */
  metin: "bg-transparent text-white hover:bg-ders-dugme",
} as const;

/** Önizleme üstündeki yuvarlak düğmeler (Meet `whiteCircle` / `errorCircle`). */
export const ONIZLEME_DUGMESI = {
  boyut: "h-14 w-14 rounded-full",
  acik: "border-white bg-transparent text-white hover:bg-white/20",
  kapali: "bg-ders-tehlike text-white hover:bg-ders-tehlike-hover",
} as const;

/** Telefon çubuğu: ikon üstte, etiket altta. */
export const TELEFON_DUGMESI = {
  kutu: "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-ders px-1 py-1.5 text-xs text-white",
  ikon: "inline-flex h-11 w-11 items-center justify-center rounded-full",
} as const;
