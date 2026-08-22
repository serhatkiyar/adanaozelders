// F30 "Kuyruk" — bugün paketlenecek siparişler, söz gününe göre sıralı.
//
// ## Eylemi kuyruk satırı SÖYLER, ekran çıkarmaz
//
// Satırdaki `next_action` sunucunun kararıdır ve ekran onu birebir uygular:
// yeni paket aç · devam et · yeniden paketle. İstemcinin "paketi yoksa yeni
// açtır" gibi bir çıkarım yapması, sunucuyla ikinci bir doğruluk kaynağı
// üretirdi; en pahalı sonucu da somuttur: aynı siparişe ikinci kutu açılır ve
// aynı ürünler ikinci kez raftan toplanır.
//
// **Bilinmeyen/eksik `next_action` fail-closed'dır**: hiçbir yazma eylemi
// sunulmaz. Backend yarın yeni bir eylem eklerse ekran onu uydurmaz.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { ItemLines } from "@/components/admin/delivery/ItemLines";
import { PromiseChip } from "@/components/admin/delivery/bits";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageSkeleton,
} from "@/components/admin/ui";
import { useOpenPackage, usePackingQueue, useRepackPackage } from "@/hooks/usePacking";
import { getErrorMessage } from "@/lib/errors";
import { PACKAGE_STATUS_LABEL } from "@/lib/packing";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { PackingQueueRow } from "@/types/packing";

import { usePackingAccess } from "./PackingLayout";

/** Sunucu tavanı 200; 50 satır bir vardiyanın bakabileceği en büyük öbek. */
const LIMIT = 50;

function sayfaNo(raw: string | null): number {
  const n = Number(raw ?? "1");
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Satırın önerdiği TEK eylem. Bilinmeyen değerde hiçbir yazma sunulmaz. */
function SatirAksiyonu({
  row,
  canPack,
  canManage,
}: {
  row: PackingQueueRow;
  canPack: boolean;
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const openPackage = useOpenPackage();
  const repack = useRepackPackage();
  const [calisan, setCalisan] = useState(false);

  const paketId = row.package?.id ?? null;

  if (row.next_action === "OPEN_NEW_PACKAGE" && canPack) {
    return (
      <Button
        size="sm"
        isPending={calisan && openPackage.isPending}
        onClick={() => {
          setCalisan(true);
          openPackage.mutate(row.order_id, {
            // Uç idempotenttir: canlı paket varsa yenisi açılmaz, o döner —
            // yani çift dokunuş ikinci kutu üretmez. Yine de istasyona
            // SUNUCUNUN döndürdüğü paketle gidilir, uydurulan bir id ile değil.
            onSuccess: (paket) => navigate(ROUTES.adminPackingPackage(paket.id)),
            onError: (e) => {
              setCalisan(false);
              toast.error(getErrorMessage(e, "Paket açılamadı."));
            },
          });
        }}
      >
        Paketlemeye başla
      </Button>
    );
  }

  if (row.next_action === "CONTINUE_PACKING" && canPack && paketId != null) {
    return (
      <Link
        to={ROUTES.adminPackingPackage(paketId)}
        className="inline-flex min-h-9 items-center justify-center rounded-lg bg-panel-accent px-3 text-xs font-semibold text-panel-accent-fg shadow-sm transition hover:bg-panel-accent/90"
      >
        Paketlemeye devam et
      </Link>
    );
  }

  if (row.next_action === "REPACK_RETURNED" && paketId != null) {
    if (!canManage) {
      return (
        <p className="max-w-52 text-xs text-slate-500 dark:text-slate-400">
          Depoya dönen bu paketi yeniden dağıtıma vermek için paket yönetimi izni
          gerekir.
        </p>
      );
    }
    return (
      <Button
        size="sm"
        variant="secondary"
        isPending={calisan && repack.isPending}
        onClick={() => {
          setCalisan(true);
          repack.mutate(paketId, {
            onSuccess: () => {
              setCalisan(false);
              toast.success("Paket yeniden dağıtıma hazır.");
            },
            onError: (e) => {
              setCalisan(false);
              toast.error(getErrorMessage(e, "Paket yeniden dağıtıma verilemedi."));
            },
          });
        }}
      >
        Yeniden paketle
      </Button>
    );
  }

  // Fail-closed: sunucu "bilmiyorum" dediyse ekran eylem uydurmaz. Paket varsa
  // yalnız OKUMA bağlantısı kalır — kutunun durumuna bakmak kimseyi raf başına
  // göndermez.
  if (paketId != null) {
    return (
      <Link
        to={ROUTES.adminPackingPackage(paketId)}
        className="text-xs font-semibold text-panel-accent hover:underline"
      >
        Paketi gör →
      </Link>
    );
  }
  return null;
}

export default function PackingQueuePage() {
  const { canView, canPack, canManage } = usePackingAccess();
  const [params, setParams] = useSearchParams();
  const sayfa = sayfaNo(params.get("sayfa"));
  const query = usePackingQueue({ limit: LIMIT, offset: (sayfa - 1) * LIMIT }, canView);

  const satirlar = query.data?.items ?? [];
  const toplam = query.data?.total ?? 0;
  const sonSayfa = Math.max(1, Math.ceil(toplam / LIMIT));

  const sayfaGit = (yeni: number) =>
    setParams(yeni <= 1 ? {} : { sayfa: String(yeni) }, { replace: true });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Paketleme kuyruğu
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Ödenmiş fiziksel siparişler, söz gününe göre sıralı. Sıradaki işi
            buradan başlatın; kalemler istasyonda tek tek okutulur.
          </p>
        </div>
        {toplam > 0 && <Badge tone="info">{toplam} sipariş</Badge>}
      </div>

      {query.isError ? (
        <div className="p-6">
          <ErrorState
            description={getErrorMessage(query.error, "Kuyruk yüklenemedi.")}
            onRetry={query.refetch}
          />
        </div>
      ) : query.isLoading ? (
        <div className="p-6">
          <PageSkeleton rows={3} />
        </div>
      ) : satirlar.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="Paketlenecek sipariş yok"
            description="Yeni fiziksel siparişler ödendikçe burada belirir."
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
          {satirlar.map((row) => (
            <li key={row.order_id} className="flex flex-wrap items-start gap-3 py-4">
              <div className="min-w-0 flex-1 basis-64">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                  {row.recipient ?? "Alıcı bilgisi girilmemiş"}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    #{row.order_id}
                  </span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="truncate">{row.address ?? "Adres yok"}</span>
                  <PromiseChip date={row.promised_delivery_date} />
                </p>
                {/* Operatör NE toplayacağını görmeden rafa gitmez: "N parça"
                    özeti kalem listesinin yerine geçmez (F26 dersi). */}
                <ItemLines items={row.items} className="mt-1.5" />
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {row.item_count} parça
                </span>
                {row.package && (
                  <Badge tone="neutral">
                    {row.package.code} ·{" "}
                    {PACKAGE_STATUS_LABEL[row.package.status] ?? row.package.status}
                  </Badge>
                )}
                <SatirAksiyonu row={row} canPack={canPack} canManage={canManage} />
              </div>
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
    </section>
  );
}
