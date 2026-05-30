import { FormEvent, useState } from "react";
import {
  useAddEducation,
  useDeleteEducation,
  useMyEducations,
  useUpdateEducation,
} from "@/hooks/useEducations";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { Education, EducationCreate } from "@/types";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition duration-150 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/30";

const fieldLabelCls =
  "mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400";

const saveBtn =
  "rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";

const cancelBtn =
  "rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700";

const labelCls =
  "text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";

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

function EducationForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: Education;
  pending: boolean;
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
    onSubmit({
      school_name: school.trim(),
      degree: degree.trim() || null,
      field_of_study: field.trim() || null,
      start_year: start,
      end_year: end,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-700/40"
    >
      <div>
        <label className={fieldLabelCls}>Okul *</label>
        <input
          type="text"
          required
          maxLength={200}
          value={school}
          onChange={(e) => setSchool(e.target.value)}
          className={inputCls}
          placeholder="Örn. Boğaziçi Üniversitesi"
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabelCls}>Derece</label>
          <input
            type="text"
            maxLength={100}
            value={degree}
            onChange={(e) => setDegree(e.target.value)}
            className={inputCls}
            placeholder="Lisans, Yüksek Lisans…"
          />
        </div>
        <div>
          <label className={fieldLabelCls}>Bölüm / Alan</label>
          <input
            type="text"
            maxLength={150}
            value={field}
            onChange={(e) => setField(e.target.value)}
            className={inputCls}
            placeholder="Matematik…"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabelCls}>Başlangıç Yılı</label>
          <input
            type="number"
            min={1950}
            max={2100}
            value={startYear}
            onChange={(e) => setStartYear(e.target.value)}
            className={inputCls}
            placeholder="2018"
          />
        </div>
        <div>
          <label className={fieldLabelCls}>Bitiş Yılı</label>
          <input
            type="number"
            min={1950}
            max={2100}
            value={endYear}
            onChange={(e) => setEndYear(e.target.value)}
            className={inputCls}
            placeholder="2022"
          />
        </div>
      </div>
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

function EducationItem({
  edu,
  editable,
  onEdit,
  onDelete,
  deleting,
}: {
  edu: Education;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const sub = subtitle(edu);
  const years = yearRange(edu);

  return (
    <div className="flex gap-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
        {CapIcon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          {edu.school_name}
        </p>
        {sub && (
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
            {sub}
          </p>
        )}
        {years && (
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            {years}
          </p>
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
                className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                {deleting ? "Siliniyor…" : "Sil"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Vazgeç
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
              >
                Düzenle
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-700"
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
}

export function EducationSection({
  editable = false,
  educations: readOnlyList,
}: EducationSectionProps) {
  const myEducations = useMyEducations(editable);
  const addMutation = useAddEducation();
  const updateMutation = useUpdateEducation();
  const deleteMutation = useDeleteEducation();

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

  return (
    <div className="rounded-2xl bg-white px-6 py-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex items-center justify-between">
        <span className={labelCls}>Eğitim</span>
        {editable && !adding && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
          >
            + Ekle
          </button>
        )}
      </div>

      <div className="mt-4 space-y-4">
        {isLoading ? (
          <div className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700" />
        ) : (
          <>
            {list.map((edu) =>
              editable && editingId === edu.id ? (
                <EducationForm
                  key={edu.id}
                  initial={edu}
                  pending={updateMutation.isPending}
                  onSubmit={(payload) => handleUpdate(edu.id, payload)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <EducationItem
                  key={edu.id}
                  edu={edu}
                  editable={editable}
                  deleting={
                    deleteMutation.isPending &&
                    deleteMutation.variables === edu.id
                  }
                  onEdit={() => {
                    setAdding(false);
                    setEditingId(edu.id);
                  }}
                  onDelete={() => handleDelete(edu.id)}
                />
              )
            )}

            {editable && adding && (
              <EducationForm
                pending={addMutation.isPending}
                onSubmit={handleAdd}
                onCancel={() => setAdding(false)}
              />
            )}

            {editable && !adding && list.length === 0 && (
              <p className="text-sm italic text-slate-400 dark:text-slate-500">
                Henüz eğitim bilgisi eklemedin. İstersen okul, derece ve yıl
                bilgilerini ekleyebilirsin (zorunlu değil).
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
