import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import {
  LibraryEditorModal,
  emptyEditor,
  toEditorState,
  type EditorState,
} from "@/components/LibraryEditorModal";
import {
  useAdminLibraries,
  useApproveLibrary,
  useDeleteLibrary,
  useRejectLibrary,
} from "@/hooks/useLibraries";
import {
  useCreateOperator,
  useDeleteOperator,
  useOperators,
} from "@/hooks/useLibraryExams";
import {
  fetchLibraryAdmin,
  fetchLibraryPayout,
  submitLibraryPayout,
} from "@/api/libraries";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { LibrarySearchOut, PayoutStatus } from "@/types";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Onay bekliyor",
  REJECTED: "Reddedildi",
  HIDDEN: "Gizli",
};
const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  REJECTED: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  HIDDEN: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

export default function AdminLibraries() {
  const { data, isLoading, isError, error } = useAdminLibraries();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [managing, setManaging] = useState<LibrarySearchOut | null>(null);
  const [payouting, setPayouting] = useState<LibrarySearchOut | null>(null);
  const del = useDeleteLibrary();
  const approve = useApproveLibrary();
  const reject = useRejectLibrary();

  const pending = data?.filter((l) => l.status === "PENDING") ?? [];

  const onApprove = (lib: LibrarySearchOut) => {
    if (!window.confirm(`"${lib.name}" başvurusunu onayla? Kütüphane yayına girer.`)) return;
    approve.mutate(lib.id, {
      onSuccess: () => toast.success("Başvuru onaylandı, kütüphane yayında."),
      onError: (e) => toast.error(getErrorMessage(e, "Onay başarısız.")),
    });
  };

  const onReject = (lib: LibrarySearchOut) => {
    const reason = window.prompt(`"${lib.name}" başvurusunu reddet. Gerekçe (operatöre iletilir):`, "");
    if (reason === null) return; // iptal
    reject.mutate(
      { id: lib.id, reason: reason.trim() || null },
      {
        onSuccess: () => toast.success("Başvuru reddedildi."),
        onError: (e) => toast.error(getErrorMessage(e, "Reddetme başarısız.")),
      }
    );
  };

  const openCreate = () => setEditor(emptyEditor());

  const openEdit = async (lib: LibrarySearchOut) => {
    try {
      // Tam kayıt (saatler + iletişim) admin detay ucundan gelir (GİZLİ dahil).
      const full = await fetchLibraryAdmin(lib.id);
      setEditor(toEditorState(full));
    } catch (e) {
      toast.error(getErrorMessage(e, "Kütüphane yüklenemedi."));
    }
  };

  const onDelete = (lib: LibrarySearchOut) => {
    if (!window.confirm(`"${lib.name}" kütüphanesini silmek istiyor musun?`)) return;
    del.mutate(lib.id, {
      onSuccess: () => toast.success("Kütüphane silindi."),
      onError: (e) => toast.error(getErrorMessage(e, "Silme başarısız.")),
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {data?.length ?? 0} kütüphane · sahada gezip kaydettiğin mekânları buradan yönet.
        </p>
        <button
          onClick={openCreate}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
        >
          + Kütüphane Ekle
        </button>
      </div>

      {/* ── Onay bekleyen self-servis başvurular ── */}
      {pending.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-200">
            🔍 Onay bekleyen başvurular
            <span className="rounded-full bg-amber-200 px-2 text-xs font-bold text-amber-900 dark:bg-amber-500/30 dark:text-amber-100">
              {pending.length}
            </span>
          </p>
          {pending.map((lib) => (
            <div
              key={lib.id}
              className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-amber-100 dark:bg-slate-800 dark:ring-amber-500/20 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{lib.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {[lib.city, lib.district].filter(Boolean).join(" · ") || lib.location_text || "Konum belirtilmemiş"}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  onClick={() => openEdit(lib)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                >
                  İncele
                </button>
                <button
                  onClick={() => onReject(lib)}
                  disabled={reject.isPending}
                  className="rounded-xl border border-rose-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-500/30 dark:bg-slate-700"
                >
                  Reddet
                </button>
                <button
                  onClick={() => onApprove(lib)}
                  disabled={approve.isPending}
                  className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60 active:scale-95"
                >
                  Onayla
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {getErrorMessage(error, "Kütüphaneler yüklenemedi.")}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Henüz kütüphane eklenmedi.
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((lib) => (
            <div
              key={lib.id}
              className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-xl dark:bg-slate-700">
                  {lib.cover_url ? (
                    <img src={lib.cover_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    "📚"
                  )}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-900 dark:text-white">
                    <span className="truncate">{lib.name}</span>
                    {lib.status && lib.status !== "ACTIVE" && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[lib.status] ?? "bg-slate-100 text-slate-500"}`}>
                        {STATUS_LABEL[lib.status] ?? lib.status}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {lib.location_text || "Konum yok"} · ★{" "}
                    {lib.rating_average != null ? lib.rating_average.toFixed(1) : "—"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  onClick={() => setManaging(lib)}
                  className="rounded-xl bg-indigo-50 px-3.5 py-1.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
                >
                  Oturumlar & Operatörler
                </button>
                <button
                  onClick={() => setPayouting(lib)}
                  className="rounded-xl bg-emerald-50 px-3.5 py-1.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300"
                >
                  Ödeme
                </button>
                <button
                  onClick={() => openEdit(lib)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                >
                  Düzenle
                </button>
                <button
                  onClick={() => onDelete(lib)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 dark:border-slate-600 dark:bg-slate-700"
                >
                  Sil
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editor && (
        <LibraryEditorModal
          state={editor}
          onClose={() => setEditor(null)}
        />
      )}

      {managing && (
        <ManageModal library={managing} onClose={() => setManaging(null)} />
      )}

      {payouting && (
        <LibraryPayoutModal library={payouting} onClose={() => setPayouting(null)} />
      )}
    </section>
  );
}

/* ── Kütüphane ödeme (payout) modalı ── */

const PAYOUT_STATUS_META: Record<PayoutStatus, { label: string; cls: string }> = {
  NONE: { label: "Bilgi yok", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  PENDING: { label: "Doğrulama bekleniyor", cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  ACTIVE: { label: "Doğrulandı ✓", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  REJECTED: { label: "Reddedildi", cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
};

function LibraryPayoutModal({
  library,
  onClose,
}: {
  library: LibrarySearchOut;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: payout } = useQuery({
    queryKey: ["library-payout", library.id],
    queryFn: () => fetchLibraryPayout(library.id),
  });
  const submit = useMutation({
    mutationFn: (payload: {
      iban: string;
      tckn: string;
      gsm?: string | null;
      contact_name: string;
      contact_email: string;
    }) => submitLibraryPayout(library.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library-payout", library.id] });
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
  const meta = PAYOUT_STATUS_META[status];
  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-700 dark:text-white";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-800">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Ödeme Bilgileri · {library.name}
          </h3>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
            {meta.label}
          </span>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Deneme/çalışma ücretleri iyzico üzerinden doğrudan bu IBAN'a yatar. Sorumlu kişinin
          (şahıs alt üye) kimliğini iyzico doğrular. {payout?.iban_masked && (
            <span className="font-mono">Mevcut: {payout.iban_masked}</span>
          )}
        </p>
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
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
              Kapat
            </button>
            <button type="submit" disabled={submit.isPending} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {submit.isPending ? "Gönderiliyor…" : "Kaydet & Doğrula"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Oturumlar & Operatörler modalı ── */

function ManageModal({
  library,
  onClose,
}: {
  library: LibrarySearchOut;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700">
          <h2 className="truncate text-lg font-bold text-slate-900 dark:text-white">
            {library.name}
          </h2>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <OperatorsManager libraryId={library.id} />
          <div className="border-t border-slate-100 pt-5 dark:border-slate-700">
            <ExamSessionsManager libraryId={library.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function OperatorsManager({ libraryId }: { libraryId: number }) {
  const { data: operators } = useOperators(libraryId);
  const create = useCreateOperator(libraryId);
  const del = useDeleteOperator(libraryId);
  const [form, setForm] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
  });
  const [open, setOpen] = useState(false);

  const submit = () => {
    if (!form.email || form.password.length < 8 || !form.first_name || !form.last_name) {
      toast.error("Tüm alanları doldurun (şifre en az 8 karakter).");
      return;
    }
    create.mutate(form, {
      onSuccess: () => {
        toast.success("Operatör hesabı oluşturuldu.");
        setForm({ email: "", password: "", first_name: "", last_name: "" });
        setOpen(false);
      },
      onError: (e) => toast.error(getErrorMessage(e, "Oluşturulamadı.")),
    });
  };

  const onDelete = (id: number, name: string) => {
    if (!window.confirm(`${name} operatör hesabını sil?`)) return;
    del.mutate(id, {
      onSuccess: () => toast.success("Operatör silindi."),
      onError: (e) => toast.error(getErrorMessage(e, "Silme başarısız.")),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Operatörler</h3>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
        >
          {open ? "Kapat" : "+ Operatör"}
        </button>
      </div>

      {open && (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/40">
          <input className="input" placeholder="Ad" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <input className="input" placeholder="Soyad" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <input className="input col-span-2" placeholder="E-posta" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input col-span-2" type="password" placeholder="Şifre (min 8)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button onClick={submit} disabled={create.isPending} className="col-span-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {create.isPending ? "Oluşturuluyor…" : "Operatör Hesabı Oluştur"}
          </button>
        </div>
      )}

      {operators && operators.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-700 dark:border-slate-700">
          {operators.map((op) => (
            <li key={op.id} className="flex items-center justify-between px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{op.full_name}</p>
                <p className="truncate text-xs text-slate-400">{op.email}</p>
              </div>
              <button onClick={() => onDelete(op.id, op.full_name)} className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                Sil
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">Henüz operatör yok. Kütüphaneci için hesap oluşturun.</p>
      )}
    </div>
  );
}

