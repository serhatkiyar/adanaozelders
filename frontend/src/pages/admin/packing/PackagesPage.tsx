// F30 "Paketler" — açılmış bütün paketlerin süzülebilir listesi.
//
// ## Süzgeç URL'de yaşar
//
// `?durum=RETURN_PENDING` adres çubuğundan gelir ve **sunucuya `status` olarak
// gider**. İki ad bilinçli: URL kullanıcıya ait (Türkçe, paylaşılabilir,
// yer imlenebilir), query ise sunucu sözleşmesi. Dönüşüm TEK yerdedir; ikisini
// birbirine eşitlemek uğruna ya URL İngilizceleşir ya uç yeniden adlandırılırdı.
//
// Bilinmeyen `durum` değeri **yok sayılır** (süzgeçsiz liste): uydurma bir
// değeri sunucuya geçirmek 422 üretir ve kullanıcı boş ekranın sebebini göremez.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageSkeleton,
} from "@/components/admin/ui";
import { usePackages, useRepackPackage, useUnpackPackage } from "@/hooks/usePacking";
import { getErrorMessage } from "@/lib/errors";
import { PACKAGE_STATUS_LABEL } from "@/lib/packing";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { Package, PackageStatus } from "@/types/packing";

import { usePackingAccess } from "./PackingLayout";

const LIMIT = 50;

/**
 * Süzgeç düğmelerinin KISA adları.
 *
 * `PACKAGE_STATUS_LABEL` satırın durumunu anlatan tam cümledir; düğme ise dar
 * bir şerittedir ve tek kelimeyle okunmalıdır. Kısaltma listesi ayrı durduğu
 * için satır etiketiyle karışmaz.
 */
const SUZGECLER: { value: PackageStatus | null; label: string }[] = [
  { value: null, label: "Tümü" },
  { value: "OPEN", label: "Paketleniyor" },
  { value: "PACKED", label: "Hazır" },
  { value: "HANDED_OVER", label: "Kuryede" },
  { value: "RETURN_PENDING", label: "Geri dönüş" },
  { value: "RETURNED", label: "Depoda" },
  { value: "DELIVERED", label: "Teslim" },
  { value: "VOID", label: "Vazgeçilen" },
];

const DURUM_TONU: Record<PackageStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  OPEN: "info",
  PACKED: "success",
  HANDED_OVER: "info",
  RETURN_PENDING: "warning",
  RETURNED: "neutral",
  DELIVERED: "success",
  VOID: "danger",
};

/**
 * Satır rozetinin metni — durum ADI değil, "kutuda sırada ne var".
 *
 * İki durumda ham durum adı işi anlatmıyor: `RETURN_PENDING` kutunun kuryeden
 * GERİ BEKLENDİĞİNİ, `VOID` ise (henüz `unpacked_at` yoksa) kutunun fiziksel
 * olarak BOZULACAĞINI söyler — ikisi de bir insanın yapması gereken işi
 * gösterir. Diğer durumlarda tek kaynak `PACKAGE_STATUS_LABEL` kalır.
 */
function satirEtiketi(paket: Package): string {
  if (paket.status === "RETURN_PENDING") return "Geri bekleniyor";
  if (paket.status === "VOID") return paket.unpacked_at ? "Bozuldu" : "Bozulacak";
  return PACKAGE_STATUS_LABEL[paket.status] ?? paket.status;
}

