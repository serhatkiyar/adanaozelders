// Kütüphane yönetimi — katalog + onay kuyruğu + düzenleme yüzeyleri.
//
// ## İP-A7d1 · göç dalgası 1, ekran (a)'nın ev sahibi
//
// Bu ekran (a) biriminin ikinci yarısıdır: `LibraryEditorModal` göç edince
// pencere durumunun ekrandan çıkması gerekti ("ekranlarda modal `useState`i
// yaşamaz" kilitli kararı). Ekranın DÖRT pencere durumu vardı ve dördü de
// yüzeye taşındı: editör, oturum/operatör yönetimi, ödeme bilgileri ve
// onay/red/silme kararı.
//
// Yanında kapanan borçlar:
//
//   - Elle kurulan İKİ `fixed inset-0` katmanı (`ManageModal`,
//     `LibraryPayoutModal`) ortak `DuzenlemePenceresi`ye geçti: ikisinde de
//     `role="dialog"` YOKTU, `aria-modal` YOKTU, odak tuzağı ve ESC YOKTU.
//   - On üç ham `<button>` ortak `Button`a geçti.
//   - Operatör ekleme formunun dört alanı `placeholder`ı etiket yerine
//     kullanıyordu (ekran okuyucuya adsız görünüyorlardı); `Form.*`a geçti.
//
// ## İP-A8 · Görev 3 — B-1: operatör formu KORUMASIZDI (üretimde canlıydı)
//
// A7d1'de operatör ekleme formu "pencere içindeki bir bölümün satır içi
// formu" sayıldı ve kirli form bekçisine BİLEREK bağlanmadı; gerekçe "bir
// `DuzenlemePenceresi` tek korumalı içerik taşır, o hak oturum yönetimine
// ayrıldı" idi. Bağımsız denetim #3 iki şeyi ölçtü:
//
//   1. Gerekçe yanlıştı: oturum yönetiminin bekçisi kendi İÇ penceresine
//      kaydolur, bu dış pencereye değil — dış pencerenin bekçi defteri HER
//      ZAMAN boştu. Yani "ayrılmış hak" hiç kullanılmıyordu.
//   2. Sonuç canlı bir kusurdu: ad · soyad · e-posta · **şifre** doluyken ESC
//      dört alanı da sormadan siliyordu (SK-4/SK-7/SK-9 sınıfının dördüncü
//      örneği).
//
// Düzeltme sözleşmeyi eğmiyor, kullanıyor: operatör formu KENDİ penceresine
// çıktı (`ekleYuzeyi`) ve orada `Form.*` + `useYuzeyKirliFormBekcisi` ile
// korunuyor. Dış pencere artık düzenlenebilir kontrol taşımıyor.
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog, ReasonDialog } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import { LibraryPayoutForm } from "@/components/LibraryPayoutForm";
import {
  LibraryEditorModal,
  emptyEditor,
  toEditorState,
  type EditorState,
} from "@/components/LibraryEditorModal";
import {
  useAdminLibraries,
  useApproveLibrary,
  useDeleteLibrary,
  useRejectLibrary,
} from "@/hooks/useLibraries";
import {
  useCreateOperator,
  useDeleteOperator,
  useOperators,
} from "@/hooks/useLibraryExams";
import { fetchLibraryAdmin } from "@/api/libraries";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { LibrarySearchOut } from "@/types";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Onay bekliyor",
  REJECTED: "Reddedildi",
  HIDDEN: "Gizli",
};
const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700 ",
  REJECTED: "bg-rose-100 text-rose-700 ",
  HIDDEN: "bg-slate-200 text-slate-600 ",
};

type Karar = { kind: "approve" | "reject" | "delete"; library: LibrarySearchOut };

