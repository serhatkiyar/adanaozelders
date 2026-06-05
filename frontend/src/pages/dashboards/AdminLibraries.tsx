import { useState } from "react";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import {
  LibraryEditorModal,
  emptyEditor,
  toEditorState,
  type EditorState,
} from "@/components/LibraryEditorModal";
import { useAdminLibraries, useDeleteLibrary } from "@/hooks/useLibraries";
import {
  useCreateOperator,
  useDeleteOperator,
  useOperators,
} from "@/hooks/useLibraryExams";
import { fetchLibraryAdmin } from "@/api/libraries";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { LibrarySearchOut } from "@/types";

export default function AdminLibraries() {
  const { data, isLoading, isError, error } = useAdminLibraries();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [managing, setManaging] = useState<LibrarySearchOut | null>(null);
  const del = useDeleteLibrary();

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
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {lib.name}
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
    </section>
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

