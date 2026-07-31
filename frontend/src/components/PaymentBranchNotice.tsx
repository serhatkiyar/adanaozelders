import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { closedBranchMessage, type PaymentBranch } from "@/lib/paymentAvailability";

/**
 * Kapalı bir ödeme kolu için kullanıcıya gösterilen nötr bilgi şeridi.
 *
 * Metni **sunucudan** alır (`GET /payments/availability` → `message`); yerel
 * tablo yalnız uygunluk bilgisi hiç gelmediğinde (fail-closed hâli) yedektir.
 * İki kaynakta metin tutmak, biri değiştiğinde diğerinin sessizce eskimesine
 * yol açar.
 *
 * `role="status"` **kullanılmaz**: bu canlı bir duyuru değil, statik bir
 * açıklamadır — ve listelerde her satırda bir tane basılırsa ekran okuyucu aynı
 * cümleyi N kez duyurur. Devre dışı bir butonun sebebini bildirmek için butona
 * `aria-describedby={id}` verilir (devre dışı buton çoğu tarayıcıda odak
 * sırasından çıkar, yoksa sebep klavye kullanıcısına hiç ulaşmaz).
 *
 * Renk bilinçli amber: bu bir hata değil, planlı bir durum — rose yanlış
 * sinyal verir.
 */
export function PaymentBranchNotice({
  branch,
  id,
  className = "",
}: {
  branch: PaymentBranch;
  id?: string;
  className?: string;
}) {
  const { data: availability } = usePaymentAvailability();
  const row = availability?.branches.find((b) => b.branch === branch);
  const text = row?.message ?? closedBranchMessage(branch);

  return (
    <p
      id={id}
      className={`rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30 ${className}`}
    >
      {text}
    </p>
  );
}
