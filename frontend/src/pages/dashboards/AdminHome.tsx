import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ConfirmDialog, ReasonDialog } from "@/components/admin/ui";
import {
  useActivateTutor,
  useAdminTutors,
  useApproveTutor,
  useDeleteTutor,
  useRejectTutor,
  useSuspendTutor,
  usePendingEducations,
  useVerifyEducation,
} from "@/hooks/useAdmin";
import {
  useAdminNameChangeRequests,
  useApproveNameChange,
  useRejectNameChange,
} from "@/hooks/useNameChanges";
import {
  TutorStatus,
  type AdminEducation,
  type DocumentType,
  type NameChangeRequest,
  type NameChangeStatus,
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

/* ─── listing management ─────────────────────────────── */

function ListingRow({ tutor }: { tutor: TutorOut }) {
  const { canManage } = useAdminAreaAccess("tutors");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const suspend = useSuspendTutor();
  const activate = useActivateTutor();
  const approve = useApproveTutor();
  const reject = useRejectTutor();
  const del = useDeleteTutor();
  const busy =
    suspend.isPending ||
    activate.isPending ||
    del.isPending ||
    approve.isPending ||
    reject.isPending;
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

  return (
    <>
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

      {canManage && (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/* Onay kuyruğu aksiyonları. P1-1: bunlar eskiden `AdminHome`'un
            ULAŞILAMAZ "overview" dalındaki ayrı bir kartta duruyordu; admin
            onaylamak için ya SQL'e iniyor ya eğitmeni siliyordu. */}
        {tutor.status === TutorStatus.PENDING_APPROVAL && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                run(approve, `${tutor.full_name} onaylandı.`, "Onaylama başarısız.")
              }
              className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:opacity-60"
            >
              Onayla
            </button>
            <button
              disabled={busy}
              onClick={() => setRejectOpen(true)}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 active:scale-95 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-red-900/20"
            >
              Reddet
            </button>
          </>
        )}
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
          onClick={() => setDeleteOpen(true)}
          className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 active:scale-95 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-red-900/20"
        >
          Sil
        </button>
      </div>
      )}
    </div>
    <ConfirmDialog
      open={deleteOpen}
      title="İlanı yayından kaldır"
      description={`${tutor.full_name} ilanı silinecek ve yayından kaldırılacak.`}
      confirmLabel="İlanı sil"
      danger
      isPending={del.isPending}
      onClose={() => setDeleteOpen(false)}
      onConfirm={() => del.mutate(tutor.id, {
        onSuccess: () => { toast.success("İlan silindi."); setDeleteOpen(false); },
        onError: (error) => toast.error(getErrorMessage(error, "Silme başarısız.")),
      })}
    />
    {/* Red GEREKÇESİ zorunlu (backend `TutorRejectIn`): karar denetim izine
        gerekçesiz yazılamaz ve eğitmen neden reddedildiğini öğrenemezdi. */}
    <ReasonDialog
      open={rejectOpen}
      title="Başvuruyu reddet"
      description={`${tutor.full_name} başvurusu reddedilecek. Gerekçe denetim izine yazılır.`}
      label="Red gerekçesi"
      placeholder="Örn. Diploma barkodu e-Devlet'te doğrulanamadı."
      required
      minLength={3}
      maxLength={500}
      confirmLabel="Başvuruyu reddet"
      danger
      isPending={reject.isPending}
      onClose={() => setRejectOpen(false)}
      onConfirm={(reason) =>
        reject.mutate(
          { id: tutor.id, reason },
          {
            onSuccess: () => {
              toast.success(`${tutor.full_name} reddedildi.`);
              setRejectOpen(false);
            },
            onError: (error) =>
              toast.error(getErrorMessage(error, "Reddetme başarısız.")),
          }
        )
      }
    />
    </>
  );
}

// Onay bekleyenler kuyruktur; listenin BAŞINDA durur. (Eskiden 2. sıradaydı ve
// zaten aksiyonu yoktu.)
const STATUS_ORDER: Record<TutorStatus, number> = {
  [TutorStatus.PENDING_APPROVAL]: 0,
  [TutorStatus.APPROVED]: 1,
  [TutorStatus.SUSPENDED]: 2,
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
  const pending = tutors.filter((t) => t.status === TutorStatus.PENDING_APPROVAL);
  const digerleri = tutors.filter((t) => t.status !== TutorStatus.PENDING_APPROVAL);

  if (tutors.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        Henüz ilan yok.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Onay kuyruğu — yalnız iş VARKEN başlık basılır; boş bir "0 başvuru"
          bölümü operatörün gözünü alıştırır ve gerçek kuyruk fark edilmez. */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Onay Bekleyen Eğitmenler
            </h2>
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
              {pending.length}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Bu başvurular incelemenizi bekliyor. Onay ilanı yayına alır; red
            gerekçesi denetim izine yazılır.
          </p>
          {pending.map((t) => (
            <ListingRow key={t.id} tutor={t} />
          ))}
        </section>
      )}

      <div className="space-y-3">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {tutors.length} ilan · yayındakileri kaldırabilir, pasifleri geri
          açabilir veya silebilirsin.
        </p>
        {digerleri.map((t) => (
          <ListingRow key={t.id} tutor={t} />
        ))}
      </div>
    </div>
  );
}

/* ─── booking management ────────────────────────────── */

/* ─── tabs ────────────────────────────────────────────── */

// P1-1: "overview" ULAŞILAMAZ bir daldı — `AdminSectionPage` prop tipi onu
// hiç geçirmiyordu ve `App.tsx` ADMIN kökünü `/yonetim`'e (AdminDashboardPage)
// yönlendiriyor. Dal SİLİNDİ; içindeki tek canlı özellik (eğitmen onay kuyruğu)
// `listings` bölümüne taşındı.
export type Tab = "listings" | "diplomas" | "names";

/* ─── diploma doğrulama kuyruğu ───────────────────────── */

const DOC_TYPE_LABEL: Record<DocumentType, string> = {
  DIPLOMA: "Diploma",
  DENKLIK: "Denklik Belgesi",
  OGRENCI_BELGESI: "Öğrenci Belgesi",
};

function EducationVerifyCard({ edu }: { edu: AdminEducation }) {
  const { canManage } = useAdminAreaAccess("tutors");
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

      {!canManage ? null : rejecting ? (
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

function NameChangeCard({ req }: { req: NameChangeRequest }) {
  const { canManage } = useAdminAreaAccess("users");
  const [note, setNote] = useState("");
  const approve = useApproveNameChange();
  const reject = useRejectNameChange();
  const isPending = canManage && req.status === "PENDING";
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

const SECTION_AREA: Record<Tab, string> = {
  listings: "tutors",
  diplomas: "tutors",
  names: "users",
};
const SECTION_LABEL: Record<Tab, string> = {
  listings: "Eğitmen ilanları",
  diplomas: "Diploma doğrulama",
  names: "Ad değişiklikleri",
};

export default function AdminHome({ section }: { section: Tab }) {
  const { canView, canManage } = useAdminAreaAccess(SECTION_AREA[section]);
  if (!canView) return <AccessDenied area={SECTION_LABEL[section]} />;
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
        {!canManage && <ReadOnlyNotice />}
        {section === "listings" ? (
          <ListingManagement />
        ) : section === "diplomas" ? (
          <DiplomaVerificationSection />
        ) : (
          <NameChangesSection />
        )}
    </div>
  );
}

