import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import {
  BosSayfa,
  SAYFA_ISTEK_LIMITI,
  SayfaGecisi,
  sayfaDilimi,
  sayfaOfseti,
} from "@/components/admin/SayfaGecisi";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageSkeleton,
  ReasonDialog,
} from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { useAdminPromotions, useCancelPromotion } from "@/hooks/useAdmin";
import { formatTRY, parseMoney } from "@/lib/money";
import type { AdminPromotion } from "@/api/admin";

const TR = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function tarih(iso: string | null): string {
  return iso ? TR.format(new Date(iso)) : "-";
}

/**
 * Satırın DURUMU — para durumu ile yürürlük ayrı şeylerdir ve ayrı gösterilir.
 * "Ödendi" bir kaydın şu anda öne çıktığı anlamına gelmez: süresi dolmuş ya da
 * henüz başlamamış olabilir.
 */
function durumRozeti(p: AdminPromotion) {
  if (p.cancelled_at) return <Badge tone="danger">İptal edildi</Badge>;
  if (p.payment_status !== "PAID") {
    return <Badge tone="neutral">{p.payment_status}</Badge>;
  }
  const now = Date.now();
  const bas = p.starts_at ? new Date(p.starts_at).getTime() : 0;
  const bit = p.ends_at ? new Date(p.ends_at).getTime() : 0;
  if (bas > now) return <Badge tone="neutral">Sırada</Badge>;
  if (bit > now) return <Badge tone="success">Yürürlükte</Badge>;
  return <Badge tone="neutral">Süresi doldu</Badge>;
}

function iptalEdilebilir(p: AdminPromotion): boolean {
  if (p.cancelled_at) return false;
  return ["PAID", "PENDING", "FAILED"].includes(p.payment_status);
}

const FILTRELER: { value: string | undefined; label: string }[] = [
  { value: undefined, label: "Tümü" },
  { value: "active", label: "Yürürlükte" },
  { value: "PAID", label: "Ödenmiş" },
  { value: "PENDING", label: "Ödeme bekliyor" },
];

/** Adresten gelen süzgeç için BEYAZ LİSTE. */
const GECERLI_DURUMLAR = new Set(
  FILTRELER.map((f) => f.value).filter((v): v is string => v !== undefined)
);

export default function AdminPromotionsPage() {
  const { canView, canManage } = useAdminAreaAccess("promotions");
  // Süzgeç ve sayfa ADRESTE yaşar (yenileme/geri tuşu/paylaşılan bağlantı);
  // adresten gelen değer beyaz listeden geçer, uydurma değer API'ye gitmez.
  const url = useUrlDurumu({ durum: "", sayfa: 1 }, { sayfaAnahtari: "sayfa" });
  const hamDurum = String(url.degerler.durum);
  const filtre = GECERLI_DURUMLAR.has(hamDurum) ? hamDurum : undefined;
  const sayfa = Math.max(1, Math.floor(Number(url.degerler.sayfa)) || 1);
  const setSayfa = (s: number) => url.ayarla({ sayfa: s });
  // Pencere durumu ekranda DEĞİL: iptal edilecek kayıt yüzeyin hedefidir
  // (İP-A4 sözleşmesi — kapatma yollarının hepsi tek noktadan bekçiye bağlı).
  const yuzey = useDuzenlemeYuzeyi<AdminPromotion, void>();
  const iptalHedefi = yuzey.kayit;

  const { data, isLoading, isError, refetch } = useAdminPromotions(
    filtre,
    true,
    SAYFA_ISTEK_LIMITI,
    sayfaOfseti(sayfa)
  );
  const { satirlar, dahaFazlaVar } = sayfaDilimi(data);
  const iptal = useCancelPromotion();

  if (!canView) return <AccessDenied area="Öne çıkarma satışları" />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          İlan öne çıkarma satışları
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Öğretmenlerin satın aldığı reklam paketleri. İptal, kaydı{" "}
          <span className="font-medium">anında</span> yayından düşürür ve iade
          sürecini başlatır.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTRELER.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => {
              // Filtre değişince 1. sayfaya dön (`useUrlDurumu` sayfa kuralı):
              // 3. sayfadayken filtre değiştirmek boş liste gösterir, "kayıt
              // yok" sanılırdı.
              url.ayarla({ durum: f.value ?? "" });
            }}
            aria-pressed={filtre === f.value}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              filtre === f.value
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <PageSkeleton />
      ) : isError ? (
        <ErrorState
          description="Öne çıkarma satışları alınamadı."
          onRetry={() => void refetch()}
        />
      ) : satirlar.length === 0 && sayfa > 1 ? (
        <BosSayfa onOnceki={() => setSayfa(sayfa - 1)} />
      ) : satirlar.length === 0 ? (
        <EmptyState
          title="Kayıt yok"
          description="Bu filtreye uyan bir öne çıkarma satın alması bulunmuyor."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-3 pr-4">Öğretmen</th>
                <th className="py-3 pr-4">Paket</th>
                <th className="py-3 pr-4">Yürürlük</th>
                <th className="py-3 pr-4">Tutar</th>
                <th className="py-3 pr-4">Durum</th>
                <th className="py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {satirlar.map((p) => (
                <tr key={p.id}>
                  <td className="py-3 pr-4">
                    <span className="font-medium text-slate-900">
                      {p.tutor_name ?? `#${p.tutor_id}`}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    {p.package_days} gün
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    {p.starts_at
                      ? `${tarih(p.starts_at)} – ${tarih(p.ends_at)}`
                      : "-"}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    {formatTRY(parseMoney(p.price) ?? 0)}
                  </td>
                  <td className="py-3 pr-4">{durumRozeti(p)}</td>
                  <td className="py-3 text-right">
                    {canManage && iptalEdilebilir(p) && (
                      <Button
                        variant="ghost"
                        onClick={() => yuzey.ac(p)}
                      >
                        İptal et
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SayfaGecisi sayfa={sayfa} dahaFazlaVar={dahaFazlaVar} onSayfaDegis={setSayfa} />

      <ReasonDialog
        open={iptalHedefi !== null}
        title={
          iptalHedefi
            ? `${iptalHedefi.tutor_name ?? `#${iptalHedefi.tutor_id}`}: öne çıkarmayı iptal et`
            : ""
        }
        description="Kayıt anında yayından düşer ve ödenmiş tutar iade sürecine girer. Gerekçe denetim kaydına yazılır."
        label="İptal gerekçesi"
        placeholder="Örn. yanlış satın alma, öğretmen talebi…"
        required
        minLength={3}
        maxLength={500}
        confirmLabel="İptal et ve iade başlat"
        danger
        isPending={iptal.isPending}
        onClose={() => yuzey.kapat()}
        onConfirm={(reason) => {
          if (!iptalHedefi) return;
          iptal.mutate(
            { id: iptalHedefi.id, reason },
            { onSuccess: () => yuzey.kapat() }
          );
        }}
      />
    </div>
  );
}
