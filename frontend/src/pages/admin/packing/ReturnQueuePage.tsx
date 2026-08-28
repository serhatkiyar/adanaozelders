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
import { useSearchParams } from "react-router-dom";

import { Badge, Button, EmptyState, ErrorState, PageSkeleton, ReasonDialog } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useReturnInPackage, useReturnQueue } from "@/hooks/usePacking";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { ReturnQueueRow } from "@/types/packing";

import { usePackingAccess } from "./PackingLayout";

/** Bekleme süresi kaç günden sonra "takip edilmeli" sayılır. */
const GECIKME_ESIGI = 3;

/** Sunucu tavanı 200; kardeş ekranlarla aynı sayfa boyu. */
const LIMIT = 50;

/** `schemas.packing.NOTE_MAX` — depoya kabul notunun gerçek tavanı. */
const NOT_MAX = 500;

function sayfaNo(raw: string | null): number {
  const n = Number(raw ?? "1");
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export default function ReturnQueuePage() {
  const { canView, canManage } = usePackingAccess();
  const [params, setParams] = useSearchParams();
  const sayfa = sayfaNo(params.get("sayfa"));
  // Uç artık sayfalı ({items,total,limit,offset}); eskiden düz bir liste
  // dönüyordu. Bu kuyruk tam olarak "kimsenin kapatmadığı" satırların
  // biriktiği yerdir, yani sınırsız büyümeye en yatkın olanı.
  const query = useReturnQueue({ limit: LIMIT, offset: (sayfa - 1) * LIMIT }, canView);
  const returnIn = useReturnInPackage();
  // Pencere durumu ekranda YASAMAZ (IP-A4 sozlesmesi): kabul edilecek satir
  // yuzeyin HEDEFIDIR.
  const kabul = useDuzenlemeYuzeyi<ReturnQueueRow, void>();
  const kabulSatiri = kabul.kayit;

  const satirlar = query.data?.items ?? [];
  // `total` SÜZÜLMÜŞ toplamdır, sayfanın uzunluğu değil: rozet "N kutu" derken
  // N'in sayfa uzunluğu olması sayacı sessizce yalancı yapardı.
  const toplam = query.data?.total ?? 0;
  const sonSayfa = Math.max(1, Math.ceil(toplam / LIMIT));

  const sayfaGit = (yeni: number) =>
    setParams(yeni <= 1 ? {} : { sayfa: String(yeni) }, { replace: true });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white ">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 ">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 ">
            Kuryeden dönmesi beklenen kutular
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 ">
            Kutu depoya geldiğinde burada kabul edin; ancak ondan sonra yeniden
            dağıtıma verilebilir. En uzun süredir bekleyen en üstte.
          </p>
        </div>
        {toplam > 0 && <Badge tone="warning">{toplam} kutu</Badge>}
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
        <ul className="divide-y divide-slate-100 px-6 ">
          {satirlar.map((satir) => (
            <li key={satir.package_id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-sm font-semibold text-slate-900 ">
                  {satir.package_code}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    sipariş #{satir.order_id}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500 ">
                  {satir.courier_name ?? "Kurye kaydı bulunmuyor"}
                </p>
              </div>
              {/* Renk tek başına uyarı değildir: gün sayısı metinde de yazar. */}
              <Badge tone={satir.waiting_days >= GECIKME_ESIGI ? "danger" : "neutral"}>
                {satir.waiting_days} gündür araçta
              </Badge>
              {canManage && (
                <Button size="sm" variant="secondary" onClick={() => kabul.ac(satir)}>
                  Depoya al
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {toplam > LIMIT && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-3 ">
          <span className="text-xs text-slate-500 ">
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

      <ReasonDialog
        open={kabul.acik}
        title="Kutuyu depoya al"
        description={
          kabulSatiri
            ? `${kabulSatiri.package_code} kutusunun depoya döndüğünü onaylıyorsunuz. Kutuyu fiziksel olarak görmeden onaylamayın.`
            : ""
        }
        label="Not (isteğe bağlı)"
        placeholder="Örn. kutu ıslanmış, içerik kontrol edildi"
        maxLength={NOT_MAX}
        confirmLabel="Depoya alındı"
        cancelLabel="İptal"
        isPending={returnIn.isPending}
        onClose={kabul.kapat}
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
                kabul.kapat();
                toast.success("Kutu depoya alındı.");
              },
              onError: (e) => {
                kabul.kapat();
                toast.error(getErrorMessage(e, "Kutu depoya alınamadı."));
              },
            },
          );
        }}
      />
    </section>
  );
}
