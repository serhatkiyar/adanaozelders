import { FormEvent, useRef, useState } from "react";
import { Field } from "@/components/ui/Field";
import {
  useAddEducation,
  useDeleteEducation,
  useMyEducations,
  useUpdateEducation,
  useUploadEducationDocument,
} from "@/hooks/useEducations";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { DocumentType, Education, EducationCreate } from "@/types";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition duration-150 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ";

const fieldLabelCls =
  "mb-1.5 block text-xs font-medium text-slate-500 ";

const saveBtn =
  "rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";

const cancelBtn =
  "rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 ";

const labelCls =
  "text-xs font-semibold uppercase tracking-wide text-slate-400 ";

function subtitle(edu: Education): string | null {
  const parts = [edu.degree, edu.field_of_study].filter(Boolean) as string[];
  return parts.length ? parts.join(" · ") : null;
}

function yearRange(edu: Education): string | null {
  const { start_year, end_year } = edu;
  if (start_year && end_year) return `${start_year} – ${end_year}`;
  if (start_year) return `${start_year} – Devam`;
  if (end_year) return `${end_year}`;
  return null;
}

const CapIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    className="h-5 w-5"
    aria-hidden
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 14l9-5-9-5-9 5 9 5zm0 0v6m0-6l6.16-3.42A12 12 0 0 1 12 21a12 12 0 0 1-6.16-10.42L12 14z"
    />
  </svg>
);

/* ─── Form (add + edit) ──────────────────────────────────── */

const DOC_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: "DIPLOMA", label: "Diploma" },
  { value: "DENKLIK", label: "Denklik Belgesi (yurt dışı)" },
  { value: "OGRENCI_BELGESI", label: "Öğrenci Belgesi" },
];