function sayfaNo(raw: string | null): number {
  const n = Number(raw ?? "1");
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function siparisNo(raw: string | null): number | undefined {
  const n = Number(raw ?? "");
  return raw && Number.isInteger(n) && n > 0 ? n : undefined;
}

export default function PackagesPage() {
  const { canView, canManage } = usePackingAccess();
  const [params, setParams] = useSearchParams();

  const hamDurum = params.get("durum");
  // Kapalı küme kontrolü: etiket tablosunun anahtarları geçerli durumlardır.
  const durum =
    hamDurum && hamDurum in PACKAGE_STATUS_LABEL ? (hamDurum as PackageStatus) : undefined;
  const siparis = siparisNo(params.get("siparis"));
  const sayfa = sayfaNo(params.get("sayfa"));

  const query = usePackages(
    { status: durum, orderId: siparis, limit: LIMIT, offset: (sayfa - 1) * LIMIT },
    canView,
  );
  const repack = useRepackPackage();
  const unpack = useUnpackPackage();
  const [yenidenPaketle, setYenidenPaketle] = useState<Package | null>(null);
  const [bozulduDamgasi, setBozulduDamgasi] = useState<Package | null>(null);

  const paketler = query.data?.items ?? [];
  const toplam = query.data?.total ?? 0;
  const sonSayfa = Math.max(1, Math.ceil(toplam / LIMIT));

  /** Süzgeç değişince sayfa 1'e döner; yoksa 3. sayfada boş liste görünür. */
  const suzgecUygula = (yeni: PackageStatus | null) => {
    const sonraki = new URLSearchParams(params);
    sonraki.delete("sayfa");
    if (yeni) sonraki.set("durum", yeni);
    else sonraki.delete("durum");
    setParams(sonraki, { replace: true });
  };

  const sayfaGit = (yeni: number) => {
    const sonraki = new URLSearchParams(params);
    if (yeni <= 1) sonraki.delete("sayfa");
    else sonraki.set("sayfa", String(yeni));
    setParams(sonraki, { replace: true });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Paketler</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Açılmış bütün kutular. Durum süzgeci depodaki işi ayırır: kuryeden
            dönmesi beklenen kutular ve bozulup rafa geri konacaklar.
          </p>
        </div>
        {toplam > 0 && <Badge tone="info">{toplam} paket</Badge>}
      </div>

      <div
        role="group"
        aria-label="Durum süzgeci"
        className="flex flex-wrap gap-1.5 border-b border-slate-100 px-6 py-3 dark:border-slate-800"
      >
        {SUZGECLER.map((s) => {
          const secili = (durum ?? null) === s.value;
          return (
            <button
              key={s.label}
              type="button"
              aria-pressed={secili}
              onClick={() => suzgecUygula(s.value)}
              className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition ${
                secili
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
              }`}
            >
              {s.label}
            </button>
          );
        })}
        {siparis != null && (
          <button
            type="button"
            onClick={() => {
              const sonraki = new URLSearchParams(params);
              sonraki.delete("siparis");
              setParams(sonraki, { replace: true });
            }}
            className="min-h-9 rounded-lg bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
          >
            Sipariş #{siparis} süzgecini kaldır ×
          </button>
        )}
      </div>

      {query.isError ? (
        <div className="p-6">
          <ErrorState
            description={getErrorMessage(query.error, "Paket listesi yüklenemedi.")}
            onRetry={query.refetch}
          />
        </div>
      ) : query.isLoading ? (
        <div className="p-6">
          <PageSkeleton rows={3} />
        </div>
      ) : paketler.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="Bu süzgeçte paket yok"
            description="Süzgeci genişletin ya da kuyruktan yeni bir paket açın."
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
          {paketler.map((paket) => (
            <li key={paket.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <Link
                  to={ROUTES.adminPackingPackage(paket.id)}
                  className="text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {paket.code}
                </Link>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Sipariş #{paket.order_id}
                  {(paket.items?.length ?? 0) > 0 && ` · ${paket.items.length} kalem`}
                </p>
              </div>
              <Badge tone={DURUM_TONU[paket.status] ?? "neutral"}>
                {satirEtiketi(paket)}
              </Badge>
              {canManage && paket.status === "RETURNED" && (
                <Button size="sm" variant="secondary" onClick={() => setYenidenPaketle(paket)}>
                  Yeniden paketle
                </Button>
              )}
              {canManage && paket.status === "VOID" && !paket.unpacked_at && (
                <Button size="sm" variant="secondary" onClick={() => setBozulduDamgasi(paket)}>
                  Bozuldu olarak işaretle
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {toplam > LIMIT && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-3 dark:border-slate-800">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Sayfa {sayfa} / {sonSayfa}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={sayfa <= 1}
              onClick={() => sayfaGit(sayfa - 1)}
            >
              Önceki
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={sayfa >= sonSayfa}
              onClick={() => sayfaGit(sayfa + 1)}
            >
              Sonraki
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={yenidenPaketle != null}
        title="Yeniden dağıtıma ver"
        description={
          yenidenPaketle
            ? `${yenidenPaketle.code} yeniden dağıtıma girer. Kutunun üstündeki etiket GEÇERLİ kalır; yeni etiket basmayın.`
            : ""
        }
        confirmLabel="Yeniden paketle"
        isPending={repack.isPending}
        onClose={() => setYenidenPaketle(null)}
        onConfirm={() => {
          if (!yenidenPaketle) return;
          repack.mutate(yenidenPaketle.id, {
            onSuccess: () => {
              setYenidenPaketle(null);
              toast.success("Paket yeniden dağıtıma hazır.");
            },
            onError: (e) => {
              setYenidenPaketle(null);
              toast.error(getErrorMessage(e, "Paket yeniden dağıtıma verilemedi."));
            },
          });
        }}
      />

      <ConfirmDialog
        open={bozulduDamgasi != null}
        title="Kutu bozuldu mu?"
        description={
          bozulduDamgasi
            ? `${bozulduDamgasi.code} kutusunun fiziksel olarak açıldığını ve içeriğin rafa geri konduğunu işaretleyeceksiniz. Bu damga stok hareketi YAZMAZ; sayım envanterden yapılır.`
            : ""
        }
        confirmLabel="Bozuldu"
        isPending={unpack.isPending}
        onClose={() => setBozulduDamgasi(null)}
        onConfirm={() => {
          if (!bozulduDamgasi) return;
          unpack.mutate(bozulduDamgasi.id, {
            onSuccess: () => {
              setBozulduDamgasi(null);
              toast.success("Kutu bozuldu olarak işaretlendi.");
            },
            onError: (e) => {
              setBozulduDamgasi(null);
              toast.error(getErrorMessage(e, "İşaretlenemedi."));
            },
          });
        }}
      />
    </section>
  );
}
