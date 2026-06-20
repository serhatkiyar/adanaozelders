import { useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { Avatar } from "@/components/Avatar";
import {
  useActivateTutor,
  useAdminStats,
  useAdminTutors,
  useAdminUsers,
  useApproveTutor,
  useDeleteTutor,
  useRejectTutor,
  useSuspendTutor,
  useAdminBookings,
  useAdminCancelBooking,
  useAdminToggleDisputeBooking,
  usePendingEducations,
  useVerifyEducation,
} from "@/hooks/useAdmin";
import {
  useAdminReports,
  useResolveReport,
  useOpenReportCount,
} from "@/hooks/useReports";
import {
  useAdminNameChangeRequests,
  useApproveNameChange,
  useRejectNameChange,
} from "@/hooks/useNameChanges";
import { REPORT_REASON_LABEL } from "@/components/ReportModal";
import AdminLibraries from "@/pages/dashboards/AdminLibraries";
import AdminExamCatalogs from "@/pages/dashboards/AdminExamCatalogs";
import {
  TutorStatus,
  ReportStatus,
  type AdminEducation,
  type AdminUserOut,
  type DocumentType,
  type NameChangeRequest,
  type NameChangeStatus,
  type ReportOut,
  type TutorOut,
} from "@/types";
import { formatDateTime } from "@/lib/datetime";
import { formatRate } from "@/lib/money";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

const TUTOR_STATUS_META: Record<TutorStatus, { label: string; cls: string }> = {
  [TutorStatus.DRAFT]: {
    label: "Taslak",
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  },
  [TutorStatus.PENDING_APPROVAL]: {
    label: "Onay Bekliyor",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  [TutorStatus.APPROVED]: {
    label: "Yayında",
    cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  [TutorStatus.REJECTED]: {
    label: "Reddedildi",
    cls: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
  [TutorStatus.SUSPENDED]: {
    label: "Pasif",
    cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  },
};

/* ─── role meta ───────────────────────────────────────── */

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Yönetici",
  TUTOR: "Eğitmen",
  CLIENT: "Öğrenci",
};

const ROLE_STYLE: Record<string, string> = {
  ADMIN: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  TUTOR: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  CLIENT: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

/* ─── stat items ─────────────────────────────────────── */

type Tone = "indigo" | "emerald" | "amber" | "red" | "violet" | "slate";

interface StatItem {
  label: string;
  value: number;
  sub?: string;
  tone: Tone;
  icon: string;
}

const TONE_CLS: Record<Tone, { num: string; icon: string; ring: string }> = {
  indigo: { num: "text-indigo-600", icon: "bg-indigo-50 text-indigo-500", ring: "ring-indigo-100" },
  emerald: { num: "text-emerald-600", icon: "bg-emerald-50 text-emerald-500", ring: "ring-emerald-100" },
  amber: { num: "text-amber-600", icon: "bg-amber-50 text-amber-500", ring: "ring-amber-100" },
  red: { num: "text-red-600", icon: "bg-red-50 text-red-500", ring: "ring-red-100" },
  violet: { num: "text-violet-600", icon: "bg-violet-50 text-violet-500", ring: "ring-violet-100" },
  slate: { num: "text-slate-800", icon: "bg-slate-100 text-slate-500", ring: "ring-slate-100" },
};

function StatBox({ label, value, sub, tone, icon }: StatItem) {
  const cls = TONE_CLS[tone];
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 dark:bg-slate-800 dark:ring-slate-700 ${cls.ring}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {label}
          </p>
          <p className={`mt-2 text-3xl font-bold ${cls.num}`}>{value}</p>
          {sub && (
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{sub}</p>
          )}
        </div>
        <span className={`rounded-xl p-2.5 text-lg ${cls.icon}`}>{icon}</span>
      </div>
    </div>
  );
}

/* ─── pending tutor card ─────────────────────────────── */

function PendingTutorCard({ tutor }: { tutor: TutorOut }) {
  const approve = useApproveTutor();
  const reject = useRejectTutor();
  const busy = approve.isPending || reject.isPending;

  const run = (
    mutation: typeof approve,
    okMsg: string,
    errMsg: string
  ) => {
    mutation.mutate(tutor.id, {
      onSuccess: () => toast.success(okMsg),
      onError: (err) => toast.error(getErrorMessage(err, errMsg)),
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-100 dark:bg-slate-800 dark:ring-amber-700/30 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar name={tutor.full_name} avatar_url={tutor.avatar_url} />
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 dark:text-white">
            {tutor.full_name}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tutor.email}
          </p>
          {tutor.headline && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {tutor.headline}
            </p>
          )}
          {tutor.bio && (
            <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
              {tutor.bio}
            </p>
          )}
          <p className="mt-1.5 text-xs text-slate-400">
            Başvuru: {formatDateTime(tutor.created_at)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          disabled={busy}
          onClick={() =>
            run(approve, `${tutor.full_name} onaylandı.`, "Onaylama başarısız.")
          }
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {approve.isPending ? "…" : "Onayla"}
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(reject, `${tutor.full_name} reddedildi.`, "Reddetme başarısız.")
          }
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-red-900/20"
        >
          {reject.isPending ? "…" : "Reddet"}
        </button>
      </div>
    </div>
  );
}

/* ─── stats section ──────────────────────────────────── */

function StatsSection() {
  const { data, isLoading, isError, error } = useAdminStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100">
        <span>⚠</span>
        {getErrorMessage(error, "İstatistikler yüklenemedi.")}
      </div>
    );
  }

  const stats: StatItem[] = [
    {
      label: "Eğitmenler",
      value: data.total_tutors,
      sub: `${data.approved_tutors} onaylı · ${data.pending_tutors} bekliyor`,
      tone: "indigo",
      icon: "🎓",
    },
    {
      label: "Öğrenciler",
      value: data.total_clients,
      tone: "emerald",
      icon: "📚",
    },
    {
      label: "Ders Talepleri",
      value: data.total_bookings,
      sub: `${data.active_bookings} aktif · ${data.completed_bookings} tamamlandı`,
      tone: "amber",
      icon: "📅",
    },
    {
      label: "Değerlendirmeler",
      value: data.total_reviews,
      tone: "violet",
      icon: "⭐",
    },
    {
      label: "Bekleyen Onay",
      value: data.pending_tutors,
      sub: "eğitmen başvurusu",
      tone: data.pending_tutors > 0 ? "red" : "slate",
      icon: "⏳",
    },
    {
      label: "Yöneticiler",
      value: data.total_admins,
      tone: "slate",
      icon: "🛡️",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      {stats.map((s) => (
        <StatBox key={s.label} {...s} />
      ))}
    </div>
  );
}

/* ─── pending tutors section ─────────────────────────── */

function PendingTutorsSection() {
  const { data, isLoading } = useAdminTutors();

  const pending = data?.filter((t) => t.status === "PENDING_APPROVAL") ?? [];

  if (isLoading) {
    return (
      <section>
        <div className="h-6 w-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        <div className="mt-3 space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      </section>
    );
  }

  if (pending.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Onay Bekleyen Eğitmenler
        </h2>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
          {pending.length}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Bu eğitmenlerin başvuruları incelemenizi bekliyor.
      </p>
      <div className="mt-3 space-y-3">
        {pending.map((t) => (
          <PendingTutorCard key={t.id} tutor={t} />
        ))}
      </div>
    </section>
  );
}

/* ─── users table ────────────────────────────────────── */

function UserRow({ user }: { user: AdminUserOut }) {
  return (
    <tr className="border-t border-slate-100 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/30">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {user.first_name[0]}{user.last_name[0]}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {user.full_name}
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {user.email}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            ROLE_STYLE[user.role] ?? "bg-slate-100 text-slate-600"
          }`}
        >
          {ROLE_LABEL[user.role] ?? user.role}
        </span>
      </td>
      <td className="px-4 py-3">
        {user.is_active ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Aktif
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
            Pasif
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
        {formatDateTime(user.created_at)}
      </td>
    </tr>
  );
}

function UsersTable() {
  const { data, isLoading, isError, error } = useAdminUsers();

  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Kullanıcılar
        </h2>
        {data && (
          <span className="text-sm font-medium text-slate-400">{data.length}</span>
        )}
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
        {isLoading ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse bg-slate-50 dark:bg-slate-800/50" />
            ))}
          </div>
        ) : isError ? (
          <div className="px-5 py-4 text-sm text-red-700 dark:text-red-400">
            {getErrorMessage(error, "Kullanıcılar yüklenemedi.")}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
            Kayıtlı kullanıcı yok.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="border-b border-slate-100 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Kullanıcı
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Rol
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Durum
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Kayıt
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <UserRow key={`${u.role}-${u.id}`} user={u} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── page ───────────────────────────────────────────── */

/* ─── listing management ─────────────────────────────── */

function ListingRow({ tutor }: { tutor: TutorOut }) {
  const suspend = useSuspendTutor();
  const activate = useActivateTutor();
  const del = useDeleteTutor();
  const busy = suspend.isPending || activate.isPending || del.isPending;
  const meta = TUTOR_STATUS_META[tutor.status];

  const run = (
    mutation: { mutate: (id: number, opts: object) => void },
    okMsg: string,
    errMsg: string
  ) =>
    mutation.mutate(tutor.id, {
      onSuccess: () => toast.success(okMsg),
      onError: (err: unknown) => toast.error(getErrorMessage(err, errMsg)),
    });

  const onDelete = () => {
    if (
      !window.confirm(
        `${tutor.full_name} ilanını silmek istediğine emin misin? Bu işlem ilanı yayından kaldırır.`
      )
    )
      return;
    run(del, "İlan silindi.", "Silme başarısız.");
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar name={tutor.full_name} avatar_url={tutor.avatar_url} size="sm" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
              {tutor.full_name}
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}
            >
              {meta.label}
            </span>
          </div>
          {tutor.headline && (
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {tutor.headline}
            </p>
          )}
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            {formatRate(tutor.hourly_rate)} · @{tutor.username}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {tutor.status === TutorStatus.APPROVED && (
          <button
            disabled={busy}
            onClick={() =>
              run(suspend, "İlan yayından kaldırıldı.", "İşlem başarısız.")
            }
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
          >
            Yayından Kaldır
          </button>
        )}
        {tutor.status === TutorStatus.SUSPENDED && (
          <button
            disabled={busy}
            onClick={() =>
              run(activate, "İlan yeniden yayında.", "İşlem başarısız.")
            }
            className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:opacity-60"
          >
            Yeniden Yayınla
          </button>
        )}
        <button
          disabled={busy}
          onClick={onDelete}
          className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 active:scale-95 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-red-900/20"
        >
          Sil
        </button>
      </div>
    </div>
  );
}

const STATUS_ORDER: Record<TutorStatus, number> = {
  [TutorStatus.APPROVED]: 0,
  [TutorStatus.SUSPENDED]: 1,
  [TutorStatus.PENDING_APPROVAL]: 2,
  [TutorStatus.REJECTED]: 3,
  [TutorStatus.DRAFT]: 4,
};

function ListingManagement() {
  const { data, isLoading, isError, error } = useAdminTutors();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-300">
        <span>⚠</span>
        {getErrorMessage(error, "İlanlar yüklenemedi.")}
      </div>
    );
  }

  const tutors = [...(data ?? [])].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  );

  if (tutors.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        Henüz ilan yok.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 dark:text-slate-500">
        {tutors.length} ilan · yayındakileri kaldırabilir, pasifleri geri
        açabilir veya silebilirsin.
      </p>
      {tutors.map((t) => (
        <ListingRow key={t.id} tutor={t} />
      ))}
    </div>
  );
}

/* ─── booking management ────────────────────────────── */

function BookingManagement() {
  const { data, isLoading, isError, error } = useAdminBookings();
  const cancel = useAdminCancelBooking();
  const dispute = useAdminToggleDisputeBooking();

  if (isLoading) return <div>Yükleniyor...</div>;
  if (isError) return <div className="text-red-500">Hata: {getErrorMessage(error, "")}</div>;

  const bookings = data ?? [];

  return (
    <div className="space-y-4">
      {bookings.length === 0 && <p className="text-slate-500">Kayıtlı rezervasyon yok.</p>}
      {bookings.map(b => (
        <div key={b.id} className="rounded-xl border p-4 bg-white dark:bg-slate-800 dark:border-slate-700 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <div className="flex gap-2 items-center mb-1">
              <span className="font-semibold text-sm">{b.tutor_name} ↔ {b.client_name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${b.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                {b.status}
              </span>
              {b.is_disputed && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">İhtilaflı</span>}
            </div>
            <p className="text-xs text-slate-500">{formatDateTime(b.start_at)} - {formatDateTime(b.end_at)}</p>
            {b.cancel_reason && <p className="text-xs text-red-500 mt-1">İptal: {b.cancel_reason}</p>}
            {b.admin_notes && <p className="text-xs text-amber-600 mt-1">Not: {b.admin_notes}</p>}
          </div>
          <div className="flex gap-2">
            {!b.is_disputed ? (
              <button onClick={() => dispute.mutate({ id: b.id, is_disputed: true, admin_notes: window.prompt("İhtilaf notu:") || "" })} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white">
                İhtilaf İşaretle
              </button>
            ) : (
              <button onClick={() => dispute.mutate({ id: b.id, is_disputed: false })} className="text-xs px-3 py-1.5 rounded-lg border border-amber-500 text-amber-600">
                İhtilafı Kaldır
              </button>
            )}
            {b.status !== "CANCELLED" && b.status !== "REJECTED" && (
              <button onClick={() => {
                const reason = window.prompt("İptal nedeni?");
                if(reason) cancel.mutate({ id: b.id, reason });
              }} className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white">
                İptal / İade
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── tabs ────────────────────────────────────────────── */

type Tab =
  | "overview"
  | "listings"
  | "diplomas"
  | "libraries"
  | "catalogs"
  | "bookings"
  | "names"
  | "reports";

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Genel Bakış" },
  { value: "listings", label: "İlan Yönetimi" },
  { value: "diplomas", label: "Diploma Doğrulama" },
  { value: "libraries", label: "Kütüphaneler" },
  { value: "catalogs", label: "Deneme Katalogları" },
  { value: "bookings", label: "Ders Talepleri" },
  { value: "names", label: "Ad Değişiklikleri" },
  { value: "reports", label: "Şikayetler" },
];

/* ─── diploma doğrulama kuyruğu ───────────────────────── */

const DOC_TYPE_LABEL: Record<DocumentType, string> = {
  DIPLOMA: "Diploma",
  DENKLIK: "Denklik Belgesi",
  OGRENCI_BELGESI: "Öğrenci Belgesi",
};

function EducationVerifyCard({ edu }: { edu: AdminEducation }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const verify = useVerifyEducation();

  const doVerify = () =>
    verify.mutate(
      { id: edu.id, action: "verify" },
      {
        onSuccess: () => toast.success("Diploma doğrulandı."),
        onError: (e) => toast.error(getErrorMessage(e, "İşlem başarısız.")),
      }
    );

  const doReject = () =>
    verify.mutate(
      { id: edu.id, action: "reject", note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Belge reddedildi.");
          setRejecting(false);
          setNote("");
        },
        onError: (e) => toast.error(getErrorMessage(e, "İşlem başarısız.")),
      }
    );

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            {edu.tutor_name ?? `Eğitmen #${edu.tutor_id}`}
          </p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{edu.school_name}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {[edu.degree, edu.field_of_study].filter(Boolean).join(" · ")}
          </p>
        </div>
        {edu.document_type && (
          <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
            {DOC_TYPE_LABEL[edu.document_type]}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {edu.document_url && (
          <a
            href={edu.document_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200"
          >
            📄 Belgeyi aç
          </a>
        )}
        <a
          href="https://www.turkiye.gov.tr/belge-dogrulama"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 dark:bg-sky-500/15 dark:text-sky-300"
        >
          🔗 e-Devlet'te doğrula
        </a>
        {edu.verification_code ? (
          <span className="select-all rounded-lg bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
            Barkod: {edu.verification_code}
          </span>
        ) : (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            ⚠ Barkod girilmemiş
          </span>
        )}
        {edu.verification_tckn ? (
          <span className="select-all rounded-lg bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
            TCKN: {edu.verification_tckn}
          </span>
        ) : (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            ⚠ TCKN girilmemiş
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
        Belgedeki ad, eğitmenin hesap adıyla (<strong>{edu.tutor_name}</strong>) aynı olmalı (aitlik);
        barkodu e-Devlet'te teyit et (sahihlik).
      </p>

      {rejecting ? (
        <div className="mt-3 space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Red nedeni (eğitmene gösterilir)"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-400 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
          />
          <div className="flex gap-2">
            <button
              onClick={doReject}
              disabled={verify.isPending}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
            >
              Reddet
            </button>
            <button
              onClick={() => setRejecting(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            onClick={doVerify}
            disabled={verify.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            ✓ Doğrula
          </button>
          <button
            onClick={() => setRejecting(true)}
            disabled={verify.isPending}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Reddet
          </button>
        </div>
      )}
    </div>
  );
}

function DiplomaVerificationSection() {
  const { data, isLoading } = usePendingEducations();
  const list = data ?? [];

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          Teyit Bekleyen Diplomalar
        </h2>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          {list.length}
        </span>
      </div>
      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-12 text-center dark:border-slate-700">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Teyit bekleyen belge yok 🎉
          </p>
        </div>
      ) : (
        list.map((e) => <EducationVerifyCard key={e.id} edu={e} />)
      )}
    </div>
  );
}

/* ─── moderasyon (şikayet) kuyruğu ───────────────────── */

const REPORT_STATUS_STYLE: Record<ReportStatus, string> = {
  [ReportStatus.OPEN]:
    "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  [ReportStatus.RESOLVED]:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  [ReportStatus.DISMISSED]:
    "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  [ReportStatus.OPEN]: "Açık",
  [ReportStatus.RESOLVED]: "Çözüldü",
  [ReportStatus.DISMISSED]: "Reddedildi",
};

function ReportCard({ report }: { report: ReportOut }) {
  const [note, setNote] = useState("");
  const resolve = useResolveReport();
  const isOpen = report.status === ReportStatus.OPEN;

  const act = (status: ReportStatus) =>
    resolve.mutate(
      { id: report.id, status, resolution: note.trim() || undefined },
      {
        onSuccess: () => toast.success("Şikayet güncellendi."),
        onError: (e) => toast.error(getErrorMessage(e, "Güncellenemedi.")),
      }
    );

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {report.target_type} #{report.target_id}
            </span>
            <span className="text-sm font-semibold text-rose-600 dark:text-rose-400">
              {REPORT_REASON_LABEL[report.reason]}
            </span>
          </div>
          {report.description && (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {report.description}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            Şikayet eden: rol {report.reporter_role} · #{report.reporter_id} ·{" "}
            {formatDateTime(report.created_at)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${REPORT_STATUS_STYLE[report.status]}`}
        >
          {REPORT_STATUS_LABEL[report.status]}
        </span>
      </div>

      {isOpen ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:flex-row">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Çözüm notu (opsiyonel)"
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
          <div className="flex gap-2">
            <button
              disabled={resolve.isPending}
              onClick={() => act(ReportStatus.RESOLVED)}
              className="rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              Çöz
            </button>
            <button
              disabled={resolve.isPending}
              onClick={() => act(ReportStatus.DISMISSED)}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
            >
              Reddet
            </button>
          </div>
        </div>
      ) : (
        report.resolution && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Çözüm notu: {report.resolution}
          </p>
        )
      )}
    </div>
  );
}

function ReportsSection() {
  const [filter, setFilter] = useState<ReportStatus | undefined>(
    ReportStatus.OPEN
  );
  const { data, isLoading } = useAdminReports(filter);

  const FILTERS: { value: ReportStatus | undefined; label: string }[] = [
    { value: ReportStatus.OPEN, label: "Açık" },
    { value: ReportStatus.RESOLVED, label: "Çözülen" },
    { value: ReportStatus.DISMISSED, label: "Reddedilen" },
    { value: undefined, label: "Tümü" },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              filter === f.value
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
      ) : data && data.length > 0 ? (
        <div className="space-y-3">
          {data.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700">
          Bu durumda şikayet yok.
        </p>
      )}
    </section>
  );
}

function NameChangeCard({ req }: { req: NameChangeRequest }) {
  const [note, setNote] = useState("");
  const approve = useApproveNameChange();
  const reject = useRejectNameChange();
  const isPending = req.status === "PENDING";
  const busy = approve.isPending || reject.isPending;

  const target =
    req.kind === "NAME"
      ? `${req.new_first_name ?? ""} ${req.new_last_name ?? ""}`.trim()
      : `@${req.new_username ?? ""}`;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {req.kind === "NAME" ? "Ad-Soyad" : "Kullanıcı adı"} · rol{" "}
              {req.role_id} · #{req.user_id}
            </span>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              → {target}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Gerekçe: {req.reason}
          </p>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            {formatDateTime(req.created_at)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {req.status === "PENDING"
            ? "Bekliyor"
            : req.status === "APPROVED"
              ? "Onaylandı"
              : "Reddedildi"}
        </span>
      </div>

      {isPending ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:flex-row">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Red notu (opsiyonel)"
            className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() =>
                approve.mutate(req.id, {
                  onSuccess: () => toast.success("Onaylandı."),
                  onError: (e) => toast.error(getErrorMessage(e, "Onaylanamadı.")),
                })
              }
              className="rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              Onayla
            </button>
            <button
              disabled={busy}
              onClick={() =>
                reject.mutate(
                  { id: req.id, note: note.trim() || undefined },
                  {
                    onSuccess: () => toast.success("Reddedildi."),
                    onError: (e) =>
                      toast.error(getErrorMessage(e, "Reddedilemedi.")),
                  }
                )
              }
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
            >
              Reddet
            </button>
          </div>
        </div>
      ) : (
        req.review_note && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Not: {req.review_note}
          </p>
        )
      )}
    </div>
  );
}

function NameChangesSection() {
  const [filter, setFilter] = useState<NameChangeStatus | undefined>("PENDING");
  const { data, isLoading } = useAdminNameChangeRequests(filter);

  const FILTERS: { value: NameChangeStatus | undefined; label: string }[] = [
    { value: "PENDING", label: "Bekleyen" },
    { value: "APPROVED", label: "Onaylanan" },
    { value: "REJECTED", label: "Reddedilen" },
    { value: undefined, label: "Tümü" },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              filter === f.value
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
      ) : data && data.length > 0 ? (
        <div className="space-y-3">
          {data.map((r) => (
            <NameChangeCard key={r.id} req={r} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700">
          Bu durumda talep yok.
        </p>
      )}
    </section>
  );
}

export default function AdminHome() {
  const [tab, setTab] = useState<Tab>("overview");
  const { data: openReports = 0 } = useOpenReportCount();

  return (
    <DashboardShell title="Admin Paneli">
      <div className="mx-auto max-w-5xl space-y-6 pb-12">
        <div className="flex gap-1.5 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === t.value
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {t.label}
              {t.value === "reports" && openReports > 0 && (
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                  {openReports > 9 ? "9+" : openReports}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <>
            <StatsSection />
            <PendingTutorsSection />
            <UsersTable />
          </>
        ) : tab === "listings" ? (
          <ListingManagement />
        ) : tab === "diplomas" ? (
          <DiplomaVerificationSection />
        ) : tab === "libraries" ? (
          <AdminLibraries />
        ) : tab === "catalogs" ? (
          <AdminExamCatalogs />
        ) : tab === "bookings" ? (
          <BookingManagement />
        ) : tab === "names" ? (
          <NameChangesSection />
        ) : (
          <ReportsSection />
        )}
      </div>
    </DashboardShell>
  );
}

