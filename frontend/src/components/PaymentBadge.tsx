import { PaymentStatus, type Payment } from "@/types";

const STYLE: Record<PaymentStatus, string> = {
  [PaymentStatus.PENDING]:
    "bg-amber-50 text-amber-700 ",
  [PaymentStatus.HELD]:
    "bg-sky-50 text-sky-700 ",
  [PaymentStatus.RELEASED]:
    "bg-emerald-50 text-emerald-700 ",
  [PaymentStatus.REFUNDING]:
    "bg-amber-50 text-amber-700 ",
  [PaymentStatus.REFUNDED]:
    "bg-slate-100 text-slate-600 ",
  [PaymentStatus.FAILED]:
    "bg-rose-50 text-rose-700 ",
};

const LABEL: Record<PaymentStatus, string> = {
  [PaymentStatus.PENDING]: "Ödeme bekliyor",
  [PaymentStatus.HELD]: "Ödendi (emanette)",
  [PaymentStatus.RELEASED]: "Ödeme tamamlandı",
  [PaymentStatus.REFUNDING]: "İade ediliyor",
  [PaymentStatus.REFUNDED]: "İade edildi",
  [PaymentStatus.FAILED]: "Ödeme başarısız",
};

// CANCELLED gibi normalize edilmiş ek durumlar için yedek (PaymentStatus dışı).
const FALLBACK = "bg-slate-100 text-slate-600 ";

export function PaymentBadge({ payment }: { payment: Payment }) {
  return <PaymentStatusBadge status={payment.status} />;
}

/** Yalnız durumdan rozet — Bakiye işlem dökümünde de kullanılır. */
export function PaymentStatusBadge({ status }: { status: PaymentStatus | string }) {
  const cls = STYLE[status as PaymentStatus] ?? FALLBACK;
  const label = LABEL[status as PaymentStatus] ?? "İptal";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      💳 {label}
    </span>
  );
}
