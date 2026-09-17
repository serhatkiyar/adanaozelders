import { BalanceView, PayoutSummaryCard } from "@/pages/Balance";
import { useEarnings, useEarningsTransactions } from "@/hooks/usePayments";
import { useMyPayout } from "@/hooks/usePayout";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { FullScreenSpinner } from "@/components/Spinner";
import { TUTOR_NAV } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";
import { Navigate } from "react-router-dom";

/**
 * Eğitmen kazanç dökümü. Eski "Bakiyem" sekmesinin yerini alır; panodaki özet
 * kartlarından açılır. Operatörün "Bakiyem" görünümü değişmedi.
 */
export default function TutorEarnings() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  if (userLoading || !user) return <FullScreenSpinner />;
  // Kütüphane operatörü kendi "Bakiyem" ekranına; diğer roller ana sayfaya.
  if (user.role_id === ROLE_IDS.LIBRARY_OPERATOR) return <Navigate to={ROUTES.balance} replace />;
  if (user.role_id !== ROLE_IDS.TUTOR) return <Navigate to={ROUTES.home} replace />;
  return <TutorEarningsView />;
}

function TutorEarningsView() {
  const { data: summary, isLoading } = useEarnings();
  const {
    data: txns,
    isLoading: txnLoading,
    isError: txnError,
    refetch: txnRefetch,
  } = useEarningsTransactions();
  const { data: payout } = useMyPayout();

  return (
    <BalanceView
      navItems={TUTOR_NAV}
      title="Kazançlar"
      description="Derslerinden kazandıkların ve işlem dökümün. Ödemeler kayıtlı IBAN'ına banka havalesiyle yapılır."
      netLabel="Hesabına geçen"
      netHint="Tamamlanan derslerden, komisyon düşülmüş"
      sade
      loading={isLoading}
      net={summary?.released}
      escrow={summary?.pending}
      thisMonth={summary?.this_month}
      refunded={summary?.refunded}
      escrowLabel="Hesabına geçecek"
      escrowHint="Ders bitince hesabına geçer"
      transactions={txns}
      txnLoading={txnLoading}
      txnError={txnError}
      onRetryTransactions={() => void txnRefetch()}
      payout={
        <PayoutSummaryCard
          status={payout?.payout_status ?? "NONE"}
          ibanMasked={payout?.iban_masked}
        />
      }
    />
  );
}
