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
import { useState } from "react";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog, ReasonDialog } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
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
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  REJECTED: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  HIDDEN: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
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
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {data?.length ?? 0} kütüphane · sahada gezip kaydettiğin mekânları buradan yönet.
        </p>
        {canManage && <Button onClick={openCreate}>+ Kütüphane Ekle</Button>}
      </div>
      {!canManage && <ReadOnlyNotice />}

      {/* ── Onay bekleyen self-servis başvurular ── */}
      {pending.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-200">
            🔍 Onay bekleyen başvurular
            <span className="rounded-full bg-amber-200 px-2 text-xs font-bold text-amber-900 dark:bg-amber-500/30 dark:text-amber-100">
              {pending.length}
            </span>
          </p>
          {pending.map((lib) => (
            <div
              key={lib.id}
              className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-amber-100 dark:bg-slate-800 dark:ring-amber-500/20 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{lib.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
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
                  <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-900 dark:text-white">
                    <span className="truncate">{lib.name}</span>
                    {lib.status && lib.status !== "ACTIVE" && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[lib.status] ?? "bg-slate-100 text-slate-500"}`}>
                        {STATUS_LABEL[lib.status] ?? lib.status}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {lib.location_text || "Konum yok"} · ★{" "}
                    {lib.rating_average != null ? lib.rating_average.toFixed(1) : "—"}
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
            <div className="border-t border-slate-100 pt-5 dark:border-slate-700">
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

interface OperatorFormDegerleri {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
}

const OPERATOR_BOS: OperatorFormDegerleri = {
  first_name: "",
  last_name: "",
  email: "",
  password: "",
};

function OperatorsManager({ libraryId }: { libraryId: number }) {
  const { data: operators } = useOperators(libraryId);
  const create = useCreateOperator(libraryId);
  const del = useDeleteOperator(libraryId);
  // Satır içi ekleme formunun AÇIK/KAPALI olması bir pencere durumu değildir;
  // katlanır bir bölüm başlığıdır ve ekranda kalır.
  const [acik, setAcik] = useState(false);
  const silmeYuzeyi = useDuzenlemeYuzeyi<{ id: number; name: string }, void>();
  const silinecek = silmeYuzeyi.kayit;

  // Not: burada kirli form bekçisi KURULMAZ. Bu form pencerenin kendi formu
  // değil, pencere içindeki bir bölümün satır içi formudur; `DuzenlemePenceresi`
  // tek bir korumalı içerik taşıyabilir (İP-A6c · BULGU-5) ve o hak aynı
  // pencerede yaşayan oturum yönetimine ayrılmıştır.
  const [degerler, setDegerler] = useState<OperatorFormDegerleri>(OPERATOR_BOS);
  const [hatalar, setHatalar] = useState<Partial<Record<keyof OperatorFormDegerleri, string>>>({});

  const alan = (ad: keyof OperatorFormDegerleri) => ({
    value: degerler[ad],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setDegerler((d) => ({ ...d, [ad]: e.target.value }));
      setHatalar((h) => ({ ...h, [ad]: undefined }));
    },
  });

  const submit = () => {
    const yeni: Partial<Record<keyof OperatorFormDegerleri, string>> = {};
    if (!degerler.first_name.trim()) yeni.first_name = "Ad gerekli.";
    if (!degerler.last_name.trim()) yeni.last_name = "Soyad gerekli.";
    if (!degerler.email.trim()) yeni.email = "E-posta gerekli.";
    if (degerler.password.length < 8) yeni.password = "Şifre en az 8 karakter olmalı.";
    setHatalar(yeni);
    if (Object.keys(yeni).length) {
      // Gönderim YAPILMAZ; odak ilk hatalı alana taşınır.
      const ilk = (["first_name", "last_name", "email", "password"] as const).find(
        (a) => yeni[a]
      );
      if (ilk) document.getElementById(`operator-${ilk}`)?.focus();
      return;
    }
    create.mutate(degerler, {
      onSuccess: () => {
        toast.success("Operatör hesabı oluşturuldu.");
        setDegerler(OPERATOR_BOS);
        setAcik(false);
      },
      onError: (e) => toast.error(getErrorMessage(e, "Oluşturulamadı.")),
    });
  };

  const onDelete = (id: number) => {
    del.mutate(id, {
      onSuccess: () => { toast.success("Operatör silindi."); silmeYuzeyi.kapat(); },
      onError: (e) => toast.error(getErrorMessage(e, "Silme başarısız.")),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Operatörler</h3>
        <Button size="sm" variant="secondary" aria-expanded={acik} onClick={() => setAcik((v) => !v)}>
          {acik ? "Kapat" : "+ Operatör"}
        </Button>
      </div>

      {acik && (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/40">
          {/* `Form.*` kullanılmıyor: bu form `react-hook-form` bağlamı
              taşımıyor (pencerenin formu değil). Etiket/`id` bağı ve hata
              slotu elle ama AYNI sözleşmeyle kuruluyor — alanların hepsinin
              erişilebilir adı var ve hata alanın altında. */}
          <OperatorAlani ad="first_name" etiket="Ad" hata={hatalar.first_name} {...alan("first_name")} />
          <OperatorAlani ad="last_name" etiket="Soyad" hata={hatalar.last_name} {...alan("last_name")} />
          <OperatorAlani ad="email" etiket="E-posta" genis hata={hatalar.email} {...alan("email")} />
          <OperatorAlani
            ad="password"
            etiket="Şifre (en az 8 karakter)"
            tip="password"
            genis
            hata={hatalar.password}
            {...alan("password")}
          />
          <div className="col-span-2">
            <Button className="w-full" isPending={create.isPending} onClick={submit}>
              Operatör Hesabı Oluştur
            </Button>
          </div>
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

function OperatorAlani({
  ad,
  etiket,
  tip = "text",
  genis = false,
  hata,
  value,
  onChange,
}: {
  ad: keyof OperatorFormDegerleri;
  etiket: string;
  tip?: string;
  genis?: boolean;
  hata?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const id = `operator-${ad}`;
  const hataId = `${id}-hata`;
  return (
    <div className={genis ? "col-span-2" : undefined}>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
        {etiket}
      </label>
      <input
        id={id}
        type={tip}
        className="input w-full"
        value={value}
        onChange={onChange}
        aria-invalid={hata ? true : undefined}
        aria-describedby={hata ? hataId : undefined}
      />
      {/* Slot HER ZAMAN var: hata doğunca yerleşim itilmez (Form.Item kuralı). */}
      <p id={hataId} role={hata ? "alert" : undefined} className="mt-1 min-h-[1rem] text-xs text-rose-700 dark:text-rose-400">
        {hata}
      </p>
    </div>
  );
}
