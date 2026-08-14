import { useRef, useState } from "react";
import {
  useAttendRegistration,
  useBulkUploadDocuments,
  useCancelSession,
  useCreateSession,
  useManageSessions,
  usePublishResults,
  useRoster,
  useSetResultSummary,
  useUpdateSession,
  useUploadResultDocument,
  useUploadSessionAnswerKey,
} from "@/hooks/useLibraryExams";
import { useUsableCatalogs } from "@/hooks/useExamCatalogs";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { ErrorState } from "@/components/admin/ui/PageState";
import { yoklamaSayaci } from "@/lib/operatorAgenda";
import { downloadResultsReference } from "@/api/libraryExams";
import { formatTRY } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { ExamSessionOut, ExamSessionWrite, RosterEntry } from "@/types";

const EXAM_TYPES = ["TYT", "AYT", "YKS", "YDT", "LGS", "KPSS", "DGS", "ALES"];

/** ISO → datetime-local input değeri ("YYYY-MM-DDTHH:mm", yerel saat). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface FormState {
  id?: number;
  catalog_id: number | null;
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
    catalog_id: null,
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
  const { data: sessions, isLoading, isError, refetch } = useManageSessions(libraryId);
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
      ) : isError ? (
        // Hata ≠ boş. Eskiden sunucu 500 dönerken ekran "Henüz oturum
        // eklenmedi" diyordu; operatör bunu "oturumlarım silinmiş" diye okur.
        <div data-testid="oturum-hata">
          <ErrorState
            description="Oturum listesi yüklenemedi. Listenin boş olduğu anlamına gelmez — bağlantını kontrol edip yeniden dene."
            onRetry={() => void refetch()}
          />
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <p
          data-testid="oturum-bos"
          className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400 dark:border-slate-700"
        >
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
    catalog_id: s.catalog_id ?? null,
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
  const [panel, setPanel] = useState<"none" | "roster" | "results">("none");
  const [iptalSoruluyor, setIptalSoruluyor] = useState(false);
  const cancel = useCancelSession();
  const cancelled = session.status === "CANCELLED";
  const isPast = new Date(session.starts_at).getTime() < Date.now();

  // `window.confirm` yerine uygulama diyaloğu: bu aksiyon ödeyen HERKESE iade
  // tetikler (para sonucu doğurur) ve tarayıcı diyaloğu ne kaç kişiyi
  // etkilediğini söyleyebilir, ne de "gönderiliyor" durumunu gösterebilir —
  // üstelik iOS'ta sistem penceresi sekme değişiminde sessizce kapanabiliyor.
  const doCancel = () => {
    cancel.mutate(session.id, {
      onSuccess: () => {
        toast.success("Oturum iptal edildi, iadeler yapıldı.");
        setIptalSoruluyor(false);
      },
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
            {session.catalog_name && (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                📘 {session.catalog_name}
              </span>
            )}
            {session.is_nationwide && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                Türkiye Geneli
              </span>
            )}
            {session.results_published ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                Sonuçlar yayında
              </span>
            ) : null}
            {cancelled && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                İptal
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {formatDateTime(session.starts_at)} · {session.duration_minutes} dk ·{" "}
            {formatTRY(session.price)} · {session.registered_count}/{session.capacity} kayıt
            {(session.results_entered_count ?? 0) > 0 &&
              ` · ${session.results_entered_count} sonuç girildi`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            onClick={() => setPanel((p) => (p === "roster" ? "none" : "roster"))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
          >
            Katılımcılar
          </button>
          {!cancelled && (
            <button
              onClick={() => setPanel((p) => (p === "results" ? "none" : "results"))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
            >
              Sonuçlar
            </button>
          )}
          {!cancelled && (
            <>
              <button
                onClick={onEdit}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
              >
                Düzenle
              </button>
              <button
                onClick={() => setIptalSoruluyor(true)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-slate-600"
              >
                İptal
              </button>
            </>
          )}
        </div>
      </div>
      {panel === "roster" && <RosterPanel sessionId={session.id} />}
      {panel === "results" && <ResultsPanel session={session} isPast={isPast} />}

      <ConfirmDialog
        open={iptalSoruluyor}
        danger
        title="Oturumu iptal et"
        description={`"${session.title}" iptal edilecek. Ödemesi alınmış ${session.registered_count} kayda iade yapılır; bu işlem geri alınamaz.`}
        confirmLabel="Oturumu iptal et"
        cancelLabel="Vazgeç"
        isPending={cancel.isPending}
        onClose={() => setIptalSoruluyor(false)}
        onConfirm={doCancel}
      />
    </div>
  );
}

function RosterPanel({ sessionId }: { sessionId: number }) {
  const { data, isLoading, isError, refetch } = useRoster(sessionId);
  const attend = useAttendRegistration();

  if (isLoading) {
    return <div className="mt-2 h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />;
  }
  if (isError) {
    return (
      <div data-testid="roster-hata" className="mt-2">
        <ErrorState
          description="Katılımcı listesi yüklenemedi. Kimsenin kayıtlı olmadığı anlamına gelmez."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <p data-testid="roster-bos" className="mt-2 text-xs text-slate-400">
        Henüz kayıtlı katılımcı yok.
      </p>
    );
  }

  const doAttend = (registrationId: number, name: string) => {
    attend.mutate(registrationId, {
      onSuccess: (res) =>
        toast.success(res.already ? `${name} zaten doğrulanmıştı.` : `${name} doğrulandı ✓`),
      onError: (e) => toast.error(getErrorMessage(e, "Doğrulama başarısız.")),
    });
  };

  // "Kim geldi kim gelmedi" sorusunun cevabı listeyi saymakla verilmemeli
  // (ölçüm §6.1/5): sayaç veriden hesaplanır, ek istek atılmaz.
  const sayac = yoklamaSayaci(data);

  return (
    <>
      <p
        data-testid="roster-sayaci"
        className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400"
      >
        {sayac.giren}/{sayac.toplam} giriş yapıldı
        {sayac.toplam > sayac.giren && (
          <span className="font-normal text-slate-400">
            {" "}
            · {sayac.toplam - sayac.giren} bekleniyor
          </span>
        )}
      </p>
      <ul className="mt-2 divide-y divide-slate-100 rounded-lg bg-slate-50 dark:divide-slate-700 dark:bg-slate-900/40">
      {data.map((r) => (
        <li key={r.registration_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{r.client_name}</span>
          {r.status === "ATTENDED" ? (
            <span className="shrink-0 text-xs font-semibold text-emerald-600">Katıldı ✓</span>
          ) : (
            <button
              onClick={() => doAttend(r.registration_id, r.client_name)}
              disabled={attend.isPending}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {attend.isPending ? "…" : "Giriş ver"}
            </button>
          )}
        </li>
      ))}
      </ul>
    </>
  );
}

/* ── Sonuç (karne) paneli ── */

