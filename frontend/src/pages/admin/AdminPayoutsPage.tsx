import { useState, type FormEvent } from "react";
import { formatTL, parseMoney } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import {
  useCreatePayout,
  usePayoutHistory,
  usePendingPayouts,
} from "@/hooks/usePayouts";
import type { PayeeBalance } from "@/api/payouts";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

/**
 * Hakediş defteri — "kime ne kadar ödeyeceğim".
 *
 * Platform, eğitmen ve kütüphaneler adına para tahsil ediyor ama onlara ödeme
 * yapan otomatik bir mekanizma yok (iyzico alt üye işyeri kapalı; banka sanal
 * POS'larında zaten yoktur). Ödeme bankadan ELLE yapılır, burada kaydı tutulur.
 *
 * Emanetteki tutar ayrı gösterilir: ders henüz yapılmadığı için borç değildir.
 */
export default function AdminPayoutsPage() {
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [selected, setSelected] = useState<PayeeBalance | null>(null);

  return (
    // Başlık ve açıklama `AdminPageHeader` tarafından basılır (nav öğesinin
    // label + description alanlarından). Sayfa kendi <h1>'ini basmaz — aksi
    // halde ekranda iki <h1> olur ve belge başlık hiyerarşisi bozulur.
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {(
          [
            ["pending", "Ödenecekler"],
            ["history", "Ödeme geçmişi"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "pending" ? (
        <PendingList onPay={setSelected} />
      ) : (
        <HistoryList />
      )}

      {selected && (
        <PayModal balance={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function PendingList({ onPay }: { onPay: (b: PayeeBalance) => void }) {
  const { data, isLoading, isError, refetch } = usePendingPayouts(true);

  if (isLoading) {
    return <p className="text-sm text-slate-500">Yükleniyor…</p>;
  }
  if (isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/30">
        <p className="text-red-700 dark:text-red-300">Liste alınamadı.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-2 font-medium text-red-700 underline dark:text-red-300"
        >
          Tekrar dene
        </button>
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center dark:border-slate-700">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ödenmemiş hakediş yok.
        </p>
      </div>
    );
  }

  const toplam = data.reduce((s, b) => s + (parseMoney(b.balance) ?? 0), 0);

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        Toplam ödenecek: <strong>{formatTL(toplam)}</strong> · {data.length} alıcı
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
              <th className="py-2 pr-4 font-medium">Alıcı</th>
              <th className="py-2 pr-4 font-medium">IBAN</th>
              <th className="py-2 pr-4 text-right font-medium">Hak edilen</th>
              <th className="py-2 pr-4 text-right font-medium">Ödenen</th>
              <th className="py-2 pr-4 text-right font-medium">Bakiye</th>
              <th className="py-2 pr-4 text-right font-medium">Emanette</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.map((b) => (
              <tr key={`${b.payee_type}-${b.payee_id}`}>
                <td className="py-3 pr-4">
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    {b.name}
                  </span>
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {b.payee_type === "TUTOR" ? "Eğitmen" : "Kütüphane"}
                  </span>
                </td>
                <td className="py-3 pr-4 font-mono text-xs text-slate-500 dark:text-slate-400">
                  {b.iban ?? (
                    <span className="text-amber-600 dark:text-amber-400">
                      IBAN yok
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-right text-slate-600 dark:text-slate-300">
                  {formatTL(b.earned)}
                </td>
                <td className="py-3 pr-4 text-right text-slate-500 dark:text-slate-400">
                  {formatTL(b.paid)}
                </td>
                <td className="py-3 pr-4 text-right font-semibold text-slate-900 dark:text-white">
                  {formatTL(b.balance)}
                </td>
                <td className="py-3 pr-4 text-right text-slate-400 dark:text-slate-500">
                  {formatTL(b.pending)}
                </td>
                <td className="py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onPay(b)}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                  >
                    Ödedim
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
        “Emanette” sütunu henüz hak edilmemiş tutardır (ders yapılmadı / katılım
        doğrulanmadı) — borç değildir, iade edilebilir.
      </p>
    </div>
  );
}

function HistoryList() {
  const { data, isLoading } = usePayoutHistory();

  if (isLoading) return <p className="text-sm text-slate-500">Yükleniyor…</p>;
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center dark:border-slate-700">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Henüz ödeme kaydı yok.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
            <th className="py-2 pr-4 font-medium">Tarih</th>
            <th className="py-2 pr-4 font-medium">Alıcı</th>
            <th className="py-2 pr-4 text-right font-medium">Tutar</th>
            <th className="py-2 pr-4 font-medium">Referans</th>
            <th className="py-2 font-medium">IBAN (o anki)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.map((r) => (
            <tr key={r.id}>
              <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">
                {formatDate(r.paid_at)}
              </td>
              <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">
                {r.payee_type === "TUTOR" ? "Eğitmen" : "Kütüphane"} #{r.payee_id}
              </td>
              <td className="py-3 pr-4 text-right font-medium text-slate-900 dark:text-white">
                {formatTL(r.amount)}
              </td>
              <td className="py-3 pr-4 text-slate-500 dark:text-slate-400">
                {r.reference ?? "—"}
              </td>
              <td className="py-3 font-mono text-xs text-slate-400 dark:text-slate-500">
                {r.iban_snapshot ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PayModal({
  balance,
  onClose,
}: {
  balance: PayeeBalance;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(balance.balance);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const create = useCreatePayout();

  const max = parseMoney(balance.balance) ?? 0;
  const value = parseMoney(amount) ?? 0;
  const gecersiz = value <= 0 || value > max;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        payee_type: balance.payee_type,
        payee_id: balance.payee_id,
        amount,
        reference: reference.trim() || null,
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("Ödeme kaydedildi.");
          onClose();
        },
        onError: (err) => toast.error(getErrorMessage(err, "Kaydedilemedi.")),
      }
    );
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Ödeme kaydı — {balance.name}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Havaleyi bankadan yaptıktan sonra buraya kaydedin. Ödenmemiş bakiye:{" "}
          <strong>{formatTL(balance.balance)}</strong>
        </p>
        {balance.iban ? (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {balance.iban}
          </p>
        ) : (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Bu alıcının IBAN'ı kayıtlı değil; ödemeden önce kendisinden isteyin.
          </p>
        )}

        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Tutar (TL)
          </span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={max}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          {gecersiz && (
            <span className="mt-1 block text-xs text-red-500">
              Tutar 0 ile {formatTL(balance.balance)} arasında olmalı.
            </span>
          )}
        </label>

        <label className="mt-3 block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Havale referansı (isteğe bağlı)
          </span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={120}
            placeholder="Dekonttaki referans no"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Not (isteğe bağlı)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </label>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={gecersiz || create.isPending}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {create.isPending ? "Kaydediliyor…" : "Ödemeyi kaydet"}
          </button>
        </div>
      </form>
    </div>
  );
}