function EducationForm({
  initial,
  pending,
  showVerification = false,
  onSubmit,
  onCancel,
}: {
  initial?: Education;
  pending: boolean;
  // Eğitmen bağlamı: e-Devlet belge türü + barkod alanlarını göster.
  showVerification?: boolean;
  onSubmit: (payload: EducationCreate) => void;
  onCancel: () => void;
}) {
  const [school, setSchool] = useState(initial?.school_name ?? "");
  const [degree, setDegree] = useState(initial?.degree ?? "");
  const [field, setField] = useState(initial?.field_of_study ?? "");
  const [startYear, setStartYear] = useState(
    initial?.start_year ? String(initial.start_year) : ""
  );
  const [endYear, setEndYear] = useState(
    initial?.end_year ? String(initial.end_year) : ""
  );
  const [docType, setDocType] = useState<DocumentType | "">(
    initial?.document_type ?? ""
  );
  const [barcode, setBarcode] = useState(initial?.verification_code ?? "");
  const [tckn, setTckn] = useState(initial?.verification_tckn ?? "");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!school.trim()) {
      toast.error("Okul adı boş olamaz.");
      return;
    }
    const start = startYear.trim() ? Number(startYear) : null;
    const end = endYear.trim() ? Number(endYear) : null;
    if (start !== null && end !== null && end < start) {
      toast.error("Bitiş yılı başlangıçtan önce olamaz.");
      return;
    }
    const tcknClean = tckn.trim();
    if (showVerification && tcknClean && !/^\d{11}$/.test(tcknClean)) {
      toast.error("TCKN 11 haneli rakam olmalı.");
      return;
    }
    onSubmit({
      school_name: school.trim(),
      degree: degree.trim() || null,
      field_of_study: field.trim() || null,
      start_year: start,
      end_year: end,
      ...(showVerification
        ? {
            document_type: docType || null,
            verification_code: barcode.trim() || null,
            verification_tckn: tcknClean || null,
          }
        : {}),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl bg-slate-50 p-4 "
    >
      <Field label="Okul" required labelClassName={fieldLabelCls}>
        {(id) => (
            <input
                    id={id}
              type="text"
              required
              maxLength={200}
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              className={inputCls}
              placeholder="Örn. Boğaziçi Üniversitesi"
              autoFocus
            />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Derece" labelClassName={fieldLabelCls}>
          {(id) => (
              <input
                    id={id}
                type="text"
                maxLength={100}
                value={degree}
                onChange={(e) => setDegree(e.target.value)}
                className={inputCls}
                placeholder="Lisans, Yüksek Lisans…"
              />
          )}
        </Field>
        <Field label="Bölüm / Alan" labelClassName={fieldLabelCls}>
          {(id) => (
              <input
                    id={id}
                type="text"
                maxLength={150}
                value={field}
                onChange={(e) => setField(e.target.value)}
                className={inputCls}
                placeholder="Matematik…"
              />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Başlangıç Yılı" labelClassName={fieldLabelCls}>
          {(id) => (
              <input
                    id={id}
                type="number"
                min={1950}
                max={2100}
                value={startYear}
                onChange={(e) => setStartYear(e.target.value)}
                className={inputCls}
                placeholder="2018"
              />
          )}
        </Field>
        <Field label="Bitiş Yılı" labelClassName={fieldLabelCls}>
          {(id) => (
              <input
                    id={id}
                type="number"
                min={1950}
                max={2100}
                value={endYear}
                onChange={(e) => setEndYear(e.target.value)}
                className={inputCls}
                placeholder="2022"
              />
          )}
        </Field>
      </div>

      {showVerification && (
        <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 ">
          <p className="text-xs font-semibold text-indigo-700 ">
            Diploma doğrulama (e-Devlet)
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Belge türü" labelClassName={fieldLabelCls}>
              {(id) => (
                  <select
                    id={id}
                    value={docType}
                    onChange={(e) => setDocType(e.target.value as DocumentType | "")}
                    className={inputCls}
                  >
                    <option value="">Seç…</option>
                    {DOC_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
              )}
            </Field>
            <Field label="e-Devlet doğrulama kodu / barkod" labelClassName={fieldLabelCls}>
              {(id) => (
                  <input
                    id={id}
                    type="text"
                    maxLength={60}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    className={inputCls}
                    placeholder="Örn. AB12-CD34-…"
                  />
              )}
            </Field>
          </div>
          <Field label="T.C. Kimlik No" labelClassName={fieldLabelCls}>
            {(id) => (
                <input
                    id={id}
                  type="text"
                  inputMode="numeric"
                  maxLength={11}
                  value={tckn}
                  onChange={(e) => setTckn(e.target.value.replace(/\D/g, ""))}
                  className={inputCls}
                  placeholder="11 haneli"
                  autoComplete="off"
                />
            )}
          </Field>
          <p className="text-[11px] leading-relaxed text-slate-500 ">
            e-Devlet → "Mezun Belgesi / Öğrenci Belgesi" alıp <strong>barkodlu</strong> PDF'i yükle,
            doğrulama kodunu ve TCKN'ni gir. e-Devlet doğrulaması barkodun yanında TCKN ister;
            bu bilgi <strong>yalnız yöneticiye</strong> gösterilir, herkese açık profilde görünmez.
            Belgedeki ad, hesabındaki adla aynı olmalı.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={cancelBtn}>
          İptal
        </button>
        <button type="submit" disabled={pending} className={saveBtn}>
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </form>
  );
}

/* ─── Item ───────────────────────────────────────────────── */

const DOC_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx";

function DiplomaIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

// Diploma/belge alanı: eğitmen panelinde yükle/değiştir, profilde indir linki.
function DocumentArea({
  edu,
  withDocument,
  onUploadDocument,
  uploading,
}: {
  edu: Education;
  withDocument: boolean;
  onUploadDocument?: (file: File) => void;
  uploading?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasDoc = !!edu.document_url;

  // Salt-okunur (profil) ve belge varsa: indirilebilir link.
  if (!withDocument) {
    if (!hasDoc) return null;
    return (
      <a
        href={edu.document_url!}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 "
      >
        <DiplomaIcon className="h-3.5 w-3.5" />
        Diploma / Belge
      </a>
    );
  }

  // Editable (eğitmen): yükle / değiştir.
  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        type="file"
        accept={DOC_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadDocument?.(f);
          e.target.value = "";
        }}
      />
      {hasDoc ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={edu.document_url!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 "
          >
            <DiplomaIcon className="h-3.5 w-3.5" />
            <span className="max-w-[160px] truncate">{edu.document_name || "Diploma"}</span>
          </a>
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50 "
          >
            {uploading ? "Yükleniyor…" : "Değiştir"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50 "
        >
          <DiplomaIcon className="h-3.5 w-3.5" />
          {uploading ? "Yükleniyor…" : "Diploma / Belge Yükle"}
        </button>
      )}
    </div>
  );
}

/** Eğitim kaydının diploma doğrulama durumu rozeti. Public (owner=false) yalnız
 *  VERIFIED'i görür; sahibi (owner=true) PENDING/REJECTED'i de görür. */
function VerificationStatusPill({ edu, owner }: { edu: Education; owner: boolean }) {
  const st = edu.verification_status;
  if (!st || st === "NONE") return null;

  if (st === "VERIFIED") {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="h-3 w-3" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        Diploma doğrulandı
      </span>
    );
  }
  if (!owner) return null; // public yalnız doğrulanmışı görür

  if (st === "PENDING") {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ">
        ⏳ Doğrulama bekleniyor
      </span>
    );
  }
  // REJECTED
  return (
    <div className="mt-1.5">
      <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ">
        ✕ Reddedildi
      </span>
      {edu.verification_note && (
        <p className="mt-1 text-[11px] text-rose-600 ">
          {edu.verification_note}
        </p>
      )}
    </div>
  );
}

function EducationItem({
  edu,
  editable,
  withDocument,
  onEdit,
  onDelete,
  onUploadDocument,
  uploading,
  deleting,
}: {
  edu: Education;
  editable: boolean;
  withDocument: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUploadDocument: (file: File) => void;
  uploading: boolean;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const sub = subtitle(edu);
  const years = yearRange(edu);

  return (
    <div className="flex gap-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ">
        {CapIcon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 ">
          {edu.school_name}
        </p>
        {sub && (
          <p className="mt-0.5 text-sm text-slate-600 ">
            {sub}
          </p>
        )}
        {years && (
          <p className="mt-0.5 text-xs text-slate-400 ">
            {years}
          </p>
        )}
        <DocumentArea
          edu={edu}
          withDocument={editable && withDocument}
          onUploadDocument={onUploadDocument}
          uploading={uploading}
        />
        {(withDocument || !editable) && (
          <VerificationStatusPill edu={edu} owner={editable} />
        )}
      </div>
      {editable && (
        <div className="flex shrink-0 items-start gap-1">
          {confirming ? (
            <>
              <button
                type="button"
                disabled={deleting}
                onClick={onDelete}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 "
              >
                {deleting ? "Siliniyor…" : "Sil"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-100 "
              >
                Vazgeç
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 "
              >
                Düzenle
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-100 "
              >
                Sil
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Section ────────────────────────────────────────────── */

interface EducationSectionProps {
  editable?: boolean;
  educations?: Education[]; // read-only mod için
  // Eğitmen ise diploma/belge yükleme kontrolünü göster (zorunlu kalite kapısı).
  withDocument?: boolean;
  /** Kendi kart kabuğu olmadan render et (üst kapsayıcı bölümü kendisi sağlar). */
  bare?: boolean;
}

export function EducationSection({
  editable = false,
  educations: readOnlyList,
  withDocument = false,
  bare = false,
}: EducationSectionProps) {
  const myEducations = useMyEducations(editable);
  const addMutation = useAddEducation();
  const updateMutation = useUpdateEducation();
  const deleteMutation = useDeleteEducation();
  const uploadMutation = useUploadEducationDocument();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const list = editable ? myEducations.data ?? [] : readOnlyList ?? [];
  const isLoading = editable && myEducations.isLoading;

  // Salt-okunur modda hiç kayıt yoksa bölümü tamamen gizle.
  if (!editable && list.length === 0) return null;

  const handleAdd = (payload: EducationCreate) =>
    addMutation.mutate(payload, {
      onSuccess: () => {
        toast.success("Eğitim bilgisi eklendi.");
        setAdding(false);
      },
      onError: (err) => toast.error(getErrorMessage(err, "Eklenemedi.")),
    });

  const handleUpdate = (id: number, payload: EducationCreate) =>
    updateMutation.mutate(
      { id, payload },
      {
        onSuccess: () => {
          toast.success("Eğitim bilgisi güncellendi.");
          setEditingId(null);
        },
        onError: (err) => toast.error(getErrorMessage(err, "Güncellenemedi.")),
      }
    );

  const handleDelete = (id: number) =>
    deleteMutation.mutate(id, {
      onSuccess: () => toast.success("Eğitim bilgisi silindi."),
      onError: (err) => toast.error(getErrorMessage(err, "Silinemedi.")),
    });

  const handleUploadDocument = (id: number, file: File) =>
    uploadMutation.mutate(
      { id, file },
      {
        onSuccess: () => toast.success("Diploma/belge yüklendi."),
        onError: (err) => toast.error(getErrorMessage(err, "Belge yüklenemedi.")),
      }
    );

  return (
    <div
      className={
        bare
          ? ""
          : "rounded-2xl bg-white px-6 py-5 shadow-sm ring-1 ring-slate-100 "
      }
    >
      <div className="flex items-center justify-between">
        <span className={labelCls}>Eğitim</span>
        {editable && !adding && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
            className="inline-flex min-h-[44px] items-center rounded-lg px-2.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 "
          >
            + Ekle
          </button>
        )}
      </div>

      <div className="mt-4 space-y-4">
        {isLoading ? (
          <div className="h-12 animate-pulse rounded-xl bg-slate-100 " />
        ) : (
          <>
            {list.map((edu) =>
              editable && editingId === edu.id ? (
                <EducationForm
                  key={edu.id}
                  initial={edu}
                  pending={updateMutation.isPending}
                  showVerification={withDocument}
                  onSubmit={(payload) => handleUpdate(edu.id, payload)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <EducationItem
                  key={edu.id}
                  edu={edu}
                  editable={editable}
                  withDocument={withDocument}
                  deleting={
                    deleteMutation.isPending &&
                    deleteMutation.variables === edu.id
                  }
                  uploading={
                    uploadMutation.isPending &&
                    uploadMutation.variables?.id === edu.id
                  }
                  onEdit={() => {
                    setAdding(false);
                    setEditingId(edu.id);
                  }}
                  onDelete={() => handleDelete(edu.id)}
                  onUploadDocument={(file) => handleUploadDocument(edu.id, file)}
                />
              )
            )}

            {editable && adding && (
              <EducationForm
                pending={addMutation.isPending}
                showVerification={withDocument}
                onSubmit={handleAdd}
                onCancel={() => setAdding(false)}
              />
            )}

            {editable && !adding && list.length === 0 && (
              <p className="text-sm italic text-slate-400 ">
                {withDocument
                  ? "Henüz eğitim bilgisi eklemedin. Eğitmen olarak en az bir eğitim ekleyip diploma/belge yüklemen ya da e-Devlet doğrulama barkodunu girmen gerekir; aksi halde ilanını onaya gönderemezsin."
                  : "Henüz eğitim bilgisi eklemedin. İstersen okul, derece ve yıl bilgilerini ekleyebilirsin (zorunlu değil)."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