function ResultsPanel({
  session,
  isPast,
}: {
  session: ExamSessionOut;
  isPast: boolean;
}) {
  const { data, isLoading, isError, refetch } = useRoster(session.id);
  const bulk = useBulkUploadDocuments(session.id);
  const publish = usePublishResults(session.id);
  const answerKey = useUploadSessionAnswerKey(session.id);
  const [yayinSoruluyor, setYayinSoruluyor] = useState(false);

  const bulkInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);

  const onReference = async () => {
    try {
      const blob = await downloadResultsReference(session.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `oturum-${session.id}-referans.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(getErrorMessage(e, "Referans indirilemedi."));
    }
  };

  const onBulk = (files: File[]) => {
    bulk.mutate(files, {
      onSuccess: (res) => {
        toast.success(`${res.matched} karne yüklendi${res.skipped ? `, ${res.skipped} eşlenemedi` : ""}.`);
        if (res.errors.length) toast.error(res.errors.slice(0, 3).join(" · "));
      },
      onError: (e) => toast.error(getErrorMessage(e, "Yükleme başarısız.")),
    });
  };

  // Yayınlama geri alınamaz: öğrencilere bildirim gider ve karneler açılır.
  const onPublish = () => {
    publish.mutate(undefined, {
      onSuccess: (res) => {
        toast.success(res.message);
        setYayinSoruluyor(false);
      },
      onError: (e) => toast.error(getErrorMessage(e, "Yayınlama başarısız.")),
    });
  };

  const onAnswerKey = (file: File) => {
    answerKey.mutate(file, {
      onSuccess: () => toast.success("Cevap anahtarı yüklendi."),
      onError: (e) => toast.error(getErrorMessage(e, "Yükleme başarısız.")),
    });
  };

  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
      <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
        Sonuç = her öğrencinin <b>karnesi</b> (PDF/görsel). Sıralama, ders ve konu kırılımı
        karnenin içindedir. İstersen satırda toplam net + sıralamayı özet olarak girebilirsin.
      </p>

      {/* Üst aksiyonlar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onReference}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          ⬇ Referans (CSV)
        </button>
        <button
          onClick={() => bulkInput.current?.click()}
          disabled={bulk.isPending}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {bulk.isPending ? "Yükleniyor…" : "⬆ Toplu Karne (PDF)"}
        </button>
        <input
          ref={bulkInput}
          type="file"
          accept="application/pdf,image/*"
          multiple
          hidden
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) onBulk(fs);
            e.target.value = "";
          }}
        />
        {!session.catalog_id && (
          <>
            <button
              onClick={() => keyInput.current?.click()}
              disabled={answerKey.isPending}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              {answerKey.isPending ? "Yükleniyor…" : "🔑 Cevap Anahtarı"}
            </button>
            <input
              ref={keyInput}
              type="file"
              accept="application/pdf,image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onAnswerKey(f);
                e.target.value = "";
              }}
            />
          </>
        )}
        <div className="ml-auto">
          <button
            onClick={() => setYayinSoruluyor(true)}
            disabled={publish.isPending || session.results_published}
            className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {publish.isPending ? "…" : session.results_published ? "Yayında ✓" : "Karneleri Yayınla"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={yayinSoruluyor}
        title="Karneleri yayınla"
        description="Karnesi yüklenmiş öğrencilere bildirim gidecek ve karnelerini görebilecekler. Yayınlama geri alınamaz."
        confirmLabel="Yayınla"
        cancelLabel="Vazgeç"
        isPending={publish.isPending}
        onClose={() => setYayinSoruluyor(false)}
        onConfirm={onPublish}
      />

      {session.catalog_id && (
        <p className="mb-2 text-[11px] text-slate-400 dark:text-slate-500">
          Cevap anahtarı katalogdan ({session.catalog_name}) gelir; admin tarafından yönetilir.
        </p>
      )}
      {!isPast && (
        <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">
          Bu oturumun tarihi henüz gelmedi — karneleri sınav sonrası yükleyin.
        </p>
      )}

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ) : isError ? (
        // Sonuç tablosu da roster'dan beslenir: hata "katılımcı yok" diye
        // görünürse operatör karneleri boşuna yüklemeye çalışır.
        <div data-testid="sonuc-roster-hata">
          <ErrorState
            description="Katılımcı listesi yüklenemedi; karne yükleme tablosu şu an eksik olabilir."
            onRetry={() => void refetch()}
          />
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-slate-400">Katılımcı yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-2 font-semibold">Öğrenci</th>
                <th className="px-1 py-1.5 font-semibold">Karne</th>
                <th className="px-1 py-1.5 font-semibold">Net</th>
                <th className="px-1 py-1.5 font-semibold">Sıra</th>
                <th className="px-1 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {data.map((r) => (
                <ResultRow key={r.registration_id} sessionId={session.id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultRow({ sessionId, row }: { sessionId: number; row: RosterEntry }) {
  const [net, setNet] = useState<string>(row.result_net ?? "");
  const [rank, setRank] = useState<string>(row.result_rank?.toString() ?? "");
  const summary = useSetResultSummary(sessionId);
  const upload = useUploadResultDocument(sessionId);
  const docInput = useRef<HTMLInputElement>(null);

  const dirty =
    net !== (row.result_net ?? "") || rank !== (row.result_rank?.toString() ?? "");

  const save = () => {
    summary.mutate(
      {
        registrationId: row.registration_id,
        payload: {
          net: net === "" ? null : Number(net),
          rank: rank === "" ? null : Number(rank),
        },
      },
      {
        onSuccess: () => toast.success("Özet kaydedildi."),
        onError: (e) => toast.error(getErrorMessage(e, "Kaydedilemedi.")),
      }
    );
  };

  const onDoc = (file: File) => {
    upload.mutate(
      { registrationId: row.registration_id, file },
      {
        onSuccess: () => toast.success("Karne yüklendi."),
        onError: (e) => toast.error(getErrorMessage(e, "Yükleme başarısız.")),
      }
    );
  };

  const numCls =
    "w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white";

  return (
    <tr>
      <td className="py-1.5 pr-2">
        <span className="text-slate-700 dark:text-slate-200">{row.client_name}</span>
        {row.status !== "ATTENDED" && (
          <span className="ml-1.5 text-[10px] text-amber-500" title="Henüz katılım doğrulanmadı">
            (giriş yok)
          </span>
        )}
      </td>
      <td className="px-1 py-1.5">
        <button
          onClick={() => docInput.current?.click()}
          disabled={upload.isPending}
          className={`rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
            row.result_document_url
              ? "border-emerald-300 text-emerald-600 dark:border-emerald-700"
              : "border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-500/10"
          }`}
        >
          {upload.isPending ? "…" : row.result_document_url ? "📄 Yüklendi ✓" : "📄 Karne yükle"}
        </button>
        <input
          ref={docInput}
          type="file"
          accept="application/pdf,image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onDoc(f);
            e.target.value = "";
          }}
        />
      </td>
      <td className="px-1 py-1.5">
        <input
          type="number"
          min={0}
          step="0.01"
          value={net}
          placeholder="—"
          onChange={(e) => setNet(e.target.value)}
          className={numCls}
        />
      </td>
      <td className="px-1 py-1.5">
        <input
          type="number"
          min={1}
          value={rank}
          placeholder="—"
          onChange={(e) => setRank(e.target.value)}
          className={numCls}
        />
      </td>
      <td className="px-1 py-1.5">
        <button
          onClick={save}
          disabled={summary.isPending || !dirty}
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {summary.isPending ? "…" : "Kaydet"}
        </button>
      </td>
    </tr>
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
  const { data: catalogs } = useUsableCatalogs();
  const busy = create.isPending || update.isPending;
  const isEdit = f.id != null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const onPickCatalog = (idStr: string) => {
    const id = idStr ? Number(idStr) : null;
    const cat = catalogs?.find((c) => c.id === id);
    setF((p) => ({
      ...p,
      catalog_id: id,
      // Katalog seçilince tür + (boşsa) başlığı ön-doldur.
      exam_type: cat ? cat.exam_type : p.exam_type,
      title: cat && !p.title.trim() ? cat.exam_name : p.title,
      duration_minutes: cat?.duration_minutes ?? p.duration_minutes,
    }));
  };

  const submit = () => {
    if (f.title.trim().length < 2) return toast.error("Başlık gerekli.");
    if (!f.starts_at) return toast.error("Tarih/saat gerekli.");
    const payload: ExamSessionWrite = {
      catalog_id: f.catalog_id,
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

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Deneme katalogu (opsiyonel)
          </span>
          <select
            value={f.catalog_id ?? ""}
            onChange={(e) => onPickCatalog(e.target.value)}
            className="input"
          >
            <option value="">Katalogsuz (tek seferlik)</option>
            {(catalogs ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.is_nationwide ? "🇹🇷 " : ""}
                {c.exam_name} ({c.exam_type})
                {c.publisher_name ? ` — ${c.publisher_name}` : ""}
              </option>
            ))}
          </select>
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
            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Ücret (TL)</span>
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
