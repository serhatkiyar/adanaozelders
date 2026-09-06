import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Button } from "@/components/admin/ui/Button";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { ErrorState } from "@/components/admin/ui/PageState";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
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

/**
 * Oturum formu şeması (İP-A7d2 · Görev 4).
 *
 * Doğrulama A7d2'ye kadar `submit()` içinde elle yapılıyordu ve ilk hata
 * `toast.error` ile ekranın köşesine düşüyordu: kullanıcı HANGİ alanı
 * düzelteceğini göremiyordu, ekran okuyucu hiç göremiyordu. Kural artık
 * şemada, mesaj alanın altında (`role="alert"` + `aria-invalid`).
 *
 * Sayısal alanlar `coerce` ile okunur: `<input type="number">`ın değeri
 * DAİMA string'tir ve `Number("")` sıfırdır — eskiden boş kontenjan sessizce
 * 0 olarak sunucuya gidiyordu.
 */
/** En az `enAz` olan, boş bırakılamayan sayı alanı. */
function sayiAlani(etiket: string, enAz: number) {
  return z
    .string()
    .refine((v) => v.trim() !== "", `${etiket} gerekli.`)
    .refine(
      (v) => v.trim() === "" || Number.isFinite(Number(v)),
      `${etiket} bir sayı olmalı.`
    )
    .refine(
      (v) => v.trim() === "" || Number(v) >= enAz,
      `${etiket} en az ${enAz} olmalı.`
    );
}

const oturumSemasi = z.object({
  catalog_id: z.string(),
  exam_type: z.string().min(1, "Sınav türü seçilmeli."),
  title: z.string().trim().min(2, "Başlık en az 2 karakter olmalı."),
  description: z.string(),
  starts_at: z.string().min(1, "Tarih ve saat gerekli."),
  // Sayısal alanlar formda STRING tutulur (`<input type="number">`ın değeri
  // zaten string'tir) ve gönderimde çevrilir. `z.coerce` denendi ve
  // bırakıldı: girdi/çıktı tipleri ayrışınca `react-hook-form` 7.85'in
  // `Resolver` tipi tutmuyor. Aynı desen `LibraryEditorModal`de de var.
  duration_minutes: sayiAlani("Süre", 1),
  capacity: sayiAlani("Kontenjan", 1),
  price: sayiAlani("Ücret", 0),
});

type OturumFormDegerleri = z.infer<typeof oturumSemasi>;

/** Alan sırası — "ilk hatalı alana odaklan" bu sırayı kullanır. */
const GORSEL_SIRA = [
  "catalog_id",
  "exam_type",
  "price",
  "title",
  "description",
  "starts_at",
  "duration_minutes",
  "capacity",
] as const;

