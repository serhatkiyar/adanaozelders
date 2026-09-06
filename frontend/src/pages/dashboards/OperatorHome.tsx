import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { canPromiseEscrow } from "@/lib/paymentAvailability";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/admin/ui";
import { useYuzeyKirliFormBekcisi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import { DashboardShell } from "@/components/DashboardShell";
import { OPERATOR_NAV } from "@/lib/nav";
import { useOperatorMe } from "@/hooks/useLibraryExams";
import {
  useLibraryAdminDetail,
  useLibraryEarnings,
  useResubmitLibrary,
} from "@/hooks/useLibraries";
import { useChangePassword } from "@/hooks/useProfile";
import { useManageSessions } from "@/hooks/useLibraryExams";
import { useManageStudyReservations } from "@/hooks/useStudy";
import { ErrorState } from "@/components/admin/ui/PageState";
import { bugunOzeti, istanbulGunAnahtari } from "@/lib/operatorAgenda";
import { formatIstanbulTime } from "@/lib/datetime";
import { formatTRY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { LibraryDetailOut, OperatorOut } from "@/types";

export default function OperatorHome() {
  const { data: op, isLoading } = useOperatorMe();
  const { data: lib } = useLibraryAdminDetail(op?.library_id);
  const isActive = lib?.status === "ACTIVE";

  return (
    <DashboardShell title="Kütüphane Paneli" navItems={OPERATOR_NAV}>
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Kütüphane kimliği + "sayfanı görüntüle" */}
        <OperatorHero op={op} lib={lib} isLoading={isLoading} />

        {/* Onay durumu (self-servis başvuru) */}
        {op && <LibraryStatusBanner libraryId={op.library_id} />}

        {/* Bugünün işi — panelin ilk sorusu: "şu an kim geliyor?" */}
        {op && isActive && <BugunBlogu libraryId={op.library_id} />}

        {/* Kazanç özeti + işlem dökümü linki (yalnız onaylı) */}
        {op && isActive && (
          <div className="space-y-2">
            <EarningsCard libraryId={op.library_id} />
            <div className="text-right">
              <Link
                to={ROUTES.balance}
                className="text-xs font-semibold text-marka hover:underline "
              >
                Bakiye & işlem dökümü →
              </Link>
            </div>
          </div>
        )}

        {/* Operasyona kısa yol (yalnız onaylı) */}
        {op && isActive && <OperationsTeaser libraryId={op.library_id} />}

        {/* Hesap: şifre değiştir */}
        <PasswordPanel />
      </div>
    </DashboardShell>
  );
}

/* Kütüphane kimliği: kapak + logo + ad + durum + "sayfanı görüntüle" (öğrencilerin
   gördüğü public profile). Operatör kendi kütüphanesini güzelce görür. */
const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Yayında", cls: "bg-emerald-100 text-emerald-700 " },
  PENDING: { label: "İncelemede", cls: "bg-amber-100 text-amber-700 " },
  REJECTED: { label: "Reddedildi", cls: "bg-rose-100 text-rose-700 " },
  HIDDEN: { label: "Gizli", cls: "bg-slate-200 text-slate-600 " },
};

