/**
 * Eğitmen panosu ölçüleri — Preply ayarlar/panel ekranlarının hesaplanmış
 * CSS değerlerinden alındı (17 Eyl 2026, kullanıcı isteği: "yazı boyutları
 * onlarda güzel, bizde küçük"). Renk markamızdır; yazı tipi proje kuralı
 * gereği değişmez (gövde Inter, `index.css`).
 *
 *   Sayfa başlığı  32px / 36px, 700
 *   Bölüm başlığı  20px / 24px, 600
 *   Gövde, etiket  16px / 24px — etiket 600, açıklama 400 ikincil renk
 *   Düğme          48px yükseklik, 18px / 600, 8px köşe (satır içi: 40px, 16px)
 *   Kart           gölgesiz, 1px çerçeve, 8px köşe, 24px iç boşluk
 */
// Sayfa başlığı tek kaynaktan (`lib/tipografi.ts`, 16 Eyl 2026 kararı).
export { SAYFA_BASLIGI } from "@/lib/tipografi";
export const BOLUM_BASLIGI = "text-xl font-semibold leading-6 text-slate-900";
export const ETIKET = "text-base font-semibold leading-6 text-slate-900";
export const ACIKLAMA = "text-base leading-6 text-slate-600";
export const KUCUK_ACIKLAMA = "text-sm leading-5 text-slate-600";

export const KART = "rounded-lg border border-slate-200 bg-white p-6";

const DUGME_TABAN =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";

/** 48px — sayfanın ana eylemi. */
export const DUGME_BIRINCIL = `${DUGME_TABAN} h-12 bg-marka px-6 text-lg text-marka-fg hover:bg-marka-hover`;
export const DUGME_IKINCIL = `${DUGME_TABAN} h-12 border-2 border-slate-200 bg-white px-6 text-lg text-slate-900 hover:border-slate-900`;

/** 40px — liste satırı içindeki eylemler. */
export const DUGME_SATIR_BIRINCIL = `${DUGME_TABAN} h-10 bg-marka px-4 text-base text-marka-fg hover:bg-marka-hover`;
export const DUGME_SATIR_IKINCIL = `${DUGME_TABAN} h-10 border-2 border-slate-200 bg-white px-4 text-base text-slate-900 hover:border-slate-900`;
export const DUGME_SATIR_TEHLIKE = `${DUGME_TABAN} h-10 border-2 border-slate-200 bg-white px-4 text-base text-red-700 hover:border-red-700`;

export const METIN_BAGLANTI =
  "text-base font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900";
