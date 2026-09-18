import { Link, Navigate } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { PaymentStatusBadge } from "@/components/PaymentBadge";
import { LibraryPayoutForm } from "@/components/LibraryPayoutForm";
import {
  useLibraryEarnings,
  useLibraryEarningsTransactions,
} from "@/hooks/useLibraries";
import { useOperatorMe } from "@/hooks/useLibraryExams";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { OPERATOR_NAV } from "@/lib/nav";
import { formatTRY } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/routes";
import { FullScreenSpinner } from "@/components/Spinner";
import { ErrorState } from "@/components/admin/ui/PageState";
import { ISLEM_TAVANI, kesildiMi } from "@/lib/operatorAgenda";
import { ROLE_IDS, type EarningTransaction, type PayoutStatus } from "@/types";
import type { NavItem } from "@/lib/nav";
import type { ReactNode } from "react";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_SATIR_IKINCIL,
  ETIKET,
  KART,
  KUCUK_ACIKLAMA,
  SAYFA_BASLIGI,
} from "@/components/pano/stil";

const PAYOUT_STATUS_META: Record<PayoutStatus, { label: string; cls: string }> = {
  NONE: {
    label: "Eklenmedi",
    cls: "bg-slate-100 text-slate-700",
  },
  PENDING: {
    label: "Doğrulama bekleniyor",
    cls: "bg-amber-50 text-amber-800",
  },
  ACTIVE: {
    label: "Doğrulandı ✓",
    cls: "bg-emerald-50 text-emerald-800",
  },
  REJECTED: {
    label: "Reddedildi",
    cls: "bg-red-50 text-red-700",
  },
};

