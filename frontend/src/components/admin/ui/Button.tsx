import { forwardRef, type ButtonHTMLAttributes } from "react";

import { PlainButton } from "@/components/ui/PlainButton";

type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isPending?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  // ── İP-B2 · Ç-3: aksan token'a bağlandı ──
  //
  // Eskiden `bg-indigo-600 text-white`ti. İki ayrı sebeple token'a taşındı:
  //
  //   1. Marka kararı (`#1A365D`) tek noktadan uygulanabilsin — panelin en
  //      çok tekrar eden düğmesi burasıdır ve ekran başına elle çevrilseydi
  //      göç etmemiş 21 liste ekranı indigo kalırdı.
  //   2. `text-white` KOYU TEMADA YANLIŞTI ve bugüne dek görülmedi: koyu
  //      temada aksan açık bir lacivert (`#8AB0DE`) ve beyaz metin orada
  //      **1,35** kontrast verir. `indigo-600` koyu temada da koyu kaldığı
  //      için kusur gizliydi; token'a geçince görünür oldu ve `accent-fg`
  //      ile kapandı (koyu temada `slate-950`, ölçülen **8,98**).
  primary: "bg-panel-accent text-panel-accent-fg shadow-sm hover:bg-panel-accent/90",
  secondary: "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
  // Tamamlama/olumlu sonuç aksiyonları (ör. "Turu Tamamla") — !important
  // kaçışlarıyla primary'yi ezmek yerine sistem varyantı.
  //
  // ── `emerald-600` → `emerald-700` (İP-A8 · Görev 6 · B-8) ──
  //
  // Beyaz metin `emerald-600` üzerinde **3,77:1**di; AA eşiği 4,5 ve buradaki
  // metin 14 px (büyük metin muafiyeti YOK). İki temada da eşik altındaydı ve
  // panelde 10 gerçek çağrı yeri vardı. Kontrast sondaları o güne dek yalnız
  // HATA METNİNE bakıyordu; düğme metni hiçbir tur raporunda ölçülmemişti
  // (bağımsız denetim #3 · B-8). `emerald-700` gerçek Chrome'da **5,48:1**.
  success: "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800",
  danger: "bg-rose-600 text-white shadow-sm hover:bg-rose-700",
  ghost: "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 rounded-lg px-3 text-xs",
  md: "min-h-10 rounded-xl px-4 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", isPending = false, disabled, className = "", children, type = "button", ...props },
  ref
) {
  return (
    <PlainButton
      ref={ref}
      type={type}
      disabled={disabled || isPending}
      aria-busy={isPending || undefined}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-950 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {isPending && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </PlainButton>
  );
});
