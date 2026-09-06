import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog, ErrorState } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
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

/** Boş bırakılabilen, negatif olmayan tam sayı alanı. */
function sayiAlani(etiket: string) {
  return z
    .string()
    .refine(
      (v) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
      `${etiket} negatif olamaz.`
    );
}

/**
 * Katalog formu şeması (İP-A7d2 · Görev 4).
 *
 * Eskiden tek kural vardı ve `submit()` içinde elle yazılmıştı; hata
 * `toast.error("Deneme adı gerekli.")` ile köşeye düşüyordu.
 */
const katalogSemasi = z.object({
  exam_name: z.string().trim().min(2, "Deneme adı en az 2 karakter olmalı."),
  exam_type: z.string().min(1, "Sınav türü seçilmeli."),
  publisher_name: z.string(),
  description: z.string(),
  question_count: sayiAlani("Soru sayısı"),
  duration_minutes: sayiAlani("Süre"),
  is_public: z.boolean(),
  is_nationwide: z.boolean(),
});

type KatalogFormDegerleri = z.infer<typeof katalogSemasi>;

/** Alan sırası — "ilk hatalı alana odaklan" bunu kullanır. */
const GORSEL_SIRA = [
  "exam_name",
  "exam_type",
  "publisher_name",
  "question_count",
  "duration_minutes",
  "description",
] as const;

function formDegerleri(f: FormState): KatalogFormDegerleri {
  return {
    exam_name: f.exam_name,
    exam_type: f.exam_type,
    publisher_name: f.publisher_name,
    description: f.description,
    question_count: f.question_count,
    duration_minutes: f.duration_minutes,
    is_public: f.is_public,
    is_nationwide: f.is_nationwide,
  };
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
  const { canView, canManage } = useAdminAreaAccess("catalogs");
  const { data: catalogs, isLoading, isError, refetch } = useCatalogs();
  // Pencere durumu ekranda yaşamaz (İP-A4 sözleşmesi).
  const editor = useDuzenlemeYuzeyi<FormState, void>();

  if (!canView) return <AccessDenied area="Deneme katalogları" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 ">
            Deneme Katalogları
          </h2>
          <p className="text-sm text-slate-500 ">
            Ortak deneme içerikleri (blueprint). Kütüphaneler oturum açarken bu kataloglardan
            seçer; cevap anahtarı tüm oturumlarda paylaşılır.
          </p>
        </div>
        {canManage && (
          <Button className="shrink-0" onClick={() => editor.ac(emptyForm())}>
            + Katalog
          </Button>
        )}
      </div>
      {!canManage && <ReadOnlyNotice />}

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-slate-100 " />
      ) : isError ? (
        // Hata ≠ boş: sunucu patlarken "Henüz katalog eklenmedi" demek,
        // yöneticiye kataloglarının silindiğini söylemektir.
        <ErrorState
          description="Katalog listesi yüklenemedi. Listenin boş olduğu anlamına gelmez."
          onRetry={() => void refetch()}
        />
      ) : !catalogs || catalogs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-400 ">
          Henüz katalog eklenmedi. İlk ortak denemeyi oluştur.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {catalogs.map((c) => (
            <CatalogCard
              key={c.id}
              catalog={c}
              canManage={canManage}
              onEdit={() => editor.ac(toForm(c))}
            />
          ))}
        </div>
      )}

      <CatalogEditorPenceresi yuzey={editor} />
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

function CatalogCard({ catalog, canManage, onEdit }: { catalog: CatalogOut; canManage: boolean; onEdit: () => void }) {
  const silme = useDuzenlemeYuzeyi<CatalogOut, void>();
  const del = useDeleteCatalog();
  const uploadKey = useUploadCatalogAnswerKey();
  const keyInput = useRef<HTMLInputElement>(null);

  const onDelete = () => {
    del.mutate(catalog.id, {
      onSuccess: () => { toast.success("Katalog silindi."); silme.kapat(); },
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
    <>
    <div className="flex flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-sm ">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-marka-soft px-2 py-0.5 text-xs font-bold text-marka-metin-hover ">
          {catalog.exam_type}
        </span>
        {catalog.is_nationwide && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ">
            Türkiye Geneli
          </span>
        )}
        {!catalog.is_public && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ">
            Gizli
          </span>
        )}
      </div>
      <h3 className="mt-2 text-sm font-bold text-slate-900 ">
        {catalog.exam_name}
      </h3>
      <p className="mt-0.5 text-xs text-slate-500 ">
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
            className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 "
          >
            🔑 Cevap anahtarı ✓
          </a>
        ) : null}
        {canManage && (
          <>
            <Button
              size="sm"
              variant="secondary"
              isPending={uploadKey.isPending}
              onClick={() => keyInput.current?.click()}
            >
              {catalog.answer_key_url ? "Değiştir" : "🔑 Cevap Anahtarı"}
            </Button>
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
              <Button size="sm" variant="secondary" onClick={onEdit}>
                Düzenle
              </Button>
              <Button size="sm" variant="danger" onClick={() => silme.ac(catalog)}>
                Sil
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
    <ConfirmDialog
      open={silme.acik}
      title="Deneme kataloğunu sil"
      description={`“${catalog.exam_name}” kataloğu silinecek.`}
      confirmLabel="Kataloğu sil"
      danger
      isPending={del.isPending}
      onClose={silme.kapat}
      onConfirm={onDelete}
    />
    </>
  );
}

