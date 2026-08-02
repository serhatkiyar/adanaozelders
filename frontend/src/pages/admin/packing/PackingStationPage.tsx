// F30 paketleme istasyonu — tek paketin kalem kalem doğrulandığı ekran.
//
// ## Ekranın tek işi
//
// Operatör kutuya NE koyacağını görsün, her kalemi okutsun, paket ancak bütün
// satırlar tamamlanınca kapansın. F26'da hazırlama ekranı ne satın alındığını
// GÖSTERMİYORDU ve "hazır" damgası tek tıkla vuruluyordu; burada kalem listesi
// ekranın merkezindedir ve kapatma engellerine bağlıdır.
//
// ## Red SESSİZCE yutulmaz
//
// Tarama ucu reddi de **200** ile döner (sözleşme §6: red bir olaydır ve ize
// yazılabilmesi için transaction commit edilir). Yani `catch` bloğu iş sonucunu
// görmez; ekran `result` alanını okumazsa yanlış ürün kutuya girer ve kimse fark
// etmez. Bu yüzden her okutmanın sonucu tek bir `role="alert"` şeridinde, tonu
// ve gerekçesiyle gösterilir — bilinmeyen sonuç kodu **hata** sayılır
// (`lib/packing.ts` fail-closed sözleşmesi).
//
// ## Adetler sunucudan gelir
//
// Hiçbir yerde yerel sayaç artırılmaz: tarama yanıtı paketin GÜNCEL hâlini
// taşır ve hook onu detay önbelleğine yazar. İyimser artırma, reddedilen
// taramada ekranı sunucuyla çelişkiye düşürürdü.
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  Badge,
  Button,
  ErrorState,
  PageSkeleton,
  ReasonDialog,
} from "@/components/admin/ui";
import {
  useCompletePackage,
  usePackage,
  useScanPackageItem,
  useUndoPackageScan,
  useVoidPackage,
} from "@/hooks/usePacking";
import { getErrorMessage } from "@/lib/errors";
import {
  PACKAGE_STATUS_LABEL,
  completeBlockers,
  newIdempotencyKey,
  packageProgress,
  scanResultMessage,
  scanResultTone,
  type ScanTone,
} from "@/lib/packing";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { PackageItem, PackageStatus, ScanResult } from "@/types/packing";

import { usePackingAccess } from "./PackingLayout";

/* ════════════════════════ Sunum tabloları ════════════════════════ */

const TON_SINIFI: Record<ScanTone, string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-50",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-50",
  error:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-50",
};

/**
 * Sonucun iki kelimelik başlığı; uzun cümle `scanResultMessage`'da KALIR.
 *
 * Kopya değil, tamamlayıcı: operatör ekrana bir metre uzaktan bakar ve önce
 * "kabul mü, red mi" sorusunu cevaplamalıdır. Renk tek başına bunu söyleyemez
 * (renk körlüğü + depo aydınlatması), o yüzden başlık metindir.
 */
const SONUC_BASLIGI: Record<ScanResult, string> = {
  OK: "Okutuldu",
  OK_MANUAL: "Elle doğrulandı",
  WRONG_SKU: "Yanlış ürün",
  OVER_QTY: "Fazla adet",
  ALREADY_COMPLETE: "Paket zaten tamam",
  UNSCANNABLE: "Okutulamaz satır",
};

function sonucBasligi(result: string): string {
  const tablo = SONUC_BASLIGI as Record<string, string | undefined>;
  // Bilinmeyen kod onaylanmaz (bkz. `scanResultTone` fail-closed).
  return tablo[result] ?? "Kabul edilmedi";
}

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
 * "Paketten vazgeç" hangi durumlarda anlamlı?
 *
 * `services/packing_rules.PACKAGE_ACTIONS["void"]` ile aynı küme. Kesin kararı
 * sunucu verir (ve yetkiyi duruma göre `pack`/`manage` olarak çözer); buradaki
 * liste yalnız sunucunun 409 döneceği butonu hiç göstermemek içindir.
 */
