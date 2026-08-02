// F30 "Geri dönüş" — kuryeden geri beklenen kutuların kuyruğu.
//
// Bu ekran bir GÖRÜNÜRLÜK aracıdır: hiçbir yerde görünmeyen paket aranmaz.
// Teslim edilemeyen ya da ertelenen sipariş kutusu araçta kalır; kutu depoya
// gelip OKUTULANA kadar sipariş yeniden dağıtıma giremez. Satırdaki "kaç
// gündür" bekleme süresi sunucudan gelir ve sıralamayı o belirler — en eski
// önce, çünkü kaybolan kutu en çok orada saklanır.
//
// Depoya kabul `packing.manage` ister: okutma yapan istasyon operatörü kendi
// başına "geldi" diyemez (görev ayrılığı; kesin karar backend'de).
import { useState } from "react";

import { Badge, Button, EmptyState, ErrorState, PageSkeleton, ReasonDialog } from "@/components/admin/ui";
import { useReturnInPackage, useReturnQueue } from "@/hooks/usePacking";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { ReturnQueueRow } from "@/types/packing";

import { usePackingAccess } from "./PackingLayout";

/** Bekleme süresi kaç günden sonra "takip edilmeli" sayılır. */
const GECIKME_ESIGI = 3;

export default function ReturnQueuePage() {
  const { canView, canManage } = usePackingAccess();
  const query = useReturnQueue(canView);
  const returnIn = useReturnInPackage();
  const [kabulSatiri, setKabulSatiri] = useState<ReturnQueueRow | null>(null);

  const satirlar = query.data ?? [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Kuryeden dönmesi beklenen kutular
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Kutu depoya geldiğinde burada kabul edin; ancak ondan sonra yeniden
            dağıtıma verilebilir. En uzun süredir bekleyen en üstte.
          </p>
        </div>
        {satirlar.length > 0 && <Badge tone="warning">{satirlar.length} kutu</Badge>}
      </div>

      {query.isError ? (
        <div className="p-6">
          <ErrorState
            description={getErrorMessage(query.error, "Geri dönüş kuyruğu yüklenemedi.")}
            onRetry={query.refetch}
          />
        </div>
      ) : query.isLoading ? (
        <div className="p-6">
          <PageSkeleton rows={2} />
        </div>
      ) : satirlar.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="Araçta bekleyen kutu bulunmuyor"
            description="Teslim edilemeyen bir paket olduğunda kutusu burada listelenir."
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
          {satirlar.map((satir) => (
            <li key={satir.package_id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {satir.package_code}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    sipariş #{satir.order_id}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {satir.courier_name ?? "Kurye kaydı bulunmuyor"}
                </p>
              </div>
              {/* Renk tek başına uyarı değildir: gün sayısı metinde de yazar. */}
              <Badge tone={satir.waiting_days >= GECIKME_ESIGI ? "danger" : "neutral"}>
                {satir.waiting_days} gündür araçta
              </Badge>
              {canManage && (
                <Button size="sm" variant="secondary" onClick={() => setKabulSatiri(satir)}>
                  Depoya al
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ReasonDialog
        open={kabulSatiri != null}
        title="Kutuyu depoya al"
        description={
          kabulSatiri
            ? `${kabulSatiri.package_code} kutusunun depoya döndüğünü onaylıyorsunuz. Kutuyu fiziksel olarak görmeden onaylamayın.`
            : ""
        }
        label="Not (isteğe bağlı)"
        placeholder="Örn. kutu ıslanmış, içerik kontrol edildi"
        confirmLabel="Depoya alındı"
        isPending={returnIn.isPending}
        onClose={() => setKabulSatiri(null)}
        onConfirm={(note) => {
          if (!kabulSatiri) return;
          returnIn.mutate(
            {
              packageId: kabulSatiri.package_id,
              // Boş not GÖNDERİLMEZ: şema `extra="forbid"` değil ama boş string
              // ile dolu not aynı alanda ayırt edilemez hâle gelirdi.
              payload: note ? { note } : {},
            },
            {
              onSuccess: () => {
                setKabulSatiri(null);
                toast.success("Kutu depoya alındı.");
              },
              onError: (e) => {
                setKabulSatiri(null);
                toast.error(getErrorMessage(e, "Kutu depoya alınamadı."));
              },
            },
          );
        }}
      />
    </section>
  );
}
