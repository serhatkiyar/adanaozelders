import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchLibraryPayout, submitLibraryPayout } from "@/api/libraries";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { PayoutStatus } from "@/types";

const STATUS_META: Record<PayoutStatus, { label: string; cls: string }> = {
  NONE: { label: "Bilgi yok", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  PENDING: { label: "Doğrulama bekleniyor", cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  ACTIVE: { label: "Doğrulandı ✓", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  REJECTED: { label: "Reddedildi", cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-700 dark:text-white";

/**
 * Kütüphane ödeme hesabı (alt üye işyeri) formu — admin modalında ve operatör
 * panelinde paylaşılır. IBAN + sorumlu kişi (TCKN/ad/email) toplar, durumu gösterir.
 */
export function LibraryPayoutForm({ libraryId }: { libraryId: number }) {
  const qc = useQueryClient();
  const { data: payout } = useQuery({
    queryKey: ["library-payout", libraryId],
    queryFn: () => fetchLibraryPayout(libraryId),
  });
  const submit = useMutation({
    mutationFn: (payload: {
      iban: string;
      tckn: string;
      gsm?: string | null;
      contact_name: string;
      contact_email: string;
    }) => submitLibraryPayout(libraryId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library-payout", libraryId] });
      toast.success("Ödeme bilgisi alındı.");
    },
    onError: (e) => toast.error(getErrorMessage(e, "Kaydedilemedi.")),
  });

  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [iban, setIban] = useState("");
  const [tckn, setTckn] = useState("");
  const [gsm, setGsm] = useState("");

  const status: PayoutStatus = payout?.payout_status ?? "NONE";
  const meta = STATUS_META[status];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const ibanClean = iban.replace(/\s+/g, "").toUpperCase();
    if (!/^TR\d{24}$/.test(ibanClean)) return toast.error("Geçerli TR IBAN girin.");
    if (!/^\d{11}$/.test(tckn.trim())) return toast.error("TCKN 11 haneli olmalı.");
    if (contactName.trim().length < 2) return toast.error("Sorumlu kişi adını girin.");
    if (contactEmail.trim().length < 3) return toast.error("E-posta girin.");
    submit.mutate({
      iban: ibanClean,
      tckn: tckn.trim(),
      gsm: gsm.trim() || null,
      contact_name: contactName.trim(),
      contact_email: contactEmail.trim(),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Deneme/çalışma ücretleri iyzico üzerinden doğrudan bu IBAN'a yatar; sorumlu kişinin
          kimliğini iyzico doğrular.
        </p>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
          {meta.label}
        </span>
      </div>
      {payout?.iban_masked && (
        <p className="font-mono text-sm text-slate-700 dark:text-slate-200">
          {payout.iban_masked}
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputCls} placeholder="Sorumlu kişi adı soyadı" />
          <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputCls} placeholder="E-posta" />
        </div>
        <input value={iban} onChange={(e) => setIban(e.target.value)} className={`${inputCls} font-mono`} placeholder="TR00 0000 ... (IBAN)" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input value={tckn} onChange={(e) => setTckn(e.target.value.replace(/\D/g, ""))} maxLength={11} inputMode="numeric" className={inputCls} placeholder="Sorumlu TCKN (11 hane)" />
          <input value={gsm} onChange={(e) => setGsm(e.target.value)} maxLength={20} className={inputCls} placeholder="Telefon (opsiyonel)" />
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={submit.isPending} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {submit.isPending ? "Gönderiliyor…" : "Kaydet & Doğrula"}
          </button>
        </div>
      </form>
    </div>
  );
}
