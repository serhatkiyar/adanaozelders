import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog, ErrorState, ReasonDialog } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
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
    cls: "bg-slate-100 text-slate-600 ",
  },
  [TutorStatus.PENDING_APPROVAL]: {
    label: "Onay Bekliyor",
    cls: "bg-amber-50 text-amber-700 ",
  },
  [TutorStatus.APPROVED]: {
    label: "Yayında",
    cls: "bg-emerald-50 text-emerald-700 ",
  },
  [TutorStatus.REJECTED]: {
    label: "Reddedildi",
    cls: "bg-red-50 text-red-700 ",
  },
  [TutorStatus.SUSPENDED]: {
    label: "Pasif",
    cls: "bg-slate-100 text-slate-500 ",
  },
};

/** Adresten gelen talep filtresi için BEYAZ LİSTE (İP-A7d3). */
const GECERLI_TALEP_DURUMLARI = new Set<string>([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "TUMU",
]);

/* ─── listing management ─────────────────────────────── */

function ListingRow({ tutor }: { tutor: TutorOut }) {
  const { canManage } = useAdminAreaAccess("tutors");
  // İP-A7d3: pencere durumu ekranda yaşamaz (İP-A4 sözleşmesi).
  const silmeYuzeyi = useDuzenlemeYuzeyi<never, void>();
  const redYuzeyi = useDuzenlemeYuzeyi<never, void>();
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
    <div className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar name={tutor.full_name} avatar_url={tutor.avatar_url} size="sm" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900 ">
              {tutor.full_name}
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}
            >
              {meta.label}
            </span>
          </div>
          {tutor.headline && (
            <p className="mt-0.5 truncate text-xs text-slate-500 ">
              {tutor.headline}
            </p>
          )}
          <p className="mt-0.5 text-xs text-slate-400 ">
            {formatRate(tutor.hourly_rate)}
          </p>
        </div>
      </div>

      {canManage && (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/* Onay kuyruğu aksiyonları. P1-1: bunlar eskiden `AdminHome`'un
            ULAŞILAMAZ "overview" dalındaki ayrı bir kartta duruyordu; admin
            onaylamak için ya SQL'e iniyor ya öğretmeni siliyordu. */}
        {tutor.status === TutorStatus.PENDING_APPROVAL && (
          <>
            <Button
              size="sm"
              variant="success"
              className="rounded-xl"
              disabled={busy}
              onClick={() =>
                run(approve, `${tutor.full_name} onaylandı.`, "Onaylama başarısız.")
              }
            >
              Onayla
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-xl text-red-600 hover:bg-red-50 "
              disabled={busy}
              onClick={() => redYuzeyi.yeniAc()}
            >
              Reddet
            </Button>
          </>
        )}
        {tutor.status === TutorStatus.APPROVED && (
          <Button
            size="sm"
            variant="secondary"
            className="rounded-xl"
            disabled={busy}
            onClick={() =>
              run(suspend, "İlan yayından kaldırıldı.", "İşlem başarısız.")
            }
          >
            Yayından Kaldır
          </Button>
        )}
        {tutor.status === TutorStatus.SUSPENDED && (
          <Button
            size="sm"
            variant="success"
            className="rounded-xl"
            disabled={busy}
            onClick={() =>
              run(activate, "İlan yeniden yayında.", "İşlem başarısız.")
            }
          >
            Yeniden Yayınla
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="rounded-xl text-red-600 hover:bg-red-50 "
          disabled={busy}
          onClick={() => silmeYuzeyi.yeniAc()}
        >
          Sil
        </Button>
      </div>
      )}
    </div>
    <ConfirmDialog
      open={silmeYuzeyi.acik}
      title="İlanı yayından kaldır"
      description={`${tutor.full_name} ilanı silinecek ve yayından kaldırılacak.`}
      confirmLabel="İlanı sil"
      danger
      isPending={del.isPending}
      onClose={silmeYuzeyi.kapat}
      onConfirm={() => del.mutate(tutor.id, {
        onSuccess: () => { toast.success("İlan silindi."); silmeYuzeyi.kapat(); },
        onError: (error) => toast.error(getErrorMessage(error, "Silme başarısız.")),
      })}
    />
    {/* Red GEREKÇESİ zorunlu (backend `TutorRejectIn`): karar denetim izine
        gerekçesiz yazılamaz ve öğretmen neden reddedildiğini öğrenemezdi. */}
    <ReasonDialog
      open={redYuzeyi.acik}
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
      onClose={redYuzeyi.kapat}
      onConfirm={(reason) =>
        reject.mutate(
          { id: tutor.id, reason },
          {
            onSuccess: () => {
              toast.success(`${tutor.full_name} reddedildi.`);
              redYuzeyi.kapat();
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
            className="h-24 animate-pulse rounded-2xl bg-slate-100 "
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return <ErrorState description={getErrorMessage(error, "İlanlar yüklenemedi.")} />;
  }

  const tutors = [...(data ?? [])].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  );
  const pending = tutors.filter((t) => t.status === TutorStatus.PENDING_APPROVAL);
  const digerleri = tutors.filter((t) => t.status !== TutorStatus.PENDING_APPROVAL);

  if (tutors.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-500 ">
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
            <h2 className="text-base font-semibold text-slate-900 ">
              Onay Bekleyen Öğretmenler
            </h2>
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
              {pending.length}
            </span>
          </div>
          <p className="text-xs text-slate-500 ">
            Bu başvurular incelemenizi bekliyor. Onay ilanı yayına alır; red
            gerekçesi denetim izine yazılır.
          </p>
          {pending.map((t) => (
            <ListingRow key={t.id} tutor={t} />
          ))}
        </section>
      )}

      {digerleri.length > 0 && (
        <div className="space-y-3">
          {/* Sayı ALTTAKİ listeye ait olmalı: toplam ilan sayısını yazmak,
              onay kuyruğu ayrıldıktan sonra "N ilan" deyip N'den az satır
              göstermek demekti. */}
          <p className="text-xs text-slate-400 ">
            {digerleri.length} ilan · yayındakileri kaldırabilir, pasifleri geri
            açabilir veya silebilirsin.
          </p>
          {digerleri.map((t) => (
            <ListingRow key={t.id} tutor={t} />
          ))}
        </div>
      )}
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
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 ">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 ">
            {edu.tutor_name ?? `Öğretmen #${edu.tutor_id}`}
          </p>
          <p className="mt-0.5 text-sm text-slate-600 ">{edu.school_name}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {[edu.degree, edu.field_of_study].filter(Boolean).join(" · ")}
          </p>
        </div>
        {edu.document_type && (
          <span className="shrink-0 rounded-full bg-marka-soft px-2.5 py-0.5 text-xs font-semibold text-marka-metin-hover ">
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
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 "
          >
            📄 Belgeyi aç
          </a>
        )}
        <a
          href="https://www.turkiye.gov.tr/belge-dogrulama"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 "
        >
          🔗 e-Devlet'te doğrula
        </a>
        {edu.verification_code ? (
          <span className="select-all rounded-lg bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-600 ">
            Barkod: {edu.verification_code}
          </span>
        ) : (
          <span className="text-xs font-medium text-amber-600 ">
            ⚠ Barkod girilmemiş
          </span>
        )}
        {edu.verification_tckn ? (
          <span className="select-all rounded-lg bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-600 ">
            TCKN: {edu.verification_tckn}
          </span>
        ) : (
          <span className="text-xs font-medium text-amber-600 ">
            ⚠ TCKN girilmemiş
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400 ">
        Belgedeki ad, öğretmenin hesap adıyla (<strong>{edu.tutor_name}</strong>) aynı olmalı (aitlik);
        barkodu e-Devlet'te teyit et (sahihlik).
      </p>

      {!canManage ? null : rejecting ? (
        <div className="mt-3 space-y-2">
          {/* İP-A7d3: alan ADSIZDI — `placeholder` etiket yerine kullanılıyordu.
              Bir öğretmene gösterilecek red gerekçesi yazılan yer burası. */}
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700 ">
              Red nedeni (öğretmene gösterilir)
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-400 "
            />
          </label>
          <div className="flex gap-2">
            <Button
              variant="danger"
              className="rounded-lg"
              isPending={verify.isPending}
              onClick={doReject}
            >
              Reddet
            </Button>
            <Button variant="ghost" className="rounded-lg" onClick={() => setRejecting(false)}>
              Vazgeç
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button
            variant="success"
            className="rounded-lg"
            isPending={verify.isPending}
            onClick={doVerify}
          >
            ✓ Doğrula
          </Button>
          <Button
            variant="secondary"
            className="rounded-lg"
            disabled={verify.isPending}
            onClick={() => setRejecting(true)}
          >
            Reddet
          </Button>
        </div>
      )}
    </div>
  );
}

function DiplomaVerificationSection() {
  const { data, isLoading, isError, error, refetch } = usePendingEducations();
  const list = data ?? [];

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 " />;
  }

  // P1-6: hata "teyit bekleyen belge yok 🎉" diye gösterilemez — yönetici
  // kuyruğu boş sanıp bekleyen diplomayı atlar.
  if (isError) {
    return (
      <ErrorState
        description={getErrorMessage(error, "Diploma kuyruğu yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900 ">
          Teyit Bekleyen Diplomalar
        </h2>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 ">
          {list.length}
        </span>
      </div>
      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-12 text-center ">
          <p className="text-sm font-medium text-slate-600 ">
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

  // Kullanıcı adı dalı 5 Eyl 2026'da kaldırıldı; geriye yalnız ad değişikliği
  // talebi kaldı (`kind === "NAME"`).
  const target = `${req.new_first_name ?? ""} ${req.new_last_name ?? ""}`.trim();

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 ">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 ">
              {req.kind === "NAME" ? "Ad-Soyad" : "Kullanıcı adı"} · rol{" "}
              {req.role_id} · #{req.user_id}
            </span>
            <span className="text-sm font-semibold text-slate-900 ">
              → {target}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600 ">
            Gerekçe: {req.reason}
          </p>
          <p className="mt-2 text-xs text-slate-400 ">
            {formatDateTime(req.created_at)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 ">
          {req.status === "PENDING"
            ? "Bekliyor"
            : req.status === "APPROVED"
              ? "Onaylandı"
              : "Reddedildi"}
        </span>
      </div>

      {isPending ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row">
          {/* İP-A7d3: alan ADSIZDI (`placeholder` etiket yerine). */}
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold text-slate-500 ">
              Red notu (opsiyonel)
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-marka-mid "
            />
          </label>
          <div className="flex gap-2">
            <Button
              variant="success"
              className="rounded-xl"
              disabled={busy}
              onClick={() =>
                approve.mutate(req.id, {
                  onSuccess: () => toast.success("Onaylandı."),
                  onError: (e) => toast.error(getErrorMessage(e, "Onaylanamadı.")),
                })
              }
            >
              Onayla
            </Button>
            <Button
              variant="secondary"
              className="rounded-xl"
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
            >
              Reddet
            </Button>
          </div>
        </div>
      ) : (
        req.review_note && (
          <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500 ">
            Not: {req.review_note}
          </p>
        )
      )}
    </div>
  );
}

function NameChangesSection() {
  // ── İP-A7d3: filtre ADRESTE yaşar ("filtreler URL'de" kilitli kararı) ──
  //
  // `useState`teyken paylaşılan bağlantı hep "Bekleyen"e düşüyordu ve geri
  // tuşu filtre değişimini görmüyordu. Beyaz liste `useUrlDurumu`ya
  // devredilemez: kanca tipi ve varsayılanı yönetir, `?talep=drop_table` gibi
  // bir değeri eleyemez.
  const url = useUrlDurumu({ talep: "PENDING" });
  const hamFiltre = String(url.degerler.talep);
  const filter = (GECERLI_TALEP_DURUMLARI.has(hamFiltre) ? hamFiltre : "TUMU") as
    | NameChangeStatus
    | "TUMU";
  const setFilter = (v: NameChangeStatus | undefined) =>
    url.ayarla({ talep: v ?? "TUMU" });
  const { data, isLoading, isError, error, refetch } = useAdminNameChangeRequests(
    filter === "TUMU" ? undefined : filter
  );

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
          // BİLİNÇLİ ham <button>: aksiyon değil SEÇİM DURUMU (aria-pressed).
          // Ortak Button'ın dolgu/gölge varyantları süzgeç çipi dilini
          // taşımıyor — PackagesPage'in durum süzgeci çipleriyle aynı
          // istisna. A7d3'te EKSİK olan aria-pressed eklendi.
          <button
            key={f.label}
            type="button"
            aria-pressed={filter === (f.value ?? "TUMU")}
            onClick={() => setFilter(f.value)}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              filter === (f.value ?? "TUMU")
                ? "bg-marka text-marka-fg"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 "
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100 " />
      ) : isError ? (
        <ErrorState
          description={getErrorMessage(error, "Talepler yüklenemedi.")}
          onRetry={() => void refetch()}
        />
      ) : data && data.length > 0 ? (
        <div className="space-y-3">
          {data.map((r) => (
            <NameChangeCard key={r.id} req={r} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-100 ">
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
  listings: "Öğretmen ilanları",
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

