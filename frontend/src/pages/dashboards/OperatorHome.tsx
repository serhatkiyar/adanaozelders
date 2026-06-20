import { useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { OPERATOR_NAV } from "@/lib/nav";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import { LibraryPayoutForm } from "@/components/LibraryPayoutForm";
import { QrScanner } from "@/components/QrScanner";
import {
  LibraryEditorModal,
  toEditorState,
  type EditorState,
} from "@/components/LibraryEditorModal";
import { useOperatorMe, useVerifyAttendance } from "@/hooks/useLibraryExams";
import {
  useLibraryAdminDetail,
  useLibraryEarnings,
  useResubmitLibrary,
} from "@/hooks/useLibraries";
import { useChangePassword } from "@/hooks/useProfile";
import {
  useAttendStudyReservation,
  useManageStudyReservations,
} from "@/hooks/useStudy";
import { formatTRY } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { AttendanceResult, LibraryDetailOut, OperatorOut } from "@/types";

export default function OperatorHome() {
  const { data: op, isLoading } = useOperatorMe();
  const { data: lib } = useLibraryAdminDetail(op?.library_id);
  // Ücretli yönetim (oturum/QR/kazanç) yalnız ONAYLI (ACTIVE) kütüphanede; PENDING/
  // REJECTED'da operatör sadece profilini tamamlar (backend de bu akışları gate'ler).
  const isActive = lib?.status === "ACTIVE";
  const verify = useVerifyAttendance();
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<AttendanceResult | null>(null);

  const runVerify = (payload: string) => {
    if (!payload.trim()) return;
    verify.mutate(payload.trim(), {
      onSuccess: (res) => {
        setResult(res);
        setScanning(false);
        setCode("");
        if (res.already) toast.success("Zaten doğrulanmıştı.");
        else toast.success(`${res.client_name} doğrulandı ✓`);
      },
      onError: (e) => {
        setResult(null);
        toast.error(getErrorMessage(e, "Doğrulama başarısız."));
      },
    });
  };

  return (
    <DashboardShell title="Kütüphane Paneli" navItems={OPERATOR_NAV}>
      <div className="mx-auto max-w-3xl space-y-6">
        {/* ── Kütüphane kimliği + "sayfanı görüntüle" ── */}
        <OperatorHero op={op} lib={lib} isLoading={isLoading} />

        {/* ── Onay durumu (self-servis başvuru) ── */}
        {op && <LibraryStatusBanner libraryId={op.library_id} />}

        {/* ── Kütüphane profili (bio/telefon/logo/banner/galeri…) ── */}
        {op && <LibraryProfilePanel libraryId={op.library_id} />}

        {/* ── Kazanç özeti (yalnız onaylı) ── */}
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

        {/* ── Ödeme hesabı (IBAN) ── */}
        {op && isActive && (
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
              Ödeme Hesabı
            </h2>
            <LibraryPayoutForm libraryId={op.library_id} />
          </div>
        )}

        {/* ── QR doğrulama (yalnız onaylı) ── */}
        {op && isActive && (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
            Katılım Doğrula (QR)
          </h2>

          {scanning ? (
            <QrScanner onScan={runVerify} onClose={() => setScanning(false)} />
          ) : (
            <button
              onClick={() => {
                setResult(null);
                setScanning(true);
              }}
              className="mb-3 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              📷 Kamera ile QR tara
            </button>
          )}

          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
              veya kodu elle gir / USB okuyucu ile okut
            </p>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runVerify(code);
                }}
                placeholder="Bilet kodu…"
                className="input flex-1"
                autoFocus
              />
              <button
                onClick={() => runVerify(code)}
                disabled={verify.isPending}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-700"
              >
                {verify.isPending ? "…" : "Doğrula"}
              </button>
            </div>
          </div>

          {result && (
            <div
              className={`mt-4 flex items-center gap-3 rounded-xl px-4 py-3 ${
                result.already
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              }`}
            >
              <span className="text-2xl">{result.already ? "ℹ️" : "✅"}</span>
              <div>
                <p className="text-sm font-bold">{result.client_name}</p>
                <p className="text-xs">
                  {result.exam_title} · {result.message}
                </p>
              </div>
            </div>
          )}
        </div>
        )}

        {/* ── Oturum yönetimi (yalnız onaylı) ── */}
        {op && isActive && (
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
            <ExamSessionsManager libraryId={op.library_id} />
          </div>
        )}

        {/* ── Çalışma alanı rezervasyonları (yalnız onaylı) ── */}
        {op && isActive && <StudyReservationsList libraryId={op.library_id} />}

        {/* ── Hesap: şifre değiştir ── */}
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
          {lib && status === "ACTIVE" ? (
            <Link
              to={ROUTES.library(lib.slug)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              Kütüphane sayfanı görüntüle
            </Link>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Onaylanınca kütüphane sayfan öğrencilere görünür olacak.
            </span>
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
          🔍 Başvurun inceleniyor
        </p>
        <p className="mt-1 text-sm text-amber-700/90 dark:text-amber-200/80">
          Admin onayından sonra kütüphanen yayına girer ve öğrencilere görünür olur.
          Bu sırada aşağıdan <strong>profilini tamamlayabilirsin</strong> (saatler, görseller,
          olanaklar, konum) — onaylanır onaylanmaz hazır olsun.
        </p>
      </div>
    );
  }

  if (lib.status === "REJECTED") {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/30 dark:bg-rose-500/10">
        <p className="flex items-center gap-2 text-sm font-bold text-rose-800 dark:text-rose-200">
          ⛔ Başvurun reddedildi
        </p>
        {lib.rejection_reason && (
          <p className="mt-1 text-sm text-rose-700/90 dark:text-rose-200/80">
            <span className="font-semibold">Gerekçe:</span> {lib.rejection_reason}
          </p>
        )}
        <p className="mt-1 text-sm text-rose-700/90 dark:text-rose-200/80">
          Aşağıdan profilini düzeltip başvurunu tekrar gönderebilirsin.
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

function LibraryProfilePanel({ libraryId }: { libraryId: number }) {
  const { data: lib, isLoading } = useLibraryAdminDetail(libraryId);
  const [editing, setEditing] = useState<EditorState | null>(null);

  const open = () => {
    if (lib) setEditing(toEditorState(lib));
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      {/* Kapak + logo önizleme */}
      <div className="relative h-28 w-full bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-slate-700 dark:to-slate-800">
        {lib?.cover_url && (
          <img src={lib.cover_url} alt="" className="h-full w-full object-cover" />
        )}
        {lib?.logo_url && (
          <img
            src={lib.logo_url}
            alt=""
            className="absolute -bottom-6 left-5 h-14 w-14 rounded-xl bg-white object-cover shadow-md ring-2 ring-white dark:ring-slate-800"
          />
        )}
      </div>
      <div className="px-5 pb-5 pt-8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Kütüphane Profili
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Açıklama, iletişim, logo, kapak, galeri, saatler, olanaklar ve konumunu güncelle.
            </p>
          </div>
          <button
            onClick={open}
            disabled={isLoading || !lib}
            className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {isLoading ? "…" : "Profili Düzenle"}
          </button>
        </div>
        {lib && !lib.description && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            Henüz açıklama/biyografi eklenmemiş — profilini doldurarak öğrencilere daha
            güçlü görün.
          </p>
        )}
      </div>

      {editing && (
        <LibraryEditorModal
          state={editing}
          canEditIdentity={false}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
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

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 text-white shadow-sm">
        <p className="text-xs font-medium text-emerald-50">Serbest kazanç</p>
        <p className="mt-1 text-2xl font-bold">{formatTRY(data.released_earning)}</p>
        <p className="mt-0.5 text-[11px] text-emerald-100">
          {data.released_count} katılım · komisyon {formatTRY(data.commission_total)}
        </p>
      </div>
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Emanette bekleyen</p>
        <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
          {formatTRY(data.held_earning)}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {data.held_count} ödenmiş, henüz doğrulanmadı
        </p>
      </div>
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Toplam (serbest + emanet)</p>
        <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
          {formatTRY(
            (Number(data.released_earning) + Number(data.held_earning)).toFixed(2)
          )}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">Katılım doğrulandıkça serbest kalır</p>
      </div>
    </div>
  );
}

function StudyReservationsList({ libraryId }: { libraryId: number }) {
  const { data, isLoading } = useManageStudyReservations(libraryId);
  const attend = useAttendStudyReservation();

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />;
  }
  if (!data || data.length === 0) return null;

  const doAttend = (id: number, name: string) => {
    attend.mutate(id, {
      onSuccess: (res) =>
        toast.success(res.already ? `${name} zaten giriş yapmıştı.` : `${name} giriş yaptı ✓`),
      onError: (e) => toast.error(getErrorMessage(e, "Doğrulama başarısız.")),
    });
  };

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
        Çalışma Alanı Rezervasyonları (yaklaşan)
      </h2>
      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
        {data.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                {r.client_name ?? "Öğrenci"}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {formatDateTime(r.starts_at)} – {formatDateTime(r.ends_at)}
              </p>
            </div>
            {r.status === "ATTENDED" ? (
              <span className="shrink-0 text-xs font-semibold text-emerald-600">Giriş yaptı ✓</span>
            ) : (
              <button
                onClick={() => doAttend(r.id, r.client_name ?? "Öğrenci")}
                disabled={attend.isPending}
                className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {attend.isPending ? "…" : "Giriş ver"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