/** Bakiyem'de ödeme hesabının yalnız özetini gösterir; düzenleme Ayarlar'da. */
export function PayoutSummaryCard({
  status,
  ibanMasked,
}: {
  status: PayoutStatus;
  ibanMasked?: string | null;
}) {
  const meta = PAYOUT_STATUS_META[status];
  return (
    <div className={KART}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className={ETIKET}>Ödeme hesabı</p>
          <p className={`mt-1 break-all font-mono ${ACIKLAMA}`}>
            {ibanMasked || "Henüz IBAN eklenmedi"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${meta.cls}`}>
            {meta.label}
          </span>
          <Link
            to={ROUTES.settings}
            className={DUGME_SATIR_IKINCIL}
          >
            {status === "NONE" ? "Ekle" : "Ayarlar'da düzenle"}
          </Link>
        </div>
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<EarningTransaction["source"], string> = {
  LESSON: "Özel ders",
  EXAM: "Deneme oturumu",
  STUDY: "Çalışma alanı",
  STORE: "Mağaza satışı",
};

/** Rol göre uygun bakiye görünümünü seçen delegator. */
export default function Balance() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading || !user) return <FullScreenSpinner />;
  // Eğitmende "Bakiyem" yok; eski adres ve bildirim linkleri Kazançlar'a gider.
  if (user.role_id === ROLE_IDS.TUTOR) return <Navigate to={ROUTES.tutorEarnings} replace />;
  if (user.role_id === ROLE_IDS.LIBRARY_OPERATOR) return <OperatorBalance />;
  return <Navigate to={ROUTES.home} replace />;
}

/* ── Kütüphane (operatör) bakiyesi ────────────────────────────────────────── */
function OperatorBalance() {
  const { data: op, isLoading: opLoading } = useOperatorMe();
  const libraryId = op?.library_id;
  const { data: summary, isLoading: sumLoading } = useLibraryEarnings(libraryId);
  const {
    data: txns,
    isLoading: txnLoading,
    isError: txnError,
    refetch: txnRefetch,
  } = useLibraryEarningsTransactions(libraryId);

  return (
    <BalanceView
      navItems={OPERATOR_NAV}
      loading={opLoading || sumLoading}
      net={summary?.released_earning}
      escrow={summary?.held_earning}
      thisMonth={summary?.this_month_earning}
      refunded={summary?.refunded_total}
      escrowLabel="Emanette bekleyen"
      escrowHint="Katılım doğrulandıkça serbest kalır"
      transactions={txns}
      txnLoading={txnLoading}
      txnError={txnError}
      onRetryTransactions={() => void txnRefetch()}
      payout={
        libraryId ? (
          <div className={KART}>
            <h2 className={`mb-4 ${BOLUM_BASLIGI}`}>Ödeme Hesabı</h2>
            <LibraryPayoutForm libraryId={libraryId} />
          </div>
        ) : null
      }
    />
  );
}

/* ── Ortak görünüm ────────────────────────────────────────────────────────── */
interface BalanceViewProps {
  navItems?: NavItem[];
  /** Sayfa başlığı; operatörde "Bakiyem". */
  title?: string;
  /** Başlık altı açıklama; verilmezse havale açıklaması. */
  description?: ReactNode;
  netLabel?: string;
  netHint?: string;
  /** Nötr özet kartları (eğitmen Kazançlar). Operatör görünümü değişmez. */
  sade?: boolean;
  loading: boolean;
  net?: string;
  escrow?: string;
  thisMonth?: string;
  refunded?: string;
  escrowLabel: string;
  escrowHint: string;
  transactions?: EarningTransaction[];
  txnLoading: boolean;
  /** İşlem dökümü sorgusu patladı mı — boş listeden AYRI gösterilir. */
  txnError: boolean;
  onRetryTransactions: () => void;
  payout: ReactNode;
}

export function BalanceView({
  navItems,
  title = "Bakiyem",
  description,
  netLabel = "Toplam kazanç",
  netHint = "Tamamlanan işlemlerden net",
  sade = false,
  loading,
  net,
  escrow,
  thisMonth,
  refunded,
  escrowLabel,
  escrowHint,
  transactions,
  txnLoading,
  txnError,
  onRetryTransactions,
  payout,
}: BalanceViewProps) {
  const refundedNum = Number(refunded ?? 0);

  return (
    <DashboardShell title={title} navItems={navItems} genislik="orta">
      <div className="space-y-6">
        <div>
          <h1 className={SAYFA_BASLIGI}>{title}</h1>
          {/* Eski metin "tutarlar iyzico üzerinden doğrudan IBAN'ına geçer"
              diyordu; kurulu mekanizma bu DEĞİL. Hakediş defteri admin
              tarafındadır ve ödeme banka havalesiyle elle yapılır
              (`api/routers/payouts.py`: "Ödeme banka üzerinden ELLE yapılır;
              burada yalnız defter tutulur"). Pazaryeri alt üye işyeri
              kurulmadan sağlayıcının IBAN'a doğrudan aktarması da mümkün
              değildir, yanlış vaat, ödeme gecikince güveni bozar. */}
          <p
            data-testid="bakiye-odeme-aciklamasi"
            className={`mt-2 ${ACIKLAMA}`}
          >
            {description ?? (
              <>
                Kazançların, emanetteki ödemeler ve tüm işlem dökümün. Hakedişin,
                kayıtlı IBAN'ına <b className="font-semibold">banka havalesiyle</b>{" "}
                ödenir; ödeme kaydı platformda tutulur.
              </>
            )}
          </p>
        </div>

        {/* Özet kartları */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-lg bg-slate-100"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className={KART}>
              <p className={ETIKET}>{netLabel}</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatTRY(net)}</p>
              <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>{netHint}</p>
            </div>
            <div className={KART}>
              <p className={ETIKET}>{escrowLabel}</p>
              {/* Operatörde emanet tutarı uyarı tonunda kalır (bekleyen para). */}
              <p className={`mt-2 text-2xl font-bold tabular-nums ${sade ? "text-slate-900" : "text-amber-700"}`}>
                {formatTRY(escrow)}
              </p>
              <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>{escrowHint}</p>
            </div>
            <div className={KART}>
              <p className={ETIKET}>Bu ay kazanılan</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                {formatTRY(thisMonth ?? "0")}
              </p>
              {refundedNum > 0 && (
                <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>
                  İade edilen: {formatTRY(refunded)}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Ödeme hesabı */}
        {payout}

        {/* İşlem dökümü */}
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className={BOLUM_BASLIGI}>İşlem Dökümü</h2>
          </div>

          {txnLoading ? (
            <div className="space-y-2 p-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-lg bg-slate-100 "
                />
              ))}
            </div>
          ) : txnError ? (
            // Para ekranında hatayı "işlem yok" diye göstermek, kullanıcıya
            // "hiç ödeme almamışsın" demektir. Ayrı metin, ayrı rol (alert).
            <div data-testid="islem-hata" className="p-6">
              <ErrorState
                description="İşlem dökümü yüklenemedi. Bu bir bağlantı hatasıdır; kayıtlarında bir eksilme anlamına GELMEZ."
                onRetry={onRetryTransactions}
              />
            </div>
          ) : !transactions || transactions.length === 0 ? (
            <p
              data-testid="islem-bos"
              className={`px-6 py-10 text-center ${ACIKLAMA}`}
            >
              Henüz bir işlem yok. İlk ödeme alındığında burada görünecek.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-base">
                <thead>
                  <tr className="text-left text-sm text-slate-600">
                    <th className="px-6 py-3 font-semibold">Tarih</th>
                    <th className="px-6 py-3 font-semibold">İşlem</th>
                    <th className="px-6 py-3 text-right font-semibold">Tutar</th>
                    <th className="px-6 py-3 text-right font-semibold">Komisyon</th>
                    <th className="px-6 py-3 text-right font-semibold">Net</th>
                    <th className="px-6 py-3 font-semibold">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-t border-slate-200">
                  {transactions.map((t) => (
                    <tr
                      key={`${t.source}-${t.id}`}
                      className="text-slate-900"
                    >
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">
                        {formatDateTime(t.occurred_at ?? t.created_at)}
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-slate-900">
                          {t.title}
                        </p>
                        <p className="text-sm text-slate-600">
                          {SOURCE_LABEL[t.source]}
                          {t.counterparty ? ` · ${t.counterparty}` : ""}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right tabular-nums">
                        {formatTRY(t.gross)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right tabular-nums text-slate-600">
                        −{formatTRY(t.commission)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right font-semibold tabular-nums text-slate-900">
                        {formatTRY(t.net)}
                      </td>
                      <td className="px-6 py-4">
                        <PaymentStatusBadge status={t.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sessiz kesme dürüstlüğü: sunucu kaynak başına 200 satırda kesiyor
              (`library_service`/`payment_service` earnings_transactions).
              Sayfalama bu paketin kapsamında değil; ekranın yapabileceği en
              az şey kesildiğini SÖYLEMEK, "eski bir işlem kayboldu"
              şikâyetinde yanıltıcı olmasın. */}
          {transactions && kesildiMi(transactions) && (
            <p
              data-testid="islem-tavan-uyarisi"
              className={`border-t border-slate-200 px-6 py-4 ${KUCUK_ACIKLAMA}`}
            >
              Son {ISLEM_TAVANI} işlem gösteriliyor. Daha eski kayıtlar için
              destekle iletişime geç.
            </p>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
