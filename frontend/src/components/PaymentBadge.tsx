import { PaymentStatus, type Payment } from "@/types";

const STYLE: Record<PaymentStatus, string> = {
  [PaymentStatus.PENDING]:
    "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  [PaymentStatus.HELD]:
    "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  [PaymentStatus.RELEASED]:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  [PaymentStatus.REFUNDED]:
    "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  [PaymentStatus.FAILED]:
    "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
};

const LABEL: Record<PaymentStatus, string> = {
  [PaymentStatus.PENDING]: "Ödeme bekliyor",
  [PaymentStatus.HELD]: "Ödendi (emanette)",
  [PaymentStatus.RELEASED]: "Ödeme tamamlandı",
  [PaymentStatus.REFUNDED]: "İade edildi",
  [PaymentStatus.FAILED]: "Ödeme başarısız",
};

export function PaymentBadge({ payment }: { payment: Payment }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${STYLE[payment.status]}`}
    >
      💳 {LABEL[payment.status]}
    </span>
  );
}