export default function AdminLibraries() {
  const { canView, canManage } = useAdminAreaAccess("libraries");
  const { data, isLoading, isError, error } = useAdminLibraries();

  // Dört pencere, dört yüzey — hiçbiri `useState` değil.
  const kararYuzeyi = useDuzenlemeYuzeyi<Karar, void>();
  const editor = useDuzenlemeYuzeyi<EditorState, void>();
  const yonetim = useDuzenlemeYuzeyi<LibrarySearchOut, void>();
  const odeme = useDuzenlemeYuzeyi<LibrarySearchOut, void>();
  const karar = kararYuzeyi.kayit;

  const del = useDeleteLibrary();
  const approve = useApproveLibrary();
  const reject = useRejectLibrary();

  const pending = data?.filter((l) => l.status === "PENDING") ?? [];

  const onApprove = (lib: LibrarySearchOut) => {
    approve.mutate(lib.id, {
      onSuccess: () => { toast.success("Başvuru onaylandı, kütüphane yayında."); kararYuzeyi.kapat(); },
      onError: (e) => toast.error(getErrorMessage(e, "Onay başarısız.")),
    });
  };

  const onReject = (lib: LibrarySearchOut, reason: string) => {
    reject.mutate(
      { id: lib.id, reason: reason || null },
      {
        onSuccess: () => { toast.success("Başvuru reddedildi."); kararYuzeyi.kapat(); },
        onError: (e) => toast.error(getErrorMessage(e, "Reddetme başarısız.")),
      }
    );
  };

  const openCreate = () => editor.ac(emptyEditor());

  const openEdit = async (lib: LibrarySearchOut) => {
    try {
      // Tam kayıt (saatler + iletişim) admin detay ucundan gelir (GİZLİ dahil).
      const full = await fetchLibraryAdmin(lib.id);
      editor.ac(toEditorState(full));
    } catch (e) {
      toast.error(getErrorMessage(e, "Kütüphane yüklenemedi."));
    }
  };

  const onDelete = (lib: LibrarySearchOut) => {
    del.mutate(lib.id, {
      onSuccess: () => { toast.success("Kütüphane silindi."); kararYuzeyi.kapat(); },
      onError: (e) => toast.error(getErrorMessage(e, "Silme başarısız.")),
    });
  };

  if (!canView) return <AccessDenied area="Kütüphaneler" />;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 ">
          {data?.length ?? 0} kütüphane · sahada gezip kaydettiğin mekânları buradan yönet.
        </p>
        {canManage && <Button onClick={openCreate}>+ Kütüphane Ekle</Button>}
      </div>
      {!canManage && <ReadOnlyNotice />}

      {/* ── Onay bekleyen self-servis başvurular ── */}
      {pending.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 ">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800 ">
            🔍 Onay bekleyen başvurular
            <span className="rounded-full bg-amber-200 px-2 text-xs font-bold text-amber-900 ">
              {pending.length}
            </span>
          </p>
          {pending.map((lib) => (
            <div
              key={lib.id}
              className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-amber-100 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 ">{lib.name}</p>
                <p className="truncate text-xs text-slate-500 ">
                  {[lib.city, lib.district].filter(Boolean).join(" · ") || lib.location_text || "Konum belirtilmemiş"}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(lib)}>
                    İncele
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={reject.isPending}
                    onClick={() => kararYuzeyi.ac({ kind: "reject", library: lib })}
                  >
                    Reddet
                  </Button>
                  <Button
                    size="sm"
                    variant="success"
                    disabled={approve.isPending}
                    onClick={() => kararYuzeyi.ac({ kind: "approve", library: lib })}
                  >
                    Onayla
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100 " />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ">
          {getErrorMessage(error, "Kütüphaneler yüklenemedi.")}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-500 ">
          Henüz kütüphane eklenmedi.
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((lib) => (
            <div
              key={lib.id}
              className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-xl ">
                  {lib.cover_url ? (
                    <img src={lib.cover_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    "📚"
                  )}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-900 ">
                    <span className="truncate">{lib.name}</span>
                    {lib.status && lib.status !== "ACTIVE" && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[lib.status] ?? "bg-slate-100 text-slate-500"}`}>
                        {STATUS_LABEL[lib.status] ?? lib.status}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500 ">
                    {lib.location_text || "Konum yok"} · ★{" "}
                    {lib.rating_average != null ? lib.rating_average.toFixed(1) : "-"}
                  </p>
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => yonetim.ac(lib)}>
                    Oturumlar &amp; Operatörler
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => odeme.ac(lib)}>
                    Ödeme
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(lib)}>
                    Düzenle
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => kararYuzeyi.ac({ kind: "delete", library: lib })}
                  >
                    Sil
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <LibraryEditorModal yuzey={editor} />

      <DuzenlemePenceresi
        yuzey={yonetim}
        baslik={yonetim.kayit?.name ?? "Kütüphane"}
        genislik="genis"
      >
        {yonetim.kayit && (
          <div className="space-y-6">
            <OperatorsManager libraryId={yonetim.kayit.id} />
            <div className="border-t border-slate-100 pt-5 ">
              <ExamSessionsManager libraryId={yonetim.kayit.id} />
            </div>
          </div>
        )}
      </DuzenlemePenceresi>

      <DuzenlemePenceresi
        yuzey={odeme}
        baslik={`Ödeme Bilgileri · ${odeme.kayit?.name ?? ""}`}
      >
        {odeme.kayit && <LibraryPayoutForm libraryId={odeme.kayit.id} />}
      </DuzenlemePenceresi>

      <ConfirmDialog
        open={karar?.kind === "approve"}
        title="Kütüphane başvurusunu onayla"
        description={karar ? `${karar.library.name} onaylanıp public kataloğa alınacak.` : ""}
        confirmLabel="Onayla ve yayınla"
        isPending={approve.isPending}
        onClose={kararYuzeyi.kapat}
        onConfirm={() => karar && onApprove(karar.library)}
      />
      <ConfirmDialog
        open={karar?.kind === "delete"}
        title="Kütüphaneyi sil"
        description={karar ? `${karar.library.name} katalogdan kaldırılacak.` : ""}
        confirmLabel="Kütüphaneyi sil"
        danger
        isPending={del.isPending}
        onClose={kararYuzeyi.kapat}
        onConfirm={() => karar && onDelete(karar.library)}
      />
      <ReasonDialog
        open={karar?.kind === "reject"}
        title="Kütüphane başvurusunu reddet"
        description={karar ? `${karar.library.name} için gerekçe operatöre iletilecek.` : ""}
        label="Red gerekçesi"
        required
        danger
        confirmLabel="Başvuruyu reddet"
        isPending={reject.isPending}
        onClose={kararYuzeyi.kapat}
        onConfirm={(reason) => karar && onReject(karar.library, reason)}
      />
    </section>
  );
}

/* ── Operatör hesapları ── */

export function OperatorsManager({ libraryId }: { libraryId: number }) {
  const { data: operators } = useOperators(libraryId);
  const del = useDeleteOperator(libraryId);
  // Ekleme formu artık katlanır bir bölüm DEĞİL, kendi düzenleme yüzeyi
  // (İP-A8 · B-1): şifre dahil dört alan ancak korumalı bir pencerede
  // yaşayabilir.
  const ekleYuzeyi = useDuzenlemeYuzeyi<void, void>();
  const silmeYuzeyi = useDuzenlemeYuzeyi<{ id: number; name: string }, void>();
  const silinecek = silmeYuzeyi.kayit;

  const onDelete = (id: number) => {
    del.mutate(id, {
      onSuccess: () => { toast.success("Operatör silindi."); silmeYuzeyi.kapat(); },
      onError: (e) => toast.error(getErrorMessage(e, "Silme başarısız.")),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900 ">Operatörler</h3>
        <Button size="sm" variant="secondary" onClick={() => ekleYuzeyi.yeniAc()}>
          + Operatör
        </Button>
      </div>

      {operators && operators.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 ">
          {operators.map((op) => (
            <li key={op.id} className="flex items-center justify-between px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800 ">{op.full_name}</p>
                <p className="truncate text-xs text-slate-400">{op.email}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => silmeYuzeyi.ac({ id: op.id, name: op.full_name })}
              >
                Sil
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">Henüz operatör yok. Kütüphaneci için hesap oluşturun.</p>
      )}

      <DuzenlemePenceresi
        yuzey={ekleYuzeyi}
        baslik="Operatör hesabı oluştur"
        aciklama="Kütüphaneci bu hesapla giriş yapıp oturumlarını yönetir ve QR okutur."
      >
        {ekleYuzeyi.acik && (
          <OperatorEkleIcerik libraryId={libraryId} kapat={ekleYuzeyi.kapat} />
        )}
      </DuzenlemePenceresi>

      <ConfirmDialog
        open={silinecek !== null}
        title="Operatör hesabını sil"
        description={silinecek ? `${silinecek.name} operatör hesabı kalıcı olarak kapatılacak.` : ""}
        confirmLabel="Hesabı sil"
        danger
        isPending={del.isPending}
        onClose={silmeYuzeyi.kapat}
        onConfirm={() => silinecek && onDelete(silinecek.id)}
      />
    </div>
  );
}

/**
 * Operatör hesabı formu — pencerenin İÇİNDE yaşar ve bekçisini KENDİ kaydeder.
 *
 * Kanca burada çağrılır, `OperatorsManager`da değil: bildirim
 * `BekciBildirimCtx` üzerinden yapılır ve o bağlamı `DuzenlemePenceresi` açar
 * (İP-A7d1 · SK-3'ün keskin kenarı). Pencereyi RENDER EDEN bileşende çağrılsa
 * bekçi pencereye hiç bildirilmez ve ×/ESC yine sormadan kapatırdı.
 */
const operatorSemasi = z.object({
  first_name: z.string().refine((v) => v.trim().length > 0, "Ad gerekli."),
  last_name: z.string().refine((v) => v.trim().length > 0, "Soyad gerekli."),
  email: z
    .string()
    .refine((v) => v.trim().length > 0, "E-posta gerekli.")
    .refine((v) => v.includes("@"), "E-posta adresi geçerli görünmüyor."),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});

type OperatorFormDegerleri = z.infer<typeof operatorSemasi>;

/** Odak sırası = ekrandaki görsel sıra (gönderimde ilk hatalı alana gidilir). */
const OPERATOR_SIRA = ["first_name", "last_name", "email", "password"] as const;

function OperatorEkleIcerik({ libraryId, kapat }: { libraryId: number; kapat: () => void }) {
  const create = useCreateOperator(libraryId);
  const form = useForm<OperatorFormDegerleri>({
    resolver: zodResolver(operatorSemasi),
    defaultValues: { first_name: "", last_name: "", email: "", password: "" },
    mode: "onChange",
    // Odak `onInvalid` argümanından verilir: `formState.errors` gönderim
    // anında henüz boştur ve odak `<body>`ye düşerdi (İP-A7d2 · C-1).
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: create.error });

  const gonder = form.handleSubmit(
    (deger) => {
      form.clearErrors("root.sunucu");
      create.mutate(
        {
          first_name: deger.first_name.trim(),
          last_name: deger.last_name.trim(),
          email: deger.email.trim(),
          password: deger.password,
        },
        {
          onSuccess: () => {
            toast.success("Operatör hesabı oluşturuldu.");
            // `reset` ÖNCE: bekçi "kirli" görürken kapatmak onay penceresi
            // açardı ve kullanıcı kaydettiği formda "çıkmak istiyor musun"
            // sorusuyla karşılaşırdı.
            form.reset({ first_name: "", last_name: "", email: "", password: "" });
            kapat();
          },
          onError: (hata) => {
            const kalan = sunucuHatasiniUygula(hata, form, [...OPERATOR_SIRA], undefined, (h) =>
              getErrorMessage(h, "Oluşturulamadı.")
            );
            form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
          },
        }
      );
    },
    (hatalar) => {
      const alan = OPERATOR_SIRA.find((a) => hatalar[a]);
      if (alan) form.setFocus(alan);
    }
  );

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <div className="space-y-4">
      {genelHata && (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 "
        >
          {genelHata}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Form.Field
          control={form.control}
          name="first_name"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Ad</Form.Label>
              <Form.Control>
                <input className="input" autoComplete="given-name" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="last_name"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Soyad</Form.Label>
              <Form.Control>
                <input className="input" autoComplete="family-name" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>
      <Form.Field
        control={form.control}
        name="email"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>E-posta</Form.Label>
            <Form.Control>
              <input className="input" type="email" autoComplete="email" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="password"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Şifre (en az 8 karakter)</Form.Label>
            <Form.Control>
              <input className="input" type="password" autoComplete="new-password" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <div className="flex justify-end">
        <Button isPending={create.isPending} onClick={gonder}>
          Operatör Hesabı Oluştur
        </Button>
      </div>
    </div>
  );
}