function formDegerleri(f: FormState): OturumFormDegerleri {
  return {
    catalog_id: f.catalog_id == null ? "" : String(f.catalog_id),
    exam_type: f.exam_type,
    title: f.title,
    description: f.description,
    starts_at: f.starts_at,
    duration_minutes: String(f.duration_minutes),
    capacity: String(f.capacity),
    price: String(f.price),
  };
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
  // Pencere durumu ekranda YAŞAMAZ (İP-A4 sözleşmesi): hangi oturumun
  // düzenlendiği düzenleme yüzeyinde durur.
  const editor = useDuzenlemeYuzeyi<FormState, void>();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900 ">
          Deneme Oturumları
        </h3>
        <Button size="sm" onClick={() => editor.ac(emptyForm())}>
          + Oturum
        </Button>
      </div>

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-slate-100 " />
      ) : isError ? (
        // Hata ≠ boş. Eskiden sunucu 500 dönerken ekran "Henüz oturum
        // eklenmedi" diyordu; operatör bunu "oturumlarım silinmiş" diye okur.
        <div data-testid="oturum-hata">
          <ErrorState
            description="Oturum listesi yüklenemedi. Listenin boş olduğu anlamına gelmez, bağlantını kontrol edip yeniden dene."
            onRetry={() => void refetch()}
          />
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <p
          data-testid="oturum-bos"
          className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400 "
        >
          Henüz oturum eklenmedi.
        </p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} onEdit={() => editor.ac(toForm(s))} />
          ))}
        </div>
      )}

      <SessionEditorPenceresi libraryId={libraryId} yuzey={editor} />
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
  // Onay penceresinin durumu da yüzeyde: ekran "modal açık mı" tutmaz.
  const iptal = useDuzenlemeYuzeyi<ExamSessionOut, void>();
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
        iptal.kapat();
      },
      onError: (e) => toast.error(getErrorMessage(e, "İptal başarısız.")),
    });
  };

  return (
    <div className="rounded-xl border border-slate-100 p-3 ">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-marka-soft px-2 py-0.5 text-xs font-bold text-marka-metin-hover ">
              {session.exam_type}
            </span>
            <span className="text-sm font-semibold text-slate-900 ">
              {session.title}
            </span>
            {session.catalog_name && (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ">
                📘 {session.catalog_name}
              </span>
            )}
            {session.is_nationwide && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ">
                Türkiye Geneli
              </span>
            )}
            {session.results_published ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ">
                Sonuçlar yayında
              </span>
            ) : null}
            {cancelled && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600 ">
                İptal
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 ">
            {formatDateTime(session.starts_at)} · {session.duration_minutes} dk ·{" "}
            {formatTRY(session.price)} · {session.registered_count}/{session.capacity} kayıt
            {(session.results_entered_count ?? 0) > 0 &&
              ` · ${session.results_entered_count} sonuç girildi`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={panel === "roster"}
            onClick={() => setPanel((p) => (p === "roster" ? "none" : "roster"))}
          >
            Katılımcılar
          </Button>
          {!cancelled && (
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={panel === "results"}
              onClick={() => setPanel((p) => (p === "results" ? "none" : "results"))}
            >
              Sonuçlar
            </Button>
          )}
          {!cancelled && (
            <>
              <Button size="sm" variant="secondary" onClick={onEdit}>
                Düzenle
              </Button>
              <Button size="sm" variant="danger" onClick={() => iptal.ac(session)}>
                İptal
              </Button>
            </>
          )}
        </div>
      </div>
      {panel === "roster" && <RosterPanel sessionId={session.id} />}
      {panel === "results" && <ResultsPanel session={session} isPast={isPast} />}

      <ConfirmDialog
        open={iptal.acik}
        danger
        title="Oturumu iptal et"
        description={`"${session.title}" iptal edilecek. Ödemesi alınmış ${session.registered_count} kayda iade yapılır; bu işlem geri alınamaz.`}
        confirmLabel="Oturumu iptal et"
        cancelLabel="Vazgeç"
        isPending={cancel.isPending}
        onClose={iptal.kapat}
        onConfirm={doCancel}
      />
    </div>
  );
}