const VAZGECILEBILIR: readonly string[] = ["OPEN", "PACKED", "RETURNED"];

interface Bildirim {
  tone: ScanTone;
  title: string;
  message: string;
}

/* ════════════════════════ Ekran ════════════════════════ */

export default function PackingStationPage() {
  const { id } = useParams<{ id: string }>();
  const paketId = Number(id);
  const gecerliId = Number.isInteger(paketId) && paketId > 0;

  const { canView, canPack } = usePackingAccess();
  const query = usePackage(gecerliId ? paketId : null, canView);

  const scan = useScanPackageItem();
  const undo = useUndoPackageScan();
  const complete = useCompletePackage();
  const voidPackage = useVoidPackage();

  const [kod, setKod] = useState("");
  const [bildirim, setBildirim] = useState<Bildirim | null>(null);
  const [manuelSatir, setManuelSatir] = useState<PackageItem | null>(null);
  const [geriAlSatir, setGeriAlSatir] = useState<PackageItem | null>(null);
  const [vazgecAcik, setVazgecAcik] = useState(false);
  const kutuRef = useRef<HTMLInputElement>(null);

  const paket = query.data;

  /** Okutma/manuel sonucunu tek yerden yazar ve odağı kutuya geri verir. */
  const sonucuIsle = (result: string) => {
    setBildirim({
      tone: scanResultTone(result),
      title: sonucBasligi(result),
      message: scanResultMessage(result),
    });
    setKod("");
    // Barkod tabancası "yaz + Enter" gönderir: odak kutuda değilse sonraki
    // okutma hiçbir yere yazılmaz ve operatör bunu ancak sayı artmayınca fark
    // eder.
    kutuRef.current?.focus();
  };

  const hataylaIsle = (e: unknown, fallback: string) => {
    setBildirim({ tone: "error", title: "Gönderilemedi", message: getErrorMessage(e, fallback) });
    kutuRef.current?.focus();
  };

  const okut = () => {
    const deger = kod.trim();
    // Çift gönderim kilidi: tabanca aynı barkodu iki kez yollayabilir, kullanıcı
    // Enter'a basılı tutabilir. Anahtar gönderim NİYETİ başında üretilir —
    // her render'da yenilenen bir anahtar, ağ tekrarını sunucuya iki ayrı iş
    // gibi gösterir ve aynı kitabı iki kez saydırırdı.
    if (!deger || scan.isPending || !paket) return;
    scan.mutate(
      {
        packageId: paket.id,
        payload: { code: deger, idempotency_key: newIdempotencyKey() },
      },
      {
        onSuccess: (sonuc) => sonucuIsle(sonuc.result),
        onError: (e) => hataylaIsle(e, "Okutma gönderilemedi."),
      },
    );
  };

  if (!gecerliId) {
    return <ErrorState description="Paket adresi geçersiz. Paketler listesinden yeniden açın." />;
  }
  if (query.isError) {
    return (
      <ErrorState
        description={getErrorMessage(query.error, "Paket yüklenemedi.")}
        onRetry={query.refetch}
      />
    );
  }
  if (query.isLoading || !paket) {
    return <PageSkeleton rows={4} />;
  }

  const acik = paket.status === "OPEN";
  const ilerleme = packageProgress(paket.items);
  const engeller = completeBlockers(paket);

  return (
    <div className="space-y-4">
      {/* ── Başlık: hangi kutu, hangi sipariş, hangi durum ── */}
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mr-auto min-w-0">
          <p className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            {paket.code}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Sipariş{" "}
            <Link
              to={`${ROUTES.adminPackingPackages}?siparis=${paket.order_id}`}
              className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              #{paket.order_id}
            </Link>{" "}
            · {paket.package_no}. paket
          </p>
        </div>
        <Badge tone={DURUM_TONU[paket.status] ?? "neutral"}>
          {PACKAGE_STATUS_LABEL[paket.status] ?? paket.status}
        </Badge>
        <span className="text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-300">
          {ilerleme.scanned} / {ilerleme.expected} okutuldu
        </span>
        {canPack && VAZGECILEBILIR.includes(paket.status) && (
          <Button size="sm" variant="ghost" onClick={() => setVazgecAcik(true)}>
            Paketten vazgeç
          </Button>
        )}
      </section>

      {/* ── Okutma kutusu ── */}
      {acik && canPack && (
        <section className="rounded-2xl border border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              okut();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <label htmlFor="paketleme-kod" className="min-w-0 flex-1 basis-64">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Barkod veya SKU okut
              </span>
              <input
                id="paketleme-kod"
                ref={kutuRef}
                autoFocus
                autoComplete="off"
                value={kod}
                onChange={(e) => setKod(e.target.value)}
                placeholder="Tabancayla okutun ya da kodu yazıp Enter'a basın"
                className="input"
              />
            </label>
            <Button type="submit" isPending={scan.isPending} disabled={!kod.trim()}>
              Okut
            </Button>
          </form>
          {bildirim && (
            <div
              role="alert"
              className={`mt-3 rounded-xl border px-4 py-3 text-sm ${TON_SINIFI[bildirim.tone]}`}
            >
              <p className="font-bold">{bildirim.title}</p>
              <p className="mt-0.5 opacity-90">{bildirim.message}</p>
            </div>
          )}
        </section>
      )}

      {/* ── Kalemler ── */}
      <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-6 py-3 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Kutuya girecek kalemler
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Her satır ürünün kendi kodundan doğrulanır; kodu okunamayan satır
            gerekçeyle elle kapatılır ve gerekçe kayda geçer.
          </p>
        </div>
        <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
          {paket.items.map((satir) => {
            const kalan = satir.expected_qty - satir.scanned_qty;
            const tamam = kalan <= 0;
            return (
              <li
                key={satir.order_item_id}
                data-testid={`satir-${satir.order_item_id}`}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {satir.title}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                    {satir.sku ?? "SKU yok"}
                    {satir.barcode ? ` · ${satir.barcode}` : ""}
                  </p>
                </div>
                {/* Renk tek başına durum göstermez: sayı da, işaret de metin. */}
                <p className="shrink-0 text-sm tabular-nums">
                  <span
                    className={
                      tamam
                        ? "font-bold text-emerald-600 dark:text-emerald-400"
                        : "font-bold text-slate-900 dark:text-white"
                    }
                  >
                    {satir.scanned_qty}
                  </span>
                  {" / "}
                  <span className="text-slate-600 dark:text-slate-300">
                    {satir.expected_qty}
                  </span>{" "}
                  <span className="text-xs text-slate-400">adet</span>
                </p>
                {acik && canPack && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {satir.scanned_qty > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setGeriAlSatir(satir)}
                      >
                        Geri al
                      </Button>
                    )}
                    {!tamam && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setManuelSatir(satir)}
                      >
                        Elle doğrula
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Kapatma ── */}
      {acik && canPack && (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mr-auto min-w-0">
            {/* Disabled buton sessiz kalmaz: operatör NEDEN kapatamadığını
                görmeli. Gerekçe tek cümledir — `completeBlockers` satır satır
                metin üretir ve her satırda ürün başlığını TEKRAR eder; başlıklar
                zaten hemen yukarıdaki listede ve her satırın "taranan /
                beklenen" sayısı görünür durumda. Engelin VARLIĞI için yine saf
                kural katmanı otoritedir (`engeller.length`), yalnız sunumu
                sadeleşir. */}
            {engeller.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Bütün kalemler doğrulandı. Kutuyu kapatıp etiketini yapıştırın.
              </p>
            ) : paket.items.length === 0 ? (
              <p className="text-xs leading-5 text-amber-700 dark:text-amber-400">
                {engeller[0]}
              </p>
            ) : (
              <p className="text-xs leading-5 text-amber-700 dark:text-amber-400">
                Paketi kapatmak için {ilerleme.remaining} adet daha okutulmalı.
                Eksik satırlar listede “taranan / beklenen” sayısıyla görünür.
              </p>
            )}
          </div>
          <Button
            variant="success"
            disabled={engeller.length > 0}
            isPending={complete.isPending}
            onClick={() =>
              complete.mutate(paket.id, {
                onSuccess: () => toast.success(`${paket.code} paketlendi.`),
                onError: (e) => toast.error(getErrorMessage(e, "Paket kapatılamadı.")),
              })
            }
          >
            Paketi tamamla
          </Button>
        </section>
      )}

      {!acik && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
          Bu paket “{PACKAGE_STATUS_LABEL[paket.status] ?? paket.status}” durumunda;
          okutma ve kapatma yalnız paketlenmekte olan pakette yapılır.
        </p>
      )}

      {/* ── Gerekçeli pencereler ── */}
      <ReasonDialog
        open={manuelSatir != null}
        title="Elle doğrula"
        description={
          manuelSatir
            ? `“${manuelSatir.title}” satırı koddan okutulmadan kapatılacak. Gerekçe kayda geçer.`
            : ""
        }
        label="Gerekçe"
        placeholder="Örn. ürün barkodu yırtılmış, rafta el yazısı etiket var"
        required
        isPending={scan.isPending}
        onClose={() => setManuelSatir(null)}
        onConfirm={(reason) => {
          if (!manuelSatir) return;
          scan.mutate(
            {
              packageId: paket.id,
              payload: {
                manual: true,
                manual_reason: reason,
                order_item_id: manuelSatir.order_item_id,
                idempotency_key: newIdempotencyKey(),
              },
            },
            {
              onSuccess: (sonuc) => {
                setManuelSatir(null);
                sonucuIsle(sonuc.result);
              },
              onError: (e) => {
                setManuelSatir(null);
                hataylaIsle(e, "Elle doğrulama gönderilemedi.");
              },
            },
          );
        }}
      />

      <ReasonDialog
        open={geriAlSatir != null}
        title="Okutmayı geri al"
        description={
          geriAlSatir
            ? `“${geriAlSatir.title}” satırından bir adet düşülecek. Gerekçe kayda geçer.`
            : ""
        }
        label="Gerekçe"
        placeholder="Örn. yanlış kutuya kondu, rafa geri götürüldü"
        required
        isPending={undo.isPending}
        onClose={() => setGeriAlSatir(null)}
        onConfirm={(reason) => {
          if (!geriAlSatir) return;
          undo.mutate(
            {
              packageId: paket.id,
              payload: {
                order_item_id: geriAlSatir.order_item_id,
                reason,
                // Geri alma durum-idempotan DEĞİL: ağ tekrarı anahtarsız
                // gönderilirse adedi iki kez düşürür.
                idempotency_key: newIdempotencyKey(),
              },
            },
            {
              onSuccess: () => {
                setGeriAlSatir(null);
                toast.success("Okutma geri alındı.");
              },
              onError: (e) => {
                setGeriAlSatir(null);
                toast.error(getErrorMessage(e, "Geri alınamadı."));
              },
            },
          );
        }}
      />

      <ReasonDialog
        open={vazgecAcik}
        title="Paketten vazgeç"
        description="Kutu bozulur, içerik rafa döner ve sipariş yeniden paketlenmeyi bekler. Gerekçe kayda geçer."
        label="Gerekçe"
        placeholder="Örn. sipariş iptal edildi, kutu hasar gördü"
        required
        danger
        confirmLabel="Vazgeç"
        isPending={voidPackage.isPending}
        onClose={() => setVazgecAcik(false)}
        onConfirm={(reason) =>
          voidPackage.mutate(
            { packageId: paket.id, reason },
            {
              onSuccess: () => {
                setVazgecAcik(false);
                toast.success(`${paket.code} paketinden vazgeçildi.`);
              },
              onError: (e) => {
                setVazgecAcik(false);
                toast.error(getErrorMessage(e, "Paketten vazgeçilemedi."));
              },
            },
          )
        }
      />
    </div>
  );
}
