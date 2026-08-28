import type { HTMLAttributes } from "react";

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * ── İP-B2 · Ç-3: iki ton token'a bağlandı, üçü ham kaldı ──
 *
 * `info` marka aksanını taşır (`--panel-accent-soft` / `--panel-accent`);
 * `warning` ise **dikkat rengini** (`#F6AD55`) taşır. İkisinin de `dark:`
 * ikizi SİLİNDİ — token zaten temaya duyarlı ve ikinci yazım her seferinde
 * unutulabilecek bir borçtu (`AdminStore.tsx:1958` bir kez unutulmuştu).
 *
 * `success`/`danger`/`neutral` ham Tailwind ölçeğinde KALDI ve bu bilinçli:
 * bunlar marka değil **anlam** renkleridir (yeşil "oldu", kırmızı "olmadı")
 * ve marka değişse de değişmezler. Tasarım dili §1.3'ün kuralı "renk = sadece
 * aksiyon"dur; durum renkleri rozete kilitlidir ve o kilit burasıdır.
 *
 * Neden turuncu AKSAN değil DİKKAT (Ç-3): birincil düğme turuncu olsaydı aynı
 * ekranda hem "yap" hem "dikkat et" anlamına gelirdi. Turuncu artık yalnız
 * bekleyen iş ve uyarı durumlarında görünür.
 *
 * Ölçülen kontrast (gerçek Chrome): açık temada `#7C2D12` metin / `#FDF1E1`
 * zemin = **8,41**; koyu temada `#F6AD55` metin / `#422006` zemin = **7,65**.
 * Eski `amber-50`/`amber-800` çifti 8,9 idi — yani okunabilirlik korundu.
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
