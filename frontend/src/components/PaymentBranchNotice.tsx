import { closedBranchMessage, type PaymentBranch } from "@/lib/paymentAvailability";

/**
 * Kapalı bir ödeme kolu için kullanıcıya gösterilen nötr bilgi şeridi.
 *
 * Ödeme butonunun YERİNE geçer — butonu bırakıp tıklandığında 503 göstermek
 * kullanıcıyı boşa yönlendirir. Metin "emanet/escrow" vaadi içermez
 * (`lib/paymentAvailability` testi bunu doğrular).
 *
 * Renk seçimi bilinçli: bu bir hata değil, planlı bir durum — amber (uyarı)
 * yeterli, rose (hata) yanlış sinyal verir.
 */
export function PaymentBranchNotice({
  branch,
  className = "",
}: {
  branch: PaymentBranch;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={`rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30 ${className}`}
    >
      {closedBranchMessage(branch)}
    </p>
  );
}
