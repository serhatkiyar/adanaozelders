import { useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { OPERATOR_NAV } from "@/lib/nav";
import { useOperatorMe } from "@/hooks/useLibraryExams";
import {
  useLibraryAdminDetail,
  useLibraryEarnings,
  useResubmitLibrary,
} from "@/hooks/useLibraries";
import { useChangePassword } from "@/hooks/useProfile";
import { formatTRY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { LibraryDetailOut, OperatorOut } from "@/types";

export default function OperatorHome() {
  const { data: op, isLoading } = useOperatorMe();
  const { data: lib } = useLibraryAdminDetail(op?.library_id);
  const isActive = lib?.status === "ACTIVE";

  return (
    <DashboardShell title="Kütüphane Paneli" navItems={OPERATOR_NAV}>
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Kütüphane kimliği + "sayfanı görüntüle" */}
        <OperatorHero op={op} lib={lib} isLoading={isLoading} />

        {/* Onay durumu (self-servis başvuru) */}
        {op && <LibraryStatusBanner libraryId={op.library_id} />}

        {/* Kazanç özeti + işlem dökümü linki (yalnız onaylı) */}
        {op && isActive && (
          <div className="space-y-2">
            <EarningsCard libraryId={op.library_id} />
            <div className="text-right">
              <Link
                to={ROUTES.balance}
                className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Bakiye & işlem dökümü →
              </Link>
            </div>
          </div>
        )}

        {/* Operasyona kısa yol (yalnız onaylı) */}
        {op && isActive && <OperationsTeaser libraryId={op.library_id} />}

        {/* Hesap: şifre değiştir */}
        <PasswordPanel />
      </div>
    </DashboardShell>
  );
}

/* Kütüphane kimliği: kapak + logo + ad + durum + "sayfanı görüntüle" (öğrencilerin
   gördüğü public profile). Operatör kendi kütüphanesini güzelce görür. */
const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Yayında", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  PENDING: { label: "İncelemede", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  REJECTED: { label: "Reddedildi", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
  HIDDEN: { label: "Gizli", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
};

function OperatorHero({
  op,
  lib,
  isLoading,
}: {
  op?: OperatorOut;
  lib?: LibraryDetailOut;
  isLoading: boolean;
}) {
  const name = op?.library_name ?? lib?.name ?? "Kütüphane Paneli";
  const initial = (name.trim()[0] ?? "K").toUpperCase();
  const status = lib?.status;
  const pill = status ? STATUS_PILL[status] : undefined;
  const place = [lib?.district, lib?.city].filter(Boolean).join(", ");

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      {/* Kapak */}
      <div className="relative h-36 w-full bg-gradient-to-br from-indigo-500 to-violet-600">
        {lib?.cover_url && (
          <img src={lib.cover_url} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        {pill && (
          <span
            className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-xs font-semibold ${pill.cls}`}
          >
            {pill.label}
          </span>
        )}
      </div>

      <div className="px-5 pb-5">
        <div className="-mt-10 flex items-end gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-indigo-600 text-2xl font-bold text-white shadow-md ring-4 ring-white dark:ring-slate-800">
            {lib?.logo_url ? (
              <img src={lib.logo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="truncate text-xl font-bold text-slate-900 dark:text-white">
              {isLoading ? "Yükleniyor…" : name}
            </h1>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {place || "Kütüphane paneli"}
              {lib && lib.rating_count > 0 && (
                <>
                  {" · "}
                  <span className="text-amber-500">★</span>{" "}
                  {lib.rating_average?.toFixed(1)} ({lib.rating_count})
                </>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            to={ROUTES.operatorLibrary}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
            </svg>
            Kütüphane profilim
          </Link>
          {lib && status === "ACTIVE" && (
            <Link
              to={ROUTES.library(lib.slug)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              Öğrenci görünümü
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* Self-servis başvuru onay durumu: PENDING (inceleniyor) / REJECTED (gerekçe) / ACTIVE (yayında). */
function LibraryStatusBanner({ libraryId }: { libraryId: number }) {
  const { data: lib } = useLibraryAdminDetail(libraryId);
  const resubmit = useResubmitLibrary();
  if (!lib) return null;

  const doResubmit = () => {
    resubmit.mutate(libraryId, {
      onSuccess: () => toast.success("Başvurun tekrar gönderildi; inceleniyor."),
      onError: (e) => toast.error(getErrorMessage(e, "Gönderilemedi.")),
    });
  };

  if (lib.status === "PENDING") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
        <p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-200">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Başvurun inceleniyor
        </p>
        <p className="mt-1 text-sm text-amber-700/90 dark:text-amber-200/80">
          Admin onayından sonra kütüphanen yayına girer ve öğrencilere görünür olur.
          Bu sırada <Link to={ROUTES.operatorLibrary} className="font-semibold underline">profilini tamamlayabilirsin</Link>{" "}
          (saatler, görseller, olanaklar, konum) — onaylanır onaylanmaz hazır olsun.
        </p>
      </div>
    );
  }

  if (lib.status === "REJECTED") {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/30 dark:bg-rose-500/10">
        <p className="flex items-center gap-2 text-sm font-bold text-rose-800 dark:text-rose-200">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Başvurun reddedildi
        </p>
        {lib.rejection_reason && (
          <p className="mt-1 text-sm text-rose-700/90 dark:text-rose-200/80">
            <span className="font-semibold">Gerekçe:</span> {lib.rejection_reason}
          </p>
        )}
        <p className="mt-1 text-sm text-rose-700/90 dark:text-rose-200/80">
          <Link to={ROUTES.operatorLibrary} className="font-semibold underline">Profilini düzelt</Link>{" "}
          ve başvurunu tekrar gönder.
        </p>
        <button
          onClick={doResubmit}
          disabled={resubmit.isPending}
          className="mt-3 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60 active:scale-95"
        >
          {resubmit.isPending ? "Gönderiliyor…" : "Tekrar başvur"}
        </button>
      </div>
    );
  }

  return null; // ACTIVE → banner gerekmez
}

/* Operasyona kısa yol kartı — günlük iş ayrı sekmede (Oturumlar & QR). */
function OperationsTeaser({ libraryId: _libraryId }: { libraryId: number }) {
  return (
    <Link
      to={ROUTES.operatorSessions}
      className="flex items-center justify-between gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:ring-indigo-300 dark:bg-slate-800 dark:ring-slate-700 dark:hover:ring-indigo-500/50"
    >
      <div className="min-w-0">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Oturumlar & QR</h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Deneme oturumlarını yönet, çalışma rezervasyonlarını gör ve QR ile katılım doğrula.
        </p>
      </div>
      <svg className="h-5 w-5 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </Link>
  );
}

function PasswordPanel() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const change = useChangePassword();

  const submit = () => {
    if (form.next.length < 8) {
      toast.error("Yeni şifre en az 8 karakter olmalı.");
      return;
    }
    if (form.next !== form.confirm) {
      toast.error("Yeni şifreler eşleşmiyor.");
      return;
    }
    change.mutate(
      { current_password: form.current, new_password: form.next },
      {
        onSuccess: () => {
          toast.success("Şifren güncellendi.");
          setForm({ current: "", next: "", confirm: "" });
          setOpen(false);
        },
        onError: (e) => toast.error(getErrorMessage(e, "Şifre değiştirilemedi.")),
      }
    );
  };

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Hesap Güvenliği</h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
        >
          {open ? "Kapat" : "Şifre değiştir"}
        </button>
      </div>
      {open && (
        <div className="mt-3 grid max-w-md grid-cols-1 gap-2">
          <input
            type="password"
            className="input"
            placeholder="Mevcut şifre"
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
          />
          <input
            type="password"
            className="input"
            placeholder="Yeni şifre (min 8)"
            value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })}
          />
          <input
            type="password"
            className="input"
            placeholder="Yeni şifre (tekrar)"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button
            onClick={submit}
            disabled={change.isPending || !form.current || !form.next}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {change.isPending ? "Güncelleniyor…" : "Şifreyi Güncelle"}
          </button>
        </div>
      )}
    </div>
  );
}

function EarningsCard({ libraryId }: { libraryId: number }) {
  const { data, isLoading } = useLibraryEarnings(libraryId);
  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />;
  }
  if (!data) return null;

  const total = (Number(data.released_earning) + Number(data.held_earning)).toFixed(2);

  // Tek sakin kart; sütunlar saç-teli çizgiyle ayrılır, renk yalnız rakamın üstünde.
  return (
    <div className="grid grid-cols-1 divide-y divide-slate-100 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-slate-700 dark:bg-slate-800 dark:ring-slate-700">
      <div className="pb-4 sm:pb-0 sm:pr-5">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Serbest kazanç</p>
        <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
          {formatTRY(data.released_earning)}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {data.released_count} katılım · komisyon {formatTRY(data.commission_total)}
        </p>
      </div>
      <div className="py-4 sm:px-5 sm:py-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Emanette bekleyen</p>
        <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
          {formatTRY(data.held_earning)}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {data.held_count} ödenmiş, henüz doğrulanmadı
        </p>
      </div>
      <div className="pt-4 sm:pl-5 sm:pt-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Toplam</p>
        <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{formatTRY(total)}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">Katılım doğrulandıkça serbest kalır</p>
      </div>
    </div>
  );
}
