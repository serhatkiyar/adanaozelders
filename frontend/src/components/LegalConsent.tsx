import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";

// Yasal onay bileşenleri. Yalnız route/link tüketir (legalContent'i import etmez)
// → kayıt formu ve ödeme yüzeyleri gibi sık yüklenen chunk'ları şişirmez.

const linkCls =
  "font-semibold text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400";

/**
 * Kayıt formlarındaki zorunlu KVKK/koşul onayı. `required` checkbox olduğundan
 * tarayıcı, işaretlenmeden formun gönderilmesini engeller; ayrıca state gerekmez.
 */
export function ConsentCheckbox() {
  return (
    <label className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
      <input
        type="checkbox"
        required
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700"
      />
      <span>
        <Link to={ROUTES.kvkk} target="_blank" className={linkCls}>
          KVKK Aydınlatma Metni
        </Link>
        'ni okudum;{" "}
        <Link to={ROUTES.terms} target="_blank" className={linkCls}>
          Kullanım Koşulları
        </Link>
        'nı ve{" "}
        <Link to={ROUTES.privacy} target="_blank" className={linkCls}>
          Gizlilik Politikası
        </Link>
        'nı kabul ediyorum. <span className="text-red-500">*</span>
      </span>
    </label>
  );
}

/** Ödeme butonlarının yanındaki sözleşme bilgilendirmesi (mesafeli satış + iade). */
export function PaymentConsentNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] leading-relaxed text-slate-400 dark:text-slate-500 ${className}`}>
      Ödemeye geçerek{" "}
      <Link to={ROUTES.distanceSales} target="_blank" className="underline underline-offset-2 hover:text-slate-600 dark:hover:text-slate-300">
        Mesafeli Satış Sözleşmesi
      </Link>
      'ni ve{" "}
      <Link to={ROUTES.refundPolicy} target="_blank" className="underline underline-offset-2 hover:text-slate-600 dark:hover:text-slate-300">
        İptal ve İade Politikası
      </Link>
      'nı kabul etmiş olursun.
    </p>
  );
}
