import type { HTMLAttributes } from "react";

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * ── İP-B2 · Ç-3: iki ton token'a bağlandı, üçü ham kaldı ──
 *
 * `info` marka aksanını taşır (`--panel-accent-soft` / `--panel-accent`);
 * `warning` ise **dikkat rengini** (`--dikkat`, bugün `amber-500`) taşır.
 * (Tarihçe: Ç-3'te `#F6AD55`ti; Ç-4'te aksan turuncuya geçince dikkat ailesi
 *  amber'a çekildi — iki turuncu birbirine fazla yakındı.) İkisinin de `dark:`
 * ikizi SİLİNDİ — token zaten temaya duyarlı ve ikinci yazım her seferinde
 * unutulabilecek bir borçtu (`AdminStore.tsx:1958` bir kez unutulmuştu).
 *
 * `success`/`danger`/`neutral` ham Tailwind ölçeğinde KALDI ve bu bilinçli:
 * bunlar marka değil **anlam** renkleridir (yeşil "oldu", kırmızı "olmadı")
 * ve marka değişse de değişmezler. Tasarım dili §1.3'ün kuralı "renk = sadece
 * aksiyon"dur; durum renkleri rozete kilitlidir ve o kilit burasıdır.
 *
 * Ç-3'ün endişesi ("birincil düğme turuncu olsaydı aynı ekranda hem 'yap' hem
 * 'dikkat et' anlamına gelirdi") Ç-4'te ORTADAN KALKMADI — çözüm değişti:
 * aksan da uyarı da turuncu ailesinden, ama BİÇİMLERİ zıt. Aksan koyu dolgu +
 * açık metin taşır; bu rozet açık zemin + koyu metin taşır ve ASLA dolgulu
 * düğme olmaz. Nöbetçi: `__guards__/markaAksani.test.ts`.
 *
 * Ölçülen kontrast (gerçek Chrome · docs/ip-c4/kontrast.json):
 * `#78350F` metin / `#FEF3C7` zemin = **8,15**. (Ç-3'te `#7C2D12`/`#FDF1E1`
 * çifti 8,41'di; eski `amber-50`/`amber-800` 8,9 — okunabilirlik korundu.)
 */
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ",
  info: "bg-panel-accent-soft text-panel-accent",
  success: "bg-emerald-50 text-emerald-700 ",
  warning: "bg-panel-attention-soft text-panel-attention-fg",
  danger: "bg-rose-50 text-rose-700 ",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className = "", ...props }: BadgeProps) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]} ${className}`} {...props} />;
}
