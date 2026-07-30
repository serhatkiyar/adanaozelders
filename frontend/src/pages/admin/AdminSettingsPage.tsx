import { Badge, Button, ErrorState, PageSkeleton, ReasonDialog } from "@/components/admin/ui";
import {
  useFeatureFlags,
  usePaymentBranches,
  useUpdateFeatureFlag,
} from "@/hooks/useFeatureFlags";
import { getErrorMessage } from "@/lib/errors";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";
import { useState } from "react";

import type { FeatureFlagOut } from "@/api/featureFlags";

/** Engelleyici kodları → operatörün anlayacağı tek satır. */
const BLOCKER_TEXT: Record<string, string> = {
  flag_disabled: "Bu koldaki ödeme bayrağı kapalı.",
  provider_marketplace_support:
    "Ödeme sağlayıcısı alt üye işyeri (pazaryeri) modelini henüz uygulamıyor — iyzico Pazaryeri entegrasyonu tamamlanmadan bu kol açılamaz.",
  production_environment: "Üretim ortamında bu yol kalıcı olarak kapalıdır.",
  check_failed: "Durum okunamadı; kapı güvenli tarafta (kapalı) davranıyor.",
};

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function AdminSettingsPage() {
  const flagsQuery = useFeatureFlags();
  const branchesQuery = usePaymentBranches();
  const updateFlag = useUpdateFeatureFlag();
  const canManage =
    useAuthStore((state) => state.user?.admin_permissions?.includes("settings.manage")) ?? false;
  const [pending, setPending] = useState<FeatureFlagOut | null>(null);

  const submit = (reason: string) => {
    if (!pending) return;
    const next = !pending.enabled;
    updateFlag.mutate(
      { key: pending.key, enabled: next, note: reason },
      {
        onSuccess: () => {
          toast.success(next ? "Bayrak açıldı." : "Bayrak kapatıldı.");
          setPending(null);
        },
        onError: (error) => toast.error(getErrorMessage(error, "Bayrak değiştirilemedi.")),
      },
    );
  };

  return (
    <div className="space-y-12">
      {/* ── Ödeme kolları ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Ödeme kolları</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Her kol bağımsızdır — birinin eksiği diğerini kapatmaz.
          </p>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Bir kolun açık olması için hem bayrağının açık olması hem de ödeme sağlayıcısının
          gerekli yeteneği sunması şarttır. Platformun kendi kitap satışı alt üye işyeri
          gerektirmez; eğitmen ve kütüphane adına yapılan tahsilatlar gerektirir.
        </p>

        {branchesQuery.isLoading ? (
          <PageSkeleton rows={3} />
        ) : branchesQuery.isError ? (
          <ErrorState
            description="Ödeme kolu durumu alınamadı."
            onRetry={() => branchesQuery.refetch()}
          />
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {(branchesQuery.data ?? []).map((branch) => (
              <div key={branch.branch} className="flex flex-wrap gap-3 p-4 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-900 dark:text-white">
                      {branch.label ?? branch.branch}
                    </span>
                    {branch.open ? (
                      <Badge tone="success">Açık</Badge>
                    ) : (
                      <Badge tone="warning">Kapalı</Badge>
                    )}
                  </div>
                  <code className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                    {branch.branch}
                  </code>
                  {!branch.open && (
                    <ul className="mt-2 space-y-1">
                      {(branch.blockers ?? []).map((code) => (
                        <li key={code} className="text-sm text-slate-600 dark:text-slate-300">
                          {BLOCKER_TEXT[code] ?? code}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Özellik bayrakları ────────────────────────────────────────── */}
      <section>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Özellik bayrakları
          </h2>
          {!canManage && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Değiştirmek için <code>settings.manage</code> izni gerekir.
            </p>
          )}
        </div>
        <p className="mb-4 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Her değişiklik gerekçesiyle birlikte denetim kayıtlarına yazılır. Değişiklik tüm
          sunucu süreçlerinde en fazla 10 saniye içinde etkili olur.
        </p>

        {flagsQuery.isLoading ? (
          <PageSkeleton rows={5} />
        ) : flagsQuery.isError ? (
          <ErrorState description="Bayraklar alınamadı." onRetry={() => flagsQuery.refetch()} />
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {(flagsQuery.data ?? []).map((flag) => (
              <div key={flag.key} className="flex flex-wrap items-start gap-4 p-4 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900 dark:text-white">{flag.label}</span>
                    {flag.enabled ? (
                      <Badge tone="success">Açık</Badge>
                    ) : (
                      <Badge tone="neutral">Kapalı</Badge>
                    )}
                    {!flag.enforced && (
                      // Açık görünüp hiçbir şeyi kapatmayan bir kontrol yanıltıcıdır.
                      <Badge tone="warning">Henüz uygulanmıyor</Badge>
                    )}
                  </div>
                  <code className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                    {flag.key}
                  </code>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {flag.description}
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Varsayılan: {flag.default ? "açık" : "kapalı"}
                    {flag.updated_at
                      ? ` · Son değişiklik ${DATE_FMT.format(new Date(flag.updated_at))}`
                      : " · hiç değiştirilmedi"}
                    {flag.note ? ` · “${flag.note}”` : ""}
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant={flag.enabled ? "secondary" : "primary"}
                    onClick={() => setPending(flag)}
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
        open={pending !== null}
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
        danger={!pending?.enabled}
        isPending={updateFlag.isPending}
        onClose={() => setPending(null)}
        onConfirm={submit}
      />
    </div>
  );
}