function OperatorHero({
  op,
  lib,
  isLoading,
}: {
  op?: OperatorOut;
  lib?: LibraryDetailOut;
  isLoading: boolean;
}) {
  const name = op?.library_name ?? lib?.name ?? "Kütüphane Paneli";
  const initial = (name.trim()[0] ?? "K").toUpperCase();
  const status = lib?.status;
  const pill = status ? STATUS_PILL[status] : undefined;
  const place = [lib?.district, lib?.city].filter(Boolean).join(", ");

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 ">
      {/* Kapak */}
      <div className="relative h-36 w-full bg-gradient-to-br from-marka to-marka-hover">
        {lib?.cover_url && (
          <img src={lib.cover_url} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        {pill && (
          <span
            className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-xs font-semibold ${pill.cls}`}
          >
            {pill.label}
          </span>
        )}
      </div>

      <div className="px-5 pb-5">
        <div className="-mt-10 flex items-end gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-marka text-2xl font-bold text-white shadow-md ring-4 ring-white ">
            {lib?.logo_url ? (
              <img src={lib.logo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="truncate text-xl font-bold text-slate-900 ">
              {isLoading ? "Yükleniyor…" : name}
            </h1>
            <p className="mt-0.5 truncate text-xs text-slate-500 ">
              {place || "Kütüphane paneli"}
              {lib && lib.rating_count > 0 && (
                <>
                  {" · "}
                  <span className="text-amber-500">★</span>{" "}
                  {lib.rating_average?.toFixed(1)} ({lib.rating_count})
                </>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            to={ROUTES.operatorLibrary}
            className="inline-flex items-center gap-1.5 rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-marka-hover active:scale-95"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
            </svg>
            Kütüphane profilim
          </Link>
          {lib && status === "ACTIVE" && (
            <Link
              to={ROUTES.library(lib.slug)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 "
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              Öğrenci görünümü
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* Self-servis başvuru onay durumu: PENDING (inceleniyor) / REJECTED (gerekçe) / ACTIVE (yayında). */
function LibraryStatusBanner({ libraryId }: { libraryId: number }) {
  const { data: lib } = useLibraryAdminDetail(libraryId);
  const resubmit = useResubmitLibrary();
  if (!lib) return null;

  const doResubmit = () => {
    resubmit.mutate(libraryId, {
      onSuccess: () => toast.success("Başvurun tekrar gönderildi; inceleniyor."),
      onError: (e) => toast.error(getErrorMessage(e, "Gönderilemedi.")),
    });
  };

  if (lib.status === "PENDING") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 ">
        <p className="flex items-center gap-2 text-sm font-bold text-amber-800 ">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Başvurun inceleniyor
        </p>
        <p className="mt-1 text-sm text-amber-700/90 ">
          Admin onayından sonra kütüphanen yayına girer ve öğrencilere görünür olur.
          Bu sırada <Link to={ROUTES.operatorLibrary} className="font-semibold underline">profilini tamamlayabilirsin</Link>{" "}
          (saatler, görseller, olanaklar, konum) — onaylanır onaylanmaz hazır olsun.
        </p>
      </div>
    );
  }

  if (lib.status === "REJECTED") {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 ">
        <p className="flex items-center gap-2 text-sm font-bold text-rose-800 ">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Başvurun reddedildi
        </p>
        {lib.rejection_reason && (
          <p className="mt-1 text-sm text-rose-700/90 ">
            <span className="font-semibold">Gerekçe:</span> {lib.rejection_reason}
          </p>
        )}
        <p className="mt-1 text-sm text-rose-700/90 ">
          <Link to={ROUTES.operatorLibrary} className="font-semibold underline">Profilini düzelt</Link>{" "}
          ve başvurunu tekrar gönder.
        </p>
        <Button
          variant="danger"
          className="mt-3 rounded-xl"
          isPending={resubmit.isPending}
          onClick={doResubmit}
        >
          Tekrar başvur
        </Button>
      </div>
    );
  }

  return null; // ACTIVE → banner gerekmez
}

/* ── Bugünün işi ──────────────────────────────────────────────────────────
   Ölçüm raporunun (§6.1/1) en yüksek fayda/maliyet maddesi: panel ekranı
   bugüne dair HİÇBİR ŞEY göstermiyordu; operatör "sırada kim var" sorusunu
   ancak Oturumlar sekmesine geçip tüm geleceği gözle tarayarak cevaplıyordu.
   Yeni uç gerekmez — iki mevcut yönetim ucu istemcide bugüne göre süzülür.

   Gün sınırı Türkiye saatiyle hesaplanır (`lib/operatorAgenda`); tarayıcının
   tz'i UTC olsa bile 23:30'daki rezervasyon bugüne düşer. */
function BugunBlogu({ libraryId }: { libraryId: number }) {
  const rez = useManageStudyReservations(libraryId);
  const oturum = useManageSessions(libraryId);

  // Tek "şimdi": iki liste bir saniyeyle bölünmüş farklı günlere düşmesin.
  const simdi = new Date();

  if (rez.isLoading || oturum.isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 " />;
  }
  if (rez.isError || oturum.isError) {
    return (
      <div data-testid="bugun-hata">
        <ErrorState
          description="Bugünün listesi yüklenemedi. Bağlantını kontrol edip yeniden dene."
          onRetry={() => {
            void rez.refetch();
            void oturum.refetch();
          }}
        />
      </div>
    );
  }

  const rezOzet = bugunOzeti(
    (rez.data ?? []).map((r) => ({
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      ad: r.client_name ?? "Öğrenci",
    })),
    simdi
  );
  const oturumOzet = bugunOzeti(
    (oturum.data ?? [])
      .filter((s) => s.status !== "CANCELLED")
      .map((s) => ({
        startsAt: s.starts_at,
        endsAt: new Date(
          new Date(s.starts_at).getTime() + s.duration_minutes * 60_000
        ).toISOString(),
        ad: s.title,
        kayitli: s.registered_count,
      })),
    simdi
  );

  const oturumKisi = (oturum.data ?? [])
    .filter((s) => s.status !== "CANCELLED")
    .filter((s) =>
      istanbulGunAnahtari(s.starts_at) === istanbulGunAnahtari(simdi)
    )
    .reduce((t, s) => t + s.registered_count, 0);

  const bosGun = rezOzet.toplam === 0 && oturumOzet.toplam === 0;
  // Sıradaki: iki kaynaktan en erken olan.
  const adaylar = [rezOzet.siradaki, oturumOzet.siradaki].filter(
    (x): x is NonNullable<typeof x> => x !== null
  );
  const siradaki = adaylar.sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  )[0];

  return (
    <div
      data-testid="operator-bugun"
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 "
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold text-slate-900 ">Bugün</h2>
        <Link
          to={ROUTES.operatorSessions}
          className="text-xs font-semibold text-marka hover:underline "
        >
          Oturumlar →
        </Link>
      </div>

      {bosGun ? (
        <p className="mt-2 text-sm text-slate-500 ">
          Bugün için kayıt yok. Yeni rezervasyon veya oturum kaydı geldiğinde burada görünür.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-slate-600 ">
            <span>
              <b data-testid="bugun-rezervasyon-sayisi" className="text-slate-900 ">
                {rezOzet.toplam}
              </b>{" "}
              çalışma rezervasyonu
            </span>
            <span>
              <b data-testid="bugun-oturum-sayisi" className="text-slate-900 ">
                {oturumOzet.toplam}
              </b>{" "}
              deneme oturumu
              {oturumKisi > 0 && ` · ${oturumKisi} kayıtlı`}
            </span>
            <span className="text-slate-500 ">
              {rezOzet.giren}/{rezOzet.toplam} giriş yapıldı
            </span>
          </div>

          {siradaki ? (
            <p
              data-testid="bugun-siradaki"
              className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-700 "
            >
              <span className="text-slate-400 ">Sıradaki:</span>{" "}
              <b>{formatIstanbulTime(siradaki.startsAt)}</b> · {siradaki.ad}
            </p>
          ) : (
            <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-500 ">
              Bugün için bekleyen randevu kalmadı.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* Operasyona kısa yol kartı — günlük iş ayrı sekmede (Oturumlar). */
function OperationsTeaser({ libraryId: _libraryId }: { libraryId: number }) {
  return (
    <Link
      to={ROUTES.operatorSessions}
      className="flex items-center justify-between gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:ring-marka-focus "
    >
      <div className="min-w-0">
        <h2 className="text-base font-bold text-slate-900 ">Oturumlar</h2>
        <p className="mt-0.5 text-sm text-slate-500 ">
          Deneme oturumlarını yönet, çalışma rezervasyonlarını gör ve QR ile katılım doğrula.
        </p>
      </div>
      <svg className="h-5 w-5 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </Link>
  );
}

/**
 * Hesap güvenliği — şifre değiştirme (İP-A7d3 · göç dalgası 3).
 *
 * Üç alanın üçü de `placeholder`ı etiket yerine kullanıyordu ve doğrulama
 * `toast.error` ile veriliyordu: kullanıcı "Yeni şifreler eşleşmiyor." yazısını
 * ekranın altında görüyor, hangi kutuya bakacağını bilmiyordu. Bir şifre
 * formunda bu, alanın içeriği gizli olduğu için daha da körleştirici.
 */
const sifreSemasi = z
  .object({
    current: z.string().refine((v) => v.length > 0, "Mevcut şifreni yaz."),
    next: z.string().refine((v) => v.length >= 8, "Yeni şifre en az 8 karakter olmalı."),
    confirm: z.string(),
  })
  .superRefine((deger, ctx) => {
    if (deger.confirm !== deger.next) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirm"],
        message: "Yeni şifreler eşleşmiyor.",
      });
    }
  });

type SifreDegerleri = z.infer<typeof sifreSemasi>;

const SIFRE_SIRA = ["current", "next", "confirm"] as const;

function PasswordPanel() {
  const [open, setOpen] = useState(false);
  const change = useChangePassword();

  const form = useForm<SifreDegerleri>({
    resolver: zodResolver(sifreSemasi),
    defaultValues: { current: "", next: "", confirm: "" },
    mode: "onChange",
    shouldFocusError: false,
  });

  // Satır içi form (pencere yok) — beyan zorunlu (İP-A7d2 · SK-3).
  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: change.error, pencereSiz: true });

  const submit = form.handleSubmit(
    (deger) => {
      form.clearErrors("root.sunucu");
      change.mutate(
        { current_password: deger.current, new_password: deger.next },
        {
          onSuccess: () => {
            toast.success("Şifren güncellendi.");
            form.reset({ current: "", next: "", confirm: "" });
            setOpen(false);
          },
          onError: (e) => {
            const kalan = sunucuHatasiniUygula(
              e,
              form,
              ["current", "next"],
              // Sunucu alan adlarını kendi şemasıyla söyler; formdaki karşılığı
              // farklıdır ve eşleme olmadan mesaj genel kanala düşerdi.
              { current_password: "current", new_password: "next" },
              (h) => getErrorMessage(h, "Şifre değiştirilemedi.")
            );
            form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
          },
        }
      );
    },
    (hatalar) => {
      const alan = SIFRE_SIRA.find((a) => hatalar[a]);
      if (alan) form.setFocus(alan);
    }
  );

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900 ">Hesap Güvenliği</h2>
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Kapat" : "Şifre değiştir"}
        </Button>
      </div>
      {open && (
        <div className="mt-3 grid max-w-md grid-cols-1 gap-2">
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
            name="current"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Mevcut şifre</Form.Label>
                <Form.Control>
                  <input type="password" className="input" autoComplete="current-password" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="next"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Yeni şifre (en az 8 karakter)</Form.Label>
                <Form.Control>
                  <input type="password" className="input" autoComplete="new-password" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Yeni şifre (tekrar)</Form.Label>
                <Form.Control>
                  <input
                    type="password"
                    className="input"
                    autoComplete="new-password"
                    {...field}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submit();
                    }}
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <div className="flex justify-end">
            {/* Düğme geçerlilikle KAPANMAZ (kilitli karar). */}
            <Button isPending={change.isPending} onClick={submit}>
              Şifreyi Güncelle
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EarningsCard({ libraryId }: { libraryId: number }) {
  const { data: paymentAvailability } = usePaymentAvailability();
  const escrowWording = canPromiseEscrow(paymentAvailability, "library_marketplace");
  const { data, isLoading } = useLibraryEarnings(libraryId);
  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 " />;
  }
  if (!data) return null;

  const total = (Number(data.released_earning) + Number(data.held_earning)).toFixed(2);

  // Tek sakin kart; sütunlar saç-teli çizgiyle ayrılır, renk yalnız rakamın üstünde.
  return (
    <div className="grid grid-cols-1 divide-y divide-slate-100 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0 ">
      <div className="pb-4 sm:pb-0 sm:pr-5">
        <p className="text-xs font-medium text-slate-500 ">Serbest kazanç</p>
        <p className="mt-1 text-2xl font-bold text-emerald-600 ">
          {formatTRY(data.released_earning)}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {data.released_count} katılım · komisyon {formatTRY(data.commission_total)}
        </p>
      </div>
      <div className="py-4 sm:px-5 sm:py-0">
        <p className="text-xs font-medium text-slate-500 ">
          {escrowWording ? "Emanette bekleyen" : "Bekleyen"}
        </p>
        <p className="mt-1 text-2xl font-bold text-amber-600 ">
          {formatTRY(data.held_earning)}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {data.held_count} ödenmiş, henüz doğrulanmadı
        </p>
      </div>
      <div className="pt-4 sm:pl-5 sm:pt-0">
        <p className="text-xs font-medium text-slate-500 ">Toplam</p>
        <p className="mt-1 text-2xl font-bold text-slate-900 ">{formatTRY(total)}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">Katılım doğrulandıkça serbest kalır</p>
      </div>
    </div>
  );
}