function RosterPanel({ sessionId }: { sessionId: number }) {
  const { data, isLoading, isError, refetch } = useRoster(sessionId);
  const attend = useAttendRegistration();

  if (isLoading) {
    return <div className="mt-2 h-12 animate-pulse rounded-lg bg-slate-100 " />;
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
        className="mt-2 text-xs font-semibold text-slate-500 "
      >
        {sayac.giren}/{sayac.toplam} giriş yapıldı
        {sayac.toplam > sayac.giren && (
          <span className="font-normal text-slate-400">
            {" "}
            · {sayac.toplam - sayac.giren} bekleniyor
          </span>
        )}
      </p>
      <ul className="mt-2 divide-y divide-slate-100 rounded-lg bg-slate-50 ">
      {data.map((r) => (
        <li key={r.registration_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-slate-700 ">{r.client_name}</span>
          {r.status === "ATTENDED" ? (
            <span className="shrink-0 text-xs font-semibold text-emerald-600">Katıldı ✓</span>
          ) : (
            <Button
              size="sm"
              className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
              isPending={attend.isPending}
              onClick={() => doAttend(r.registration_id, r.client_name)}
            >
              Giriş ver
            </Button>
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
  const yayin = useDuzenlemeYuzeyi<ExamSessionOut, void>();

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
        yayin.kapat();
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
    <div className="mt-3 rounded-lg bg-slate-50 p-3 ">
      <p className="mb-2 text-[11px] text-slate-500 ">
        Sonuç = her öğrencinin <b>karnesi</b> (PDF/görsel). Sıralama, ders ve konu kırılımı
        karnenin içindedir. İstersen satırda toplam net + sıralamayı özet olarak girebilirsin.
      </p>

      {/* Üst aksiyonlar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onReference}>
          ⬇ Referans (CSV)
        </Button>
        <Button
          size="sm"
          variant="secondary"
          isPending={bulk.isPending}
          onClick={() => bulkInput.current?.click()}
        >
          ⬆ Toplu Karne (PDF)
        </Button>
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
            <Button
              size="sm"
              variant="secondary"
              isPending={answerKey.isPending}
              onClick={() => keyInput.current?.click()}
            >
              🔑 Cevap Anahtarı
            </Button>
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
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            isPending={publish.isPending}
            disabled={session.results_published}
            onClick={() => yayin.ac(session)}
          >
            {session.results_published ? "Yayında ✓" : "Karneleri Yayınla"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={yayin.acik}
        title="Karneleri yayınla"
        description="Karnesi yüklenmiş öğrencilere bildirim gidecek ve karnelerini görebilecekler. Yayınlama geri alınamaz."
        confirmLabel="Yayınla"
        cancelLabel="Vazgeç"
        isPending={publish.isPending}
        onClose={yayin.kapat}
        onConfirm={onPublish}
      />

      {session.catalog_id && (
        <p className="mb-2 text-[11px] text-slate-400 ">
          Cevap anahtarı katalogdan ({session.catalog_name}) gelir; admin tarafından yönetilir.
        </p>
      )}
      {!isPast && (
        <p className="mb-2 text-[11px] text-amber-600 ">
          Bu oturumun tarihi henüz gelmedi, karneleri sınav sonrası yükleyin.
        </p>
      )}

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-slate-100 " />
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
            <tbody className="divide-y divide-slate-100 ">
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
    "w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-marka-mid ";

  return (
    <tr>
      <td className="py-1.5 pr-2">
        <span className="text-slate-700 ">{row.client_name}</span>
        {row.status !== "ATTENDED" && (
          <span className="ml-1.5 text-[10px] text-amber-500" title="Henüz katılım doğrulanmadı">
            (giriş yok)
          </span>
        )}
      </td>
      <td className="px-1 py-1.5">
        <Button
          size="sm"
          variant="secondary"
          isPending={upload.isPending}
          className={row.result_document_url ? "text-emerald-600 " : ""}
          onClick={() => docInput.current?.click()}
        >
          {row.result_document_url
            ? `📄 ${row.client_name} karnesi yüklendi ✓`
            : `📄 ${row.client_name} karnesini yükle`}
        </Button>
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
        {/* Erişilebilir ad ÖĞRENCİYİ de içerir: tablo satırında tek başına
            "Net" demek ekran okuyucuda hangi öğrencinin neti olduğunu
            söylemez (nöbetçi sayacında bu iki alan `ExamSessionsManager: 2`
            borcuydu, A7d2'de kapandı). */}
        <input
          type="number"
          min={0}
          step="0.01"
          value={net}
          aria-label={`${row.client_name}, toplam net`}
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
          aria-label={`${row.client_name}, sıra`}
          placeholder="—"
          onChange={(e) => setRank(e.target.value)}
          className={numCls}
        />
      </td>
      <td className="px-1 py-1.5">
        {/* "Kaydet" DEĞİŞİKLİK YOKKEN kapalıdır ve bu bir geçerlilik kapısı
            DEĞİLDİR: kaydedilecek bir şey olmadığında basmanın anlamı yok.
            Kilitli karar ("gönder düğmesi geçerlilikle kapanmaz") formun
            gönderimi içindir. */}
        <Button
          size="sm"
          isPending={summary.isPending}
          disabled={!dirty}
          aria-label={`${row.client_name}, özeti kaydet`}
          onClick={save}
        >
          Kaydet
        </Button>
      </td>
    </tr>
  );
}

/**
 * Oturum editörü — DIŞ kabuk (İP-A7d2 · Görev 4).
 *
 * Bu bileşen A7d2'ye kadar KENDİ `fixed inset-0` katmanını kuruyordu:
 * `role="dialog"` yok, `aria-modal` yok, odak tuzağı yok, ESC yok, arka plan
 * kilidi yok, kirli formda uyarı yok. Nöbetçinin üç etiketsiz overlay'inden
 * biri buydu ve ortak `Dialog` tek genişlikte olduğu için (A7d1'e kadar)
 * geçemiyordu.
 *
 * Pencere DIŞ kabuk, form İÇ bileşendir ve bu bir zorunluluktur:
 * `useYuzeyKirliFormBekcisi` bekçiyi pencereye BAĞLAM üzerinden bildirir,
 * bağlamı `DuzenlemePenceresi` açar. Kancayı burada çağırmak bağlamın dışında
 * kalmak olurdu — A7d2'den beri o yazım geliştirmede PATLAR (SK-3).
 */
function SessionEditorPenceresi({
  libraryId,
  yuzey,
}: {
  libraryId: number;
  yuzey: DuzenlemeYuzeyiDurumu<FormState, void>;
}) {
  const kayit = yuzey.kayit;
  return (
    <DuzenlemePenceresi
      yuzey={yuzey}
      baslik={kayit?.id != null ? "Oturumu Düzenle" : "Yeni Deneme Oturumu"}
    >
      {kayit && <SessionEditorIcerik libraryId={libraryId} yuzey={yuzey} kayit={kayit} />}
    </DuzenlemePenceresi>
  );
}

function SessionEditorIcerik({
  libraryId,
  yuzey,
  kayit,
}: {
  libraryId: number;
  yuzey: DuzenlemeYuzeyiDurumu<FormState, void>;
  kayit: FormState;
}) {
  const create = useCreateSession(libraryId);
  const update = useUpdateSession();
  const { data: catalogs } = useUsableCatalogs();
  const busy = create.isPending || update.isPending;
  const isEdit = kayit.id != null;

  const form = useForm<OturumFormDegerleri>({
    resolver: zodResolver(oturumSemasi),
    defaultValues: formDegerleri(kayit),
    mode: "onChange",
    // Odaklamayı KENDİMİZ yapıyoruz: RHF'inki `onInvalid`ten SONRA çalışıp
    // bizimkini ezer (İP-A6'dan devralınan kural).
    shouldFocusError: false,
  });

  // Hedef değişince form yeniden kurulur (aynı pencere başka oturuma geçebilir).
  const hedefKimligi = kayit.id ?? "yeni";
  useEffect(() => {
    form.reset(formDegerleri(kayit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hedefKimligi]);

  // Kirli form bekçisi: ×/ESC/dış tıklama yolları pencereden geçer.
  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: create.error ?? update.error ?? null });

  const sunucuHatasiniDagit = (hata: unknown) => {
    const kalan = sunucuHatasiniUygula(hata, form, [...GORSEL_SIRA]);
    form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
  };

  const gonder = form.handleSubmit(
    (deger) => {
      form.clearErrors("root.sunucu");
      const payload: ExamSessionWrite = {
        catalog_id: deger.catalog_id ? Number(deger.catalog_id) : null,
        exam_type: deger.exam_type,
        title: deger.title.trim(),
        description: deger.description.trim() || null,
        starts_at: new Date(deger.starts_at).toISOString(),
        duration_minutes: Number(deger.duration_minutes),
        capacity: Number(deger.capacity),
        price: Number(deger.price),
      };
      const opts = {
        onSuccess: () => {
          toast.success(isEdit ? "Oturum güncellendi." : "Oturum eklendi.");
          // KOŞULSUZ kapatma: veri kaydedildi, bekçiye soracak bir şey yok.
          yuzey.kapat();
        },
        onError: sunucuHatasiniDagit,
      };
      if (isEdit) update.mutate({ id: kayit.id!, payload }, opts);
      else create.mutate(payload, opts);
    },
    (hatalar) => {
      const alan = GORSEL_SIRA.find((a) => hatalar[a]);
      if (alan) form.setFocus(alan);
    }
  );

  /** Katalog seçilince tür + (boşsa) başlık + süre ön-dolar. */
  const katalogSec = (idStr: string) => {
    const cat = catalogs?.find((c) => c.id === Number(idStr));
    form.setValue("catalog_id", idStr, { shouldDirty: true });
    if (!cat) return;
    form.setValue("exam_type", cat.exam_type, { shouldDirty: true });
    if (!form.getValues("title").trim()) {
      form.setValue("title", cat.exam_name, { shouldDirty: true });
    }
    if (cat.duration_minutes != null) {
      form.setValue("duration_minutes", String(cat.duration_minutes), {
        shouldDirty: true,
      });
    }
  };

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <div className="space-y-3">
      {genelHata && (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 "
        >
          {genelHata}
        </p>
      )}

      <Form.Field
        control={form.control}
        name="catalog_id"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Deneme katalogu</Form.Label>
            <Form.Control>
              <select
                {...field}
                className="input"
                onChange={(e) => katalogSec(e.target.value)}
              >
                <option value="">Katalogsuz (tek seferlik)</option>
                {(catalogs ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.is_nationwide ? "🇹🇷 " : ""}
                    {c.exam_name} ({c.exam_type})
                    {c.publisher_name ? `, ${c.publisher_name}` : ""}
                  </option>
                ))}
              </select>
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <div className="grid grid-cols-2 gap-2">
        <Form.Field
          control={form.control}
          name="exam_type"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Sınav türü</Form.Label>
              <Form.Control>
                <select {...field} className="input">
                  {EXAM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="price"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Ücret (TL)</Form.Label>
              <Form.Control>
                <input type="number" min={0} className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>

      <Form.Field
        control={form.control}
        name="title"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Başlık</Form.Label>
            <Form.Control>
              <input className="input" placeholder="Mart TYT Genel Denemesi" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={form.control}
        name="description"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Açıklama</Form.Label>
            <Form.Control>
              <textarea rows={2} className="input" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <div className="grid grid-cols-2 gap-2">
        <Form.Field
          control={form.control}
          name="starts_at"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Tarih &amp; saat</Form.Label>
              <Form.Control>
                <input type="datetime-local" className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="duration_minutes"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Süre (dk)</Form.Label>
              <Form.Control>
                <input type="number" min={1} className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>

      <Form.Field
        control={form.control}
        name="capacity"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Kontenjan</Form.Label>
            <Form.Control>
              <input type="number" min={1} className="input" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      {/* Gönder düğmesi geçerlilik yüzünden KAPANMAZ (kilitli karar): geçersiz
          formda basılır, gönderim yapılmaz, hatalar alanlarda belirir ve odak
          ilk hatalı alana gider. "Vazgeç" YOKTUR, `DuzenlemePenceresi`
          kapatmayı × / ESC / dış tıklamadan bekçiye bağlı olarak veriyor. */}
      <div className="flex justify-end pt-1">
        <Button isPending={busy} onClick={gonder}>
          {isEdit ? "Güncelle" : "Ekle"}
        </Button>
      </div>
    </div>
  );
}