/**
 * Katalog editörü — DIŞ kabuk (İP-A7d2 · Görev 4).
 *
 * Nöbetçinin etiketsiz overlay'lerinden ikincisi buydu: kendi
 * `fixed inset-0` katmanı, `role`/`aria-modal` yok, ESC yok, odak tuzağı yok.
 * Bekçi kancası İÇERİK bileşeninde çağrılır — pencereyi render eden bu
 * bileşende çağırmak A7d2'den beri geliştirmede patlar (SK-3).
 */
function CatalogEditorPenceresi({
  yuzey,
}: {
  yuzey: DuzenlemeYuzeyiDurumu<FormState, void>;
}) {
  const kayit = yuzey.kayit;
  return (
    <DuzenlemePenceresi
      yuzey={yuzey}
      baslik={kayit?.id != null ? "Katalogu Düzenle" : "Yeni Deneme Katalogu"}
      aciklama={
        kayit?.id != null
          ? undefined
          : "Cevap anahtarını oluşturduktan sonra katalog kartından yükleyebilirsin."
      }
    >
      {kayit && <CatalogEditorIcerik yuzey={yuzey} kayit={kayit} />}
    </DuzenlemePenceresi>
  );
}

function CatalogEditorIcerik({
  yuzey,
  kayit,
}: {
  yuzey: DuzenlemeYuzeyiDurumu<FormState, void>;
  kayit: FormState;
}) {
  const create = useCreateCatalog();
  const update = useUpdateCatalog();
  const busy = create.isPending || update.isPending;
  const isEdit = kayit.id != null;

  const form = useForm<KatalogFormDegerleri>({
    resolver: zodResolver(katalogSemasi),
    defaultValues: formDegerleri(kayit),
    mode: "onChange",
    shouldFocusError: false,
  });

  const hedefKimligi = kayit.id ?? "yeni";
  useEffect(() => {
    form.reset(formDegerleri(kayit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hedefKimligi]);

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: create.error ?? update.error ?? null });

  const sunucuHatasiniDagit = (hata: unknown) => {
    const kalan = sunucuHatasiniUygula(hata, form, [...GORSEL_SIRA]);
    form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
  };

  const gonder = form.handleSubmit(
    (deger) => {
      form.clearErrors("root.sunucu");
      const payload: CatalogWrite = {
        exam_name: deger.exam_name.trim(),
        exam_type: deger.exam_type,
        publisher_name: deger.publisher_name.trim() || null,
        description: deger.description.trim() || null,
        // Boş sayısal alan 0 DEĞİL null gider: "0 soruluk deneme" diye bir
        // şey yok, boş bırakmak "bilinmiyor" demektir.
        question_count: deger.question_count.trim() ? Number(deger.question_count) : null,
        duration_minutes: deger.duration_minutes.trim()
          ? Number(deger.duration_minutes)
          : null,
        is_public: deger.is_public,
        is_nationwide: deger.is_nationwide,
      };
      const opts = {
        onSuccess: () => {
          toast.success(isEdit ? "Katalog güncellendi." : "Katalog oluşturuldu.");
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
        name="exam_name"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Deneme adı</Form.Label>
            <Form.Control>
              <input className="input" placeholder="Türkiye Geneli YKS-1" {...field} />
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
                <select className="input" {...field}>
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
          name="publisher_name"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Yayıncı</Form.Label>
              <Form.Control>
                <input className="input" placeholder="Özdebir" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Form.Field
          control={form.control}
          name="question_count"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Soru sayısı</Form.Label>
              <Form.Control>
                <input type="number" min={0} className="input" {...field} />
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
              <Form.Label optional>Süre (dk)</Form.Label>
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

      <div className="flex flex-wrap gap-4 pt-1">
        <Form.Field
          control={form.control}
          name="is_public"
          render={({ field }) => (
            <Form.Item className="flex items-center gap-2">
              <Form.Control>
                <input
                  type="checkbox"
                  className="accent-marka"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </Form.Control>
              <Form.Label>Public (kütüphaneler kullanabilir)</Form.Label>
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="is_nationwide"
          render={({ field }) => (
            <Form.Item className="flex items-center gap-2">
              <Form.Control>
                <input
                  type="checkbox"
                  className="accent-marka"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </Form.Control>
              <Form.Label>Türkiye Geneli</Form.Label>
            </Form.Item>
          )}
        />
      </div>

      {/* Gönder düğmesi geçerlilikle KAPANMAZ (kilitli karar). "Vazgeç"
          yoktur: kapatma yolları pencerede ve bekçiden geçiyor. */}
      <div className="flex justify-end pt-1">
        <Button isPending={busy} onClick={gonder}>
          {isEdit ? "Güncelle" : "Oluştur"}
        </Button>
      </div>
    </div>
  );
}
