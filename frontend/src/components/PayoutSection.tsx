import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { useMyPayout, useSubmitPayout } from "@/hooks/usePayout";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { PayoutStatus } from "@/types";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 ";
const labelCls = "mb-1.5 block text-xs font-medium text-slate-500 ";
const sectionLabelCls =
  "text-xs font-semibold uppercase tracking-wide text-slate-400 ";

const STATUS_META: Record<PayoutStatus, { label: string; cls: string }> = {
  NONE: {
    label: "Bilgi yok",
    cls: "bg-slate-100 text-slate-600 ",
  },
  PENDING: {
    label: "Doğrulama bekleniyor",
    cls: "bg-amber-50 text-amber-700 ",
  },
  ACTIVE: {
    label: "Doğrulandı ✓",
    cls: "bg-emerald-50 text-emerald-700 ",
  },
  REJECTED: {
    label: "Reddedildi",
    cls: "bg-rose-50 text-rose-700 ",
  },
};

export function PayoutSection() {
  const { data: payout, isLoading } = useMyPayout();
  const submit = useSubmitPayout();

  const status: PayoutStatus = payout?.payout_status ?? "NONE";
  const isActive = status === "ACTIVE";

  // ACTIVE'de varsayılan kapalı (özet göster), aksi halde form açık.
  const [editing, setEditing] = useState(false);
  const showForm = editing || (!isActive && status !== "PENDING");

  const [iban, setIban] = useState("");
  const [tckn, setTckn] = useState("");
  const [gsm, setGsm] = useState("");
  const [consent, setConsent] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const ibanClean = iban.replace(/\s+/g, "").toUpperCase();
    if (!/^TR\d{24}$/.test(ibanClean)) {
      toast.error("Geçerli bir TR IBAN girin (TR + 24 hane).");
      return;
    }
    if (!/^\d{11}$/.test(tckn.trim())) {
      toast.error("TCKN 11 haneli rakam olmalı.");
      return;
    }
    if (!consent) {
      toast.error("Devam etmek için bilgilendirmeyi onaylayın.");
      return;
    }
    submit.mutate(
      { iban: ibanClean, tckn: tckn.trim(), gsm: gsm.trim() || null },
      {
        onSuccess: () => {
          toast.success("Ödeme bilgilerin alındı.");
          setEditing(false);
          setTckn("");
          setConsent(false);
        },
        onError: (err) => toast.error(getErrorMessage(err, "Kaydedilemedi.")),
      }
    );
  };

  const meta = STATUS_META[status];

  return (
    <div className="rounded-2xl bg-white px-6 py-5 shadow-sm ring-1 ring-slate-100 ">
      <div className="flex items-center justify-between">
        <span className={sectionLabelCls}>Ödeme Bilgileri</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
          {meta.label}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-500 ">
        Ders ücretlerin <strong>iyzico üzerinden doğrudan IBAN'ına</strong> yatar; platformda
        para tutulmaz. Kimlik doğrulamasını iyzico yapar.
      </p>

      {isLoading ? (
        <div className="mt-4 h-12 animate-pulse rounded-xl bg-slate-100 " />
      ) : (
        <div className="mt-4">
          {/* Özet (ACTIVE / PENDING) */}
          {!showForm && (
            <div className="space-y-2">
              {payout?.iban_masked && (
                <p className="font-mono text-sm text-slate-700 ">
                  {payout.iban_masked}
                </p>
              )}
              {isActive && (
                <p className="text-xs text-emerald-600 ">
                  Kimliğin doğrulandı; ödemeler bu IBAN'a yatacak.
                </p>
              )}
              {status === "PENDING" && (
                <p className="text-xs text-amber-600 ">
                  Bilgilerin doğrulama sürecinde. Sonuç gelince burada görünecek.
                </p>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-marka transition hover:bg-marka-soft "
              >
                {isActive ? "IBAN'ı değiştir" : "Bilgileri güncelle"}
              </button>
            </div>
          )}

          {/* Form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Field label="IBAN" labelClassName={labelCls}>
                {(id) => (
                    <input
                    id={id}
                      value={iban}
                      onChange={(e) => setIban(e.target.value)}
                      className={`${inputCls} font-mono`}
                      placeholder="TR00 0000 0000 0000 0000 0000 00"
                      autoComplete="off"
                    />
                )}
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="T.C. Kimlik No" labelClassName={labelCls}>
                  {(id) => (
                      <input
                    id={id}
                        value={tckn}
                        onChange={(e) => setTckn(e.target.value.replace(/\D/g, ""))}
                        maxLength={11}
                        inputMode="numeric"
                        className={inputCls}
                        placeholder="11 haneli"
                        autoComplete="off"
                      />
                  )}
                </Field>
                <Field label="Telefon (opsiyonel)" labelClassName={labelCls}>
                  {(id) => (
                      <input
                    id={id}
                        value={gsm}
                        onChange={(e) => setGsm(e.target.value)}
                        maxLength={20}
                        className={inputCls}
                        placeholder="5xx xxx xx xx"
                        autoComplete="off"
                      />
                  )}
                </Field>
              </div>

              <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-500 ">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-marka focus:ring-marka-focus accent-marka"
                />
                <span>
                  IBAN ve TCKN bilgimin, ödeme aracılığı ve kimlik doğrulama amacıyla
                  <strong> iyzico</strong>'ya aktarılmasını onaylıyorum. TCKN'm platformda
                  saklanmaz; yalnız son 4 hanesi tutulur.
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-1">
                {editing && (
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 "
                  >
                    İptal
                  </button>
                )}
                <button
                  type="submit"
                  disabled={submit.isPending}
                  className="rounded-xl bg-marka px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-marka-hover active:scale-95 disabled:opacity-50"
                >
                  {submit.isPending ? "Gönderiliyor…" : "Kaydet & Doğrula"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
