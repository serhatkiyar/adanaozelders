import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageSkeleton,
  ReasonDialog,
} from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import {
  useFeatureFlags,
  usePaymentBranches,
  useUpdateFeatureFlag,
} from "@/hooks/useFeatureFlags";
import { getErrorMessage } from "@/lib/errors";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";

import type { FeatureFlagOut } from "@/api/featureFlags";

/** Engelleyici kodları → operatörün anlayacağı tek satır. */
const BLOCKER_TEXT: Record<string, string> = {
  flag_disabled: "Bu koldaki ödeme bayrağı kapalı.",
  provider_marketplace_support:
    "Ödeme sağlayıcısı alt üye işyeri (pazaryeri) modelini desteklemiyor — iyzico Pazaryeri entegrasyonu tamamlanmadan bu kol açılamaz.",
  check_failed:
    "Durum okunamadı; kol güvenli tarafta kalmak için kapalı sayılıyor.",
};

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const LIST =
  "divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white ";
const ROW = "px-6 py-4";

export default function AdminSettingsPage() {
  const flagsQuery = useFeatureFlags();
  const branchesQuery = usePaymentBranches();
  const updateFlag = useUpdateFeatureFlag();
  const canManage =
    useAuthStore((state) => state.user?.admin_permissions?.includes("settings.manage")) ?? false;
  // Pencere durumu ekranda YASAMAZ (IP-A4 sozlesmesi): degistirilecek bayrak
  // yuzeyin HEDEFIDIR.
  const yuzey = useDuzenlemeYuzeyi<FeatureFlagOut, void>();
  const pending = yuzey.kayit;

  const submit = (reason: string) => {
    if (!pending) return;
    const next = !pending.enabled;
    updateFlag.mutate(
      { key: pending.key, enabled: next, note: reason },
      {
        onSuccess: () => {
          toast.success(next ? "Bayrak açıldı." : "Bayrak kapatıldı.");
          yuzey.kapat();
        },
        onError: (error) => toast.error(getErrorMessage(error, "Bayrak değiştirilemedi.")),
      },
    );
  };

  const branches = branchesQuery.data ?? [];
  const flags = flagsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12">
      {/* ── Ödeme kolları ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900 ">Ödeme kolları</h2>
          <p className="text-xs text-slate-500 ">
            Her kol bağımsızdır — birinin eksiği diğerini kapatmaz.
          </p>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-slate-600 ">
          Bir kolun açık olması için hem bayrağının açık olması hem de ödeme sağlayıcısının
          gerekli yeteneği sunması şarttır. Platformun kendi kitap satışı alt üye işyeri
          gerektirmez; eğitmen ve kütüphane adına yapılan tahsilatlar gerektirir.
        </p>

        {branchesQuery.isLoading ? (
          <PageSkeleton rows={3} />
        ) : branchesQuery.isError ? (
          <ErrorState
            description={getErrorMessage(branchesQuery.error, "Ödeme kolu durumu alınamadı.")}
            onRetry={() => branchesQuery.refetch()}
          />
        ) : branches.length === 0 ? (
          <EmptyState
            title="Ödeme kolu bulunamadı"
            description="Sunucu hiçbir kol bildirmedi; bu beklenmeyen bir durumdur."
          />
        ) : (
          <div className={LIST}>
            {branches.map((branch) => (
              <div key={branch.branch} className={ROW}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900 ">
                    {branch.label ?? branch.branch}
                  </span>
                  {branch.open ? (
                    <Badge tone="success">Açık</Badge>
                  ) : (
                    <Badge tone="warning">Kapalı</Badge>
                  )}
                </div>
                <code className="mt-0.5 block text-xs text-slate-500 ">
                  {branch.branch}
                </code>
                {!branch.open && (
                  <ul className="mt-2 space-y-1">
                    {(branch.blockers ?? []).map((code) => (
                      <li key={code} className="text-sm text-slate-600 ">
                        {BLOCKER_TEXT[code] ?? code}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Özellik bayrakları ────────────────────────────────────────── */}
      <section>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900 ">
            Özellik bayrakları
          </h2>
          {!canManage && (
            <p className="text-xs text-slate-500 ">
              Değiştirmek için <code>settings.manage</code> izni gerekir.
            </p>
          )}
        </div>
        <p className="mb-4 max-w-3xl text-sm text-slate-600 ">
          Her değişiklik gerekçesiyle birlikte denetim kayıtlarına yazılır. Değişiklik tüm
          sunucu süreçlerinde en fazla 10 saniye içinde etkili olur.
        </p>

        {flagsQuery.isLoading ? (
          <PageSkeleton rows={5} />
        ) : flagsQuery.isError ? (
          <ErrorState
            description={getErrorMessage(flagsQuery.error, "Bayraklar alınamadı.")}
            onRetry={() => flagsQuery.refetch()}
          />
        ) : flags.length === 0 ? (
          <EmptyState
            title="Bayrak yok"
            description="Katalogda tanımlı bayrak bulunmuyor."
          />
        ) : (
          <div className={LIST}>
            {flags.map((flag) => (
              <div key={flag.key} className={`flex flex-wrap items-start gap-4 sm:flex-nowrap ${ROW}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900 ">{flag.label}</span>
                    {flag.enabled ? (
                      <Badge tone="success">Açık</Badge>
                    ) : (
                      <Badge tone="neutral">Kapalı</Badge>
                    )}
                    {flag.locked_reason && <Badge tone="danger">Üretimde kilitli</Badge>}
                    {!flag.enforced && <Badge tone="warning">Bağlanmadı</Badge>}
                  </div>
                  <code className="mt-0.5 block text-xs text-slate-500 ">
                    {flag.key}
                  </code>
                  <p className="mt-2 text-sm text-slate-600 ">
                    {flag.description}
                  </p>
                  {!flag.enforced && (
                    // "Bağlanmadı" rozetinin tam cümlesi: operatör bunu "değişikliğim
                    // henüz yayılmadı" diye okumamalı.
                    <p className="mt-2 text-sm text-amber-700 ">
                      Bu bayrak henüz hiçbir kontrolde okunmuyor — açmak veya kapatmak
                      davranışı değiştirmez.
                    </p>
                  )}
                  {flag.locked_reason && (
                    <p className="mt-2 text-sm text-rose-700 ">
                      {flag.locked_reason}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-500 ">
                    Varsayılan: {flag.default ? "açık" : "kapalı"}
                    {flag.updated_at
                      ? ` · Son değişiklik ${DATE_FMT.format(new Date(flag.updated_at))}`
                      : " · hiç değiştirilmedi"}
                    {flag.note ? ` · “${flag.note}”` : ""}
                  </p>
                </div>
                {canManage && (
                  <Button
                    variant={flag.enabled ? "secondary" : "primary"}
                    onClick={() => yuzey.ac(flag)}
                    disabled={!!flag.locked_reason && !flag.enabled}
                    // Satırda 7 tane "Aç" var; ekran okuyucu hangisini açtığını
                    // görünen metinden anlayamaz.
                    aria-label={`${flag.label} bayrağını ${flag.enabled ? "kapat" : "aç"}`}
                    className="shrink-0"
                  >
                    {flag.enabled ? "Kapat" : "Aç"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <ReasonDialog
        open={yuzey.acik}
        title={pending?.enabled ? "Bayrağı kapat" : "Bayrağı aç"}
        description={
          pending
            ? `“${pending.label}” bayrağı ${pending.enabled ? "kapatılacak" : "açılacak"}. Gerekçe denetim kaydına yazılır.`
            : ""
        }
        label="Gerekçe"
        placeholder="Örn. iyzico Pazaryeri sandbox doğrulaması tamamlandı"
        required
        minLength={5}
        maxLength={255}
        confirmLabel={pending?.enabled ? "Kapat" : "Aç"}
        // Kesintiye yol açan eylem KAPATMAKTIR. Satır rozetleri de bunu söylüyor
        // (Açık = success). Tersi, "yeşile çevirmek tehlikeli" gibi okunuyordu.
        danger={pending?.enabled}
        isPending={updateFlag.isPending}
        onClose={yuzey.kapat}
        onConfirm={submit}
      />
    </div>
  );
}
