import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { PaymentStatusBadge } from "@/components/PaymentBadge";
import { useEarnings, useEarningsTransactions } from "@/hooks/usePayments";
import { useMyPayout } from "@/hooks/usePayout";
import {
  useLibraryEarnings,
  useLibraryEarningsTransactions,
} from "@/hooks/useLibraries";
import { useOperatorMe } from "@/hooks/useLibraryExams";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchLibraryPayout } from "@/api/libraries";
import { TUTOR_NAV } from "@/lib/nav";
import { formatTRY } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/routes";
import { FullScreenSpinner } from "@/components/Spinner";
import { ROLE_IDS, type EarningTransaction, type PayoutStatus } from "@/types";
import type { NavItem } from "@/lib/nav";
import type { ReactNode } from "react";

const PAYOUT_STATUS_META: Record<PayoutStatus, { label: string; cls: string }> = {
  NONE: {
    label: "Eklenmedi",
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  },
  PENDING: {
    label: "Doğrulama bekleniyor",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  ACTIVE: {
    label: "Doğrulandı ✓",
    cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  REJECTED: {
    label: "Reddedildi",
    cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  },
};

/** Bakiyem'de ödeme hesabının yalnız özetini gösterir; düzenleme Ayarlar'da. */
function PayoutSummaryCard({
  status,
  ibanMasked,
}: {
  status: PayoutStatus;
  ibanMasked?: string | null;
}) {
  const meta = PAYOUT_STATUS_META[status];
  return (
    <div className="rounded-2xl bg-white px-6 py-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Ödeme hesabı
          </p>
          <p className="mt-1 font-mono text-sm text-slate-700 dark:text-slate-200">
            {ibanMasked || "Henüz IBAN eklenmedi"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
            {meta.label}
          </span>
          <Link
            to={ROUTES.settings}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {status === "NONE" ? "Ekle" : "Ayarlar'da düzenle"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function TutorPayoutSummary() {
  const { data: payout } = useMyPayout();
  return (
    <PayoutSummaryCard
      status={payout?.payout_status ?? "NONE"}
      ibanMasked={payout?.iban_masked}
    />
  );
}

function LibraryPayoutSummary({ libraryId }: { libraryId: number }) {
  const { data: payout } = useQuery({
    queryKey: ["library-payout", libraryId],
    queryFn: () => fetchLibraryPayout(libraryId),
  });
  return (
    <PayoutSummaryCard
      status={payout?.payout_status ?? "NONE"}
      ibanMasked={payout?.iban_masked}
    />
  );
}

const SOURCE_LABEL: Record<EarningTransaction["source"], string> = {
  LESSON: "Özel ders",
  EXAM: "Deneme oturumu",
  STUDY: "Çalışma alanı",
};

/** Rol göre uygun bakiye görünümünü seçen delegator. */
export default function Balance() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading || !user) return <FullScreenSpinner />;
  if (user.role_id === ROLE_IDS.TUTOR) return <TutorBalance />;
  if (user.role_id === ROLE_IDS.LIBRARY_OPERATOR) return <OperatorBalance />;
  return <Navigate to={ROUTES.home} replace />;
}

/* ── Eğitmen bakiyesi ─────────────────────────────────────────────────────── */
function TutorBalance() {
  const { data: summary, isLoading: sumLoading } = useEarnings();
  const { data: txns, isLoading: txnLoading } = useEarningsTransactions();

  return (
    <BalanceView
      navItems={TUTOR_NAV}
      loading={sumLoading}
      net={summary?.released}
      escrow={summary?.pending}
      thisMonth={summary?.this_month}
      refunded={summary?.refunded}
      escrowLabel="Emanette bekleyen"
      escrowHint="Ders tamamlanınca kazancına geçer"
      transactions={txns}
      txnLoading={txnLoading}
      payout={<TutorPayoutSummary />}
    />
  );
}

/* ── Kütüphane (operatör) bakiyesi ────────────────────────────────────────── */
function OperatorBalance() {
  const { data: op, isLoading: opLoading } = useOperatorMe();
  const libraryId = op?.library_id;
  const { data: summary, isLoading: sumLoading } = useLibraryEarnings(libraryId);
  const { data: txns, isLoading: txnLoading } =
    useLibraryEarningsTransactions(libraryId);

  return (
    <BalanceView
      loading={opLoading || sumLoading}
      net={summary?.released_earning}
      escrow={summary?.held_earning}
      thisMonth={summary?.this_month_earning}
      refunded={summary?.refunded_total}
      escrowLabel="Emanette bekleyen"
      escrowHint="Katılım doğrulandıkça serbest kalır"
      transactions={txns}
      txnLoading={txnLoading}
      payout={libraryId ? <LibraryPayoutSummary libraryId={libraryId} /> : null}
    />
  );
}

/* ── Ortak görünüm ────────────────────────────────────────────────────────── */
interface BalanceViewProps {
  navItems?: NavItem[];
  loading: boolean;
  net?: string;
  escrow?: string;
  thisMonth?: string;
  refunded?: string;
  escrowLabel: string;
  escrowHint: string;
  transactions?: EarningTransaction[];
  txnLoading: boolean;
  payout: ReactNode;
}

function BalanceView({
  navItems,
  loading,
  net,
  escrow,
  thisMonth,
  refunded,
  escrowLabel,
  escrowHint,
  transactions,
  txnLoading,
  payout,
}: BalanceViewProps) {
  const refundedNum = Number(refunded ?? 0);

  return (
    <DashboardShell title="Bakiyem" navItems={navItems}>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Bakiyem
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Kazançların, emanetteki ödemeler ve tüm işlem dökümün. Para platformda
            tutulmaz; tutarlar iyzico üzerinden doğrudan IBAN'ına geçer.
          </p>
        </div>

        {/* Özet kartları */}
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 text-white shadow-sm">
              <p className="text-xs font-medium text-emerald-50">Toplam kazanç</p>
              <p className="mt-1 text-2xl font-bold">{formatTRY(net)}</p>
              <p className="mt-0.5 text-[11px] text-emerald-100">
                Tamamlanan işlemlerden net
              </p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {escrowLabel}
              </p>
              <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
                {formatTRY(escrow)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">{escrowHint}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Bu ay kazanılan
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                {formatTRY(thisMonth ?? "0")}
              </p>
              {refundedNum > 0 && (
                <p className="mt-0.5 text-[11px] text-slate-400">
                  İade edilen: {formatTRY(refunded)}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Ödeme hesabı */}
        {payout}

        {/* İşlem dökümü */}
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              İşlem Dökümü
            </h2>
          </div>

          {txnLoading ? (
            <div className="space-y-2 p-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/50"
                />
              ))}
            </div>
          ) : !transactions || transactions.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
              Henüz bir işlem yok. İlk ödeme alındığında burada görünecek.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    <th className="px-6 py-3 font-medium">Tarih</th>
                    <th className="px-6 py-3 font-medium">İşlem</th>
                    <th className="px-6 py-3 text-right font-medium">Tutar</th>
                    <th className="px-6 py-3 text-right font-medium">Komisyon</th>
                    <th className="px-6 py-3 text-right font-medium">Net</th>
                    <th className="px-6 py-3 font-medium">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {transactions.map((t) => (
                    <tr
                      key={`${t.source}-${t.id}`}
                      className="text-slate-700 dark:text-slate-200"
                    >
                      <td className="whitespace-nowrap px-6 py-3 text-xs text-slate-500 dark:text-slate-400">
                        {formatDateTime(t.occurred_at ?? t.created_at)}
                      </td>
                      <td className="px-6 py-3">
                        <p className="font-medium text-slate-800 dark:text-slate-100">
                          {t.title}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          {SOURCE_LABEL[t.source]}
                          {t.counterparty ? ` · ${t.counterparty}` : ""}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums">
                        {formatTRY(t.gross)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums text-slate-400">
                        −{formatTRY(t.commission)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatTRY(t.net)}
                      </td>
                      <td className="px-6 py-3">
                        <PaymentStatusBadge status={t.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
