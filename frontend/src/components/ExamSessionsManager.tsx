import { useState } from "react";
import {
  useCancelSession,
  useCreateSession,
  useManageSessions,
  useRoster,
  useUpdateSession,
} from "@/hooks/useLibraryExams";
import { formatTRY } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { ExamSessionOut, ExamSessionWrite } from "@/types";

const EXAM_TYPES = ["TYT", "AYT", "YKS", "YDT", "LGS", "KPSS", "DGS", "ALES"];

/** ISO → datetime-local input değeri ("YYYY-MM-DDTHH:mm", yerel saat). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface FormState {
  id?: number;
  exam_type: string;
  title: string;
  description: string;
  starts_at: string; // datetime-local
  duration_minutes: number;
  capacity: number;
  price: number;
}

function emptyForm(): FormState {
  return {
    exam_type: "TYT",
    title: "",
    description: "",
    starts_at: "",
    duration_minutes: 180,
    capacity: 50,
    price: 0,
  };
}

export function ExamSessionsManager({ libraryId }: { libraryId: number }) {
  const { data: sessions, isLoading } = useManageSessions(libraryId);
  const [editor, setEditor] = useState<FormState | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
          Deneme Oturumları
        </h3>
        <button
          onClick={() => setEditor(emptyForm())}
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          + Oturum
        </button>
      </div>

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      ) : !sessions || sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
          Henüz oturum eklenmedi.
        </p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} onEdit={() => setEditor(toForm(s))} />
          ))}
        </div>
      )}

      {editor && (
        <SessionEditor
          libraryId={libraryId}
          form={editor}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function toForm(s: ExamSessionOut): FormState {
  return {
    id: s.id,
    exam_type: s.exam_type,
    title: s.title,
    description: s.description ?? "",
    starts_at: isoToLocalInput(s.starts_at),
    duration_minutes: s.duration_minutes,
    capacity: s.capacity,
    price: Number(s.price),
  };
}

function SessionRow({
  session,
  onEdit,
}: {
  session: ExamSessionOut;
  onEdit: () => void;
}) {
  const [showRoster, setShowRoster] = useState(false);
  const cancel = useCancelSession();
  const cancelled = session.status === "CANCELLED";

  const doCancel = () => {
    if (!window.confirm("Oturumu iptal et? Ödeyenlere iade yapılır.")) return;
    cancel.mutate(session.id, {
      onSuccess: () => toast.success("Oturum iptal edildi, iadeler yapıldı."),
      onError: (e) => toast.error(getErrorMessage(e, "İptal başarısız.")),
    });
  };

  return (
    <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-700">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
              {session.exam_type}
            </span>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              {session.title}
            </span>
            {cancelled && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                İptal
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {formatDateTime(session.starts_at)} · {session.duration_minutes} dk ·{" "}
            {formatTRY(session.price)} · {session.registered_count}/{session.capacity} kayıt
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setShowRoster((v) => !v)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
          >
            Katılımcılar
          </button>
          {!cancelled && (
            <>
              <button
                onClick={onEdit}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
              >
                Düzenle
              </button>
              <button
                onClick={doCancel}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-slate-600"
              >
                İptal
              </button>
            </>
          )}
        </div>
      </div>
      {showRoster && <RosterPanel sessionId={session.id} />}
    </div>
  );
}

function RosterPanel({ sessionId }: { sessionId: number }) {
  const { data, isLoading } = useRoster(sessionId);
  if (isLoading) {
    return <div className="mt-2 h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />;
  }
  if (!data || data.length === 0) {
    return <p className="mt-2 text-xs text-slate-400">Henüz kayıtlı katılımcı yok.</p>;
  }
  return (
    <ul className="mt-2 divide-y divide-slate-100 rounded-lg bg-slate-50 dark:divide-slate-700 dark:bg-slate-900/40">
      {data.map((r) => (
        <li key={r.registration_id} className="flex items-center justify-between px-3 py-2 text-sm">
          <span className="text-slate-700 dark:text-slate-200">{r.client_name}</span>
          <span
            className={`text-xs font-semibold ${
              r.status === "ATTENDED" ? "text-emerald-600" : "text-amber-600"
            }`}
          >
            {r.status === "ATTENDED" ? "Katıldı ✓" : "Bekliyor"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SessionEditor({
  libraryId,
  form,
  onClose,
}: {
  libraryId: number;
  form: FormState;
  onClose: () => void;
}) {
  const [f, setF] = useState<FormState>(form);
  const create = useCreateSession(libraryId);
  const update = useUpdateSession();
  const busy = create.isPending || update.isPending;
  const isEdit = f.id != null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const submit = () => {
    if (f.title.trim().length < 2) return toast.error("Başlık gerekli.");
    if (!f.starts_at) return toast.error("Tarih/saat gerekli.");
    const payload: ExamSessionWrite = {
      exam_type: f.exam_type,
      title: f.title.trim(),
      description: f.description.trim() || null,
      starts_at: new Date(f.starts_at).toISOString(),
      duration_minutes: f.duration_minutes,
      capacity: f.capacity,
      price: f.price,
    };
    const opts = {
      onSuccess: () => {
        toast.success(isEdit ? "Oturum güncellendi." : "Oturum eklendi.");
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
          {isEdit ? "Oturumu Düzenle" : "Yeni Deneme Oturumu"}
        </h3>
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
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Ücret (₺)</span>
            <input type="number" min={0} value={f.price} onChange={(e) => set("price", Number(e.target.value))} className="input" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Başlık</span>
          <input value={f.title} onChange={(e) => set("title", e.target.value)} className="input" placeholder="Mart TYT Genel Denemesi" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Açıklama</span>
          <textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} className="input" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Tarih & saat</span>
            <input type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Süre (dk)</span>
            <input type="number" min={1} value={f.duration_minutes} onChange={(e) => set("duration_minutes", Number(e.target.value))} className="input" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Kontenjan</span>
          <input type="number" min={1} value={f.capacity} onChange={(e) => set("capacity", Number(e.target.value))} className="input" />
        </label>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            Vazgeç
          </button>
          <button onClick={submit} disabled={busy} className="flex-[2] rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {busy ? "Kaydediliyor…" : isEdit ? "Güncelle" : "Ekle"}
          </button>
        </div>
      </div>
    </div>
  );
}
