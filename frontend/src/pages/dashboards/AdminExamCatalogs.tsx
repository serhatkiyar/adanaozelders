import { useRef, useState } from "react";
import {
  useCatalogs,
  useCreateCatalog,
  useDeleteCatalog,
  useUpdateCatalog,
  useUploadCatalogAnswerKey,
} from "@/hooks/useExamCatalogs";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { CatalogOut, CatalogWrite } from "@/types";

const EXAM_TYPES = ["TYT", "AYT", "YKS", "YDT", "LGS", "KPSS", "DGS", "ALES"];

interface FormState {
  id?: number;
  exam_name: string;
  exam_type: string;
  publisher_name: string;
  description: string;
  question_count: string;
  duration_minutes: string;
  is_public: boolean;
  is_nationwide: boolean;
}

function emptyForm(): FormState {
  return {
    exam_name: "",
    exam_type: "TYT",
    publisher_name: "",
    description: "",
    question_count: "",
    duration_minutes: "",
    is_public: true,
    is_nationwide: false,
  };
}

export default function AdminExamCatalogs() {
  const { data: catalogs, isLoading } = useCatalogs();
  const [editor, setEditor] = useState<FormState | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Deneme Katalogları
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Ortak deneme içerikleri (blueprint). Kütüphaneler oturum açarken bu kataloglardan
            seçer; cevap anahtarı tüm oturumlarda paylaşılır.
          </p>
        </div>
        <button
          onClick={() => setEditor(emptyForm())}
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          + Katalog
        </button>
      </div>

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
      ) : !catalogs || catalogs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-400 dark:border-slate-700">
          Henüz katalog eklenmedi. İlk ortak denemeyi oluştur.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {catalogs.map((c) => (
            <CatalogCard key={c.id} catalog={c} onEdit={() => setEditor(toForm(c))} />
          ))}
        </div>
      )}

      {editor && <CatalogEditor form={editor} onClose={() => setEditor(null)} />}
    </div>
  );
}

function toForm(c: CatalogOut): FormState {
  return {
    id: c.id,
    exam_name: c.exam_name,
    exam_type: c.exam_type,
    publisher_name: c.publisher_name ?? "",
    description: c.description ?? "",
    question_count: c.question_count?.toString() ?? "",
    duration_minutes: c.duration_minutes?.toString() ?? "",
    is_public: c.is_public,
    is_nationwide: c.is_nationwide,
  };
}

function CatalogCard({ catalog, onEdit }: { catalog: CatalogOut; onEdit: () => void }) {
  const del = useDeleteCatalog();
  const uploadKey = useUploadCatalogAnswerKey();
  const keyInput = useRef<HTMLInputElement>(null);

  const onDelete = () => {
    if (!window.confirm(`"${catalog.exam_name}" katalogunu sil?`)) return;
    del.mutate(catalog.id, {
      onSuccess: () => toast.success("Katalog silindi."),
      onError: (e) => toast.error(getErrorMessage(e, "Silinemedi.")),
    });
  };

  const onKey = (file: File) => {
    uploadKey.mutate(
      { id: catalog.id, file },
      {
        onSuccess: () => toast.success("Cevap anahtarı yüklendi."),
        onError: (e) => toast.error(getErrorMessage(e, "Yükleme başarısız.")),
      }
    );
  };

  return (
    <div className="flex flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
          {catalog.exam_type}
        </span>
        {catalog.is_nationwide && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            Türkiye Geneli
          </span>
        )}
        {!catalog.is_public && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            Gizli
          </span>
        )}
      </div>
      <h3 className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
        {catalog.exam_name}
      </h3>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {catalog.publisher_name || "Yayıncı belirtilmemiş"}
        {catalog.question_count ? ` · ${catalog.question_count} soru` : ""}
        {catalog.duration_minutes ? ` · ${catalog.duration_minutes} dk` : ""}
        {` · ${catalog.session_count} oturum`}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {catalog.answer_key_url ? (
          <a
            href={catalog.answer_key_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700"
          >
            🔑 Cevap anahtarı ✓
          </a>
        ) : null}
        <button
          onClick={() => keyInput.current?.click()}
          disabled={uploadKey.isPending}
          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300"
        >
          {uploadKey.isPending
            ? "Yükleniyor…"
            : catalog.answer_key_url
              ? "Değiştir"
              : "🔑 Cevap Anahtarı"}
        </button>
        <input
          ref={keyInput}
          type="file"
          accept="application/pdf,image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onKey(f);
            e.target.value = "";
          }}
        />
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={onEdit}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
          >
            Düzenle
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-slate-600"
          >
            Sil
          </button>
        </div>
      </div>
    </div>
  );
}

function CatalogEditor({ form, onClose }: { form: FormState; onClose: () => void }) {
  const [f, setF] = useState<FormState>(form);
  const create = useCreateCatalog();
  const update = useUpdateCatalog();
  const busy = create.isPending || update.isPending;
  const isEdit = f.id != null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const submit = () => {
    if (f.exam_name.trim().length < 2) return toast.error("Deneme adı gerekli.");
    const payload: CatalogWrite = {
      exam_name: f.exam_name.trim(),
      exam_type: f.exam_type,
      publisher_name: f.publisher_name.trim() || null,
      description: f.description.trim() || null,
      question_count: f.question_count ? Number(f.question_count) : null,
      duration_minutes: f.duration_minutes ? Number(f.duration_minutes) : null,
      is_public: f.is_public,
      is_nationwide: f.is_nationwide,
    };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? "Katalog güncellendi." : "Katalog oluşturuldu.");
        onClose();
      },
      onError: (e: unknown) => toast.error(getErrorMessage(e, "Kaydedilemedi.")),
    };
    if (isEdit) update.mutate({ id: f.id!, payload }, opts);
    else create.mutate(payload, opts);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-800">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          {isEdit ? "Katalogu Düzenle" : "Yeni Deneme Katalogu"}
        </h3>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Deneme adı</span>
          <input value={f.exam_name} onChange={(e) => set("exam_name", e.target.value)} className="input" placeholder="Türkiye Geneli YKS-1" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Sınav türü</span>
            <select value={f.exam_type} onChange={(e) => set("exam_type", e.target.value)} className="input">
              {EXAM_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Yayıncı</span>
            <input value={f.publisher_name} onChange={(e) => set("publisher_name", e.target.value)} className="input" placeholder="Özdebir" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Soru sayısı</span>
            <input type="number" min={0} value={f.question_count} onChange={(e) => set("question_count", e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Süre (dk)</span>
            <input type="number" min={0} value={f.duration_minutes} onChange={(e) => set("duration_minutes", e.target.value)} className="input" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Açıklama</span>
          <textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} className="input" />
        </label>
        <div className="flex flex-wrap gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={f.is_public} onChange={(e) => set("is_public", e.target.checked)} />
            Public (kütüphaneler kullanabilir)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={f.is_nationwide} onChange={(e) => set("is_nationwide", e.target.checked)} />
            Türkiye Geneli
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            Vazgeç
          </button>
          <button onClick={submit} disabled={busy} className="flex-[2] rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {busy ? "Kaydediliyor…" : isEdit ? "Güncelle" : "Oluştur"}
          </button>
        </div>
        {!isEdit && (
          <p className="text-[11px] text-slate-400">
            Cevap anahtarını oluşturduktan sonra katalog kartından yükleyebilirsin.
          </p>
        )}
      </div>
    </div>
  );
}
