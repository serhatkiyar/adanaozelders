// Sayım oturumu detayı — satır sayımı, inceleme ve farkın uygulanması.
//
// Ekranın tek işi: hangi sayının ne anlama geldiğini karıştırmadan göstermek.
// Sistem · rezerve · beklenen fiziksel · sayılan · fark AYRI sütunlardır;
// hasarlı kovada rezerve "0" değil "uygulanmaz"dır; sayılmamış satırın farkı
// "0" değil "henüz sayılmadı"dır.
//
// ⚠ Ürün adı/SKU gösterilemiyor: sayım uçları yalnız `product_id` taşıyor ve
// ürün adını veren uç farklı bir izne (`products.view`) bağlı. Bulgu commit 8
// raporu §15'te kayıtlı; burada kararlı kimlik olarak ürün numarası kullanılır.
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  PageSkeleton,
  ReasonDialog,
} from "@/components/admin/ui";
import {
  useApplyCountSession,
  useCancelCountSession,
  useCountSession,
  useCountSessionAction,
  useAddCountProducts,
  useResolveCountLine,
  useSetLineCount,
} from "@/hooks/useInventory";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import {
  allowedCountActions,
  applyBlockers,
  bucketLabel,
  expectedPhysical,
  formatCountedQty,
  formatDifference,
  inventoryErrorMessage,
  lineDifference,
  lineStatusBadge,
  newIdempotencyKey,
  reservedDisplay,
  sessionStatusBadge,
  staleReasonLabel,
} from "@/lib/inventory";
import { toast } from "@/store/toastStore";

import type { CountLineOut, CountSessionDetailOut } from "@/api/inventory";

const ZAMAN = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function zaman(iso: string | null): string {
  return iso ? ZAMAN.format(new Date(iso)) : "—";
}

/* ── Oturum üst özeti ── */

function Ozet({ oturum }: { oturum: CountSessionDetailOut }) {
  const rozet = sessionStatusBadge(oturum.status);
  const satirlar: [string, string][] = [
    ["Açan", `#${oturum.created_by_admin_id} · ${zaman(oturum.created_at)}`],
    ["Sayım başlangıcı", zaman(oturum.started_at)],
    [
      "İncelemeye gönderen",
      oturum.reviewed_by_admin_id
        ? `#${oturum.reviewed_by_admin_id} · ${zaman(oturum.reviewed_at)}`
        : "—",
    ],
    [
      "Uygulayan",
      oturum.applied_by_admin_id
        ? `#${oturum.applied_by_admin_id} · ${zaman(oturum.applied_at)}`
        : "—",
    ],
  ];
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
      <div className="mr-auto">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{oturum.code}</h2>
          <Badge tone={rozet.tone}>{rozet.label}</Badge>
        </div>
        {oturum.note && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{oturum.note}</p>
        )}
        {oturum.cancel_reason && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            İptal gerekçesi: {oturum.cancel_reason}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        {satirlar.map(([k, v]) => (
          <div key={k}>
            <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-slate-800 dark:text-slate-200">
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── Satır ── */

function SatirGorunumu({
  satir,
  sayilabilir,
  onSay,
  onAcikla,
  kaydediliyor,
}: {
  satir: CountLineOut;
  sayilabilir: boolean;
  onSay: (lineId: number, qty: number) => void;
  onAcikla: (lineId: number) => void;
  kaydediliyor: boolean;
}) {
  const [taslak, setTaslak] = useState<string>(
    satir.counted_qty === null ? "" : String(satir.counted_qty)
  );
  // Sunucudan yeni bir sayım/snapshot geldiğinde alan onu yansıtmalı; aksi
  // hâlde ekranda eski rakam kalır ve operatör onu "kaydedilmiş" sanır.
  useEffect(() => {
    setTaslak(satir.counted_qty === null ? "" : String(satir.counted_qty));
  }, [satir.counted_qty, satir.counted_at]);

  const rozet = lineStatusBadge(satir.status);
  const kova = bucketLabel(satir.bucket);
  const gecerli = taslak !== "" && Number.isInteger(Number(taslak)) && Number(taslak) >= 0;

  return (
    <tr
      data-testid={`count-line-${satir.id}`}
      className={rozet.needsAction && satir.status !== "PENDING" ? "bg-rose-50/40 dark:bg-rose-500/5" : undefined}
    >
      <td className="px-3 py-2.5 text-sm text-slate-900 dark:text-white">Ürün #{satir.product_id}</td>
      <td className="px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300">{kova}</td>
      <td data-testid="system" className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700 dark:text-slate-300">
        {satir.system_qty_snapshot}
      </td>
      <td data-testid="reserved" className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-500 dark:text-slate-400">
        {reservedDisplay(satir)}
      </td>
      <td data-testid="expected" className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
        {expectedPhysical(satir)}
      </td>
      <td data-testid="counted" className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700 dark:text-slate-300">
        {sayilabilir ? (
          <div className="flex items-center justify-end gap-1.5">
            <input
              type="number"
              min="0"
              step="1"
              className="input w-24 text-right"
              aria-label={`Sayılan miktar — ${kova} (ürün #${satir.product_id})`}
              value={taslak}
              onChange={(e) => setTaslak(e.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!gecerli}
              isPending={kaydediliyor}
              onClick={() => onSay(satir.id, Number(taslak))}
            >
              Kaydet
            </Button>
          </div>
        ) : (
          formatCountedQty(satir)
        )}
      </td>
      <td
        data-testid="difference"
        className={`px-3 py-2.5 text-right text-sm font-semibold tabular-nums ${
          (lineDifference(satir) ?? 0) === 0
            ? "text-slate-500 dark:text-slate-400"
            : "text-rose-600 dark:text-rose-400"
        }`}
      >
        {formatDifference(satir)}
      </td>
      <td className="px-3 py-2.5 text-sm">
        <Badge tone={rozet.tone}>{rozet.label}</Badge>
        {satir.stale_reason && (
          <p className="mt-1 max-w-52 text-xs text-slate-500 dark:text-slate-400">
            {staleReasonLabel(satir.stale_reason)}
          </p>
        )}
        {satir.resolution_note && (
          <p className="mt-1 max-w-52 text-xs italic text-slate-500 dark:text-slate-400">
            #{satir.resolved_by_admin_id}: {satir.resolution_note}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
        {satir.counted_by_admin_id ? `#${satir.counted_by_admin_id}` : "—"}
        <span className="block tabular-nums">{zaman(satir.counted_at)}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        {sayilabilir && (satir.status === "STALE" || satir.status === "RESOLVED") && (
          <Button size="sm" variant="ghost" onClick={() => onAcikla(satir.id)}>
            Açıklama ekle
          </Button>
        )}
      </td>
    </tr>
  );
}

/* ── Uygulama onayı ── */

function UygulaDialog({
  open,
  satirlar,
  isPending,
  hata,
  onClose,
  onConfirm,
}: {
  open: boolean;
  satirlar: CountLineOut[];
  isPending: boolean;
  hata: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const etkiler = satirlar
    .map((s) => ({ satir: s, fark: lineDifference(s) }))
    .filter((e) => e.fark !== null && e.fark !== 0);

  return (
    <Dialog
      open={open}
      title="Farkları uygula"
      description="Aşağıdaki düzeltmeler stok defterine yazılacak. İşlem geri alınamaz; yanlışsa yeni bir sayım açmak gerekir."
      onClose={() => !isPending && onClose()}
    >
      <div className="space-y-4">
        {etkiler.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Fark yok — hiçbir stok hareketi yazılmayacak, oturum yalnız kapanacak.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {etkiler.map(({ satir, fark }) => (
              <li key={satir.id} className="px-4 py-2.5 text-sm text-slate-800 dark:text-slate-200">
                Ürün #{satir.product_id} · {bucketLabel(satir.bucket)}{" "}
                <span className="font-semibold tabular-nums">{formatDifference(satir)}</span>
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                  ({expectedPhysical(satir)} → {satir.counted_qty})
                </span>
                <span className="sr-only">{fark}</span>
              </li>
            ))}
          </ul>
        )}
        {hata && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
            {hata}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={isPending} onClick={onClose}>
            Vazgeç
          </Button>
          <Button isPending={isPending} onClick={onConfirm}>
            Farkları uygula
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ── Sayfa ── */

export default function CountSessionDetailPage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const { canCount, canApply } = useInventoryAccess();
  const sorgu = useCountSession(sessionId);
  const oturum = sorgu.data;

  const say = useSetLineCount(sessionId);
  const acikla = useResolveCountLine(sessionId);
  const aksiyon = useCountSessionAction(sessionId);
  const uygula = useApplyCountSession(sessionId);
  const iptal = useCancelCountSession(sessionId);
  const urunEkle = useAddCountProducts(sessionId);

  const [uygulaAcik, setUygulaAcik] = useState(false);
  const [iptalAcik, setIptalAcik] = useState(false);
  const [aciklananSatir, setAciklananSatir] = useState<number | null>(null);
  const [uygulaHatasi, setUygulaHatasi] = useState<string | null>(null);
  const [urunGirdi, setUrunGirdi] = useState("");

  // İdempotency anahtarı tek gönderim niyeti boyunca SABİT kalır: her
  // render'da yenilenirse ağ tekrarında sunucu iki ayrı iş görür.
  const anahtarRef = useRef<string>(newIdempotencyKey());
  // Çift tıklama kilidi state DEĞİL ref: aynı tick içindeki ikinci tıklama
  // `isPending` güncellenmeden önce gelir.
  const gonderildiRef = useRef(false);

  const eylemler = useMemo(
    () => (oturum ? allowedCountActions(oturum.status) : []),
    [oturum]
  );
  const engeller = useMemo(() => (oturum ? applyBlockers(oturum.lines) : []), [oturum]);

  if (sorgu.isError) {
    return (
      <ErrorState
        description={inventoryErrorMessage(sorgu.error, "Sayım oturumu yüklenemedi.")}
        onRetry={() => sorgu.refetch()}
      />
    );
  }
  if (sorgu.isLoading || !oturum) return <PageSkeleton rows={5} />;

  const sayilabilir = canCount && eylemler.includes("count");

  const uygulaGonder = () => {
    if (gonderildiRef.current) return;
    gonderildiRef.current = true;
    setUygulaHatasi(null);
    uygula.mutate(anahtarRef.current, {
      onSuccess: () => {
        toast.success("Sayım farkları uygulandı.");
        anahtarRef.current = newIdempotencyKey();
        gonderildiRef.current = false;
        setUygulaAcik(false);
      },
      onError: (e) => {
        // Kilit AÇILMAZ: aynı anahtarla tekrar denemek sunucuda replay'dir,
        // farklı anahtarla denemek 409'dur. Kullanıcı pencereyi kapatıp
        // güncel durumu görmeli.
        setUygulaHatasi(inventoryErrorMessage(e, "Farklar uygulanamadı."));
      },
    });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <Ozet oturum={oturum} />

        {/* Eylem barı — FSM ve izne göre yalnız anlamlı olanlar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-6 py-3 dark:border-slate-800">
          {canCount && eylemler.includes("products") && (
            <div className="mr-auto flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Ürün ekle
                </span>
                <input
                  className="input w-40"
                  value={urunGirdi}
                  onChange={(e) => setUrunGirdi(e.target.value)}
                  placeholder="12, 34"
                  inputMode="numeric"
                />
              </label>
              <Button
                size="sm"
                variant="secondary"
                isPending={urunEkle.isPending}
                onClick={() => {
                  const idler = urunGirdi
                    .split(/[\s,]+/)
                    .map(Number)
                    .filter((n) => Number.isInteger(n) && n > 0);
                  if (!idler.length) return;
                  urunEkle.mutate(idler, {
                    onSuccess: () => {
                      setUrunGirdi("");
                      toast.success("Ürünler oturuma eklendi.");
                    },
                    onError: (e) =>
                      toast.error(inventoryErrorMessage(e, "Ürün eklenemedi.")),
                  });
                }}
              >
                Ekle
              </Button>
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canCount && eylemler.includes("start") && (
              <Button
                size="sm"
                isPending={aksiyon.isPending}
                onClick={() =>
                  aksiyon.mutate("start", {
                    onError: (e) =>
                      toast.error(inventoryErrorMessage(e, "Sayım başlatılamadı.")),
                  })
                }
              >
                Sayımı başlat
              </Button>
            )}
            {canCount && eylemler.includes("submit") && (
              <Button
                size="sm"
                isPending={aksiyon.isPending}
                onClick={() =>
                  aksiyon.mutate("submit", {
                    onError: (e) =>
                      toast.error(inventoryErrorMessage(e, "Oturum gönderilemedi.")),
                  })
                }
              >
                İncelemeye gönder
              </Button>
            )}
            {canApply && eylemler.includes("reopen") && (
              <Button
                size="sm"
                variant="secondary"
                isPending={aksiyon.isPending}
                onClick={() =>
                  aksiyon.mutate("reopen", {
                    onError: (e) =>
                      toast.error(inventoryErrorMessage(e, "İnceleme geri alınamadı.")),
                  })
                }
              >
                İncelemeyi geri al
              </Button>
            )}
            {canApply && eylemler.includes("apply") && (
              <Button
                size="sm"
                variant="success"
                disabled={engeller.length > 0}
                onClick={() => {
                  setUygulaHatasi(null);
                  setUygulaAcik(true);
                }}
              >
                Farkları uygula
              </Button>
            )}
            {canCount && eylemler.includes("cancel") && (
              <Button size="sm" variant="ghost" onClick={() => setIptalAcik(true)}>
                Oturumu iptal et
              </Button>
            )}
          </div>
        </div>

        {engeller.length > 0 && canApply && eylemler.includes("apply") && (
          <ul
            data-testid="apply-blockers"
            className="space-y-1 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {engeller.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}

        {/* Tablo kendi kabında yatay kayar; sayfa gövdesi taşmaz. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th scope="col" className="px-3 py-2 font-semibold">Ürün</th>
                <th scope="col" className="px-3 py-2 font-semibold">Kova</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Sistem</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Rezerve</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Beklenen fiziksel</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Sayılan</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Fark</th>
                <th scope="col" className="px-3 py-2 font-semibold">Durum</th>
                <th scope="col" className="px-3 py-2 font-semibold">Son sayan</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Eylem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {oturum.lines.map((s) => (
                <SatirGorunumu
                  key={s.id}
                  satir={s}
                  sayilabilir={sayilabilir}
                  kaydediliyor={say.isPending}
                  onAcikla={setAciklananSatir}
                  onSay={(lineId, qty) =>
                    say.mutate(
                      { lineId, countedQty: qty },
                      {
                        onSuccess: () => toast.success("Sayım kaydedildi."),
                        onError: (e) =>
                          toast.error(inventoryErrorMessage(e, "Sayım kaydedilemedi.")),
                      }
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        {oturum.lines.length === 0 && (
          <p className="px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Oturumda henüz ürün yok. Yukarıdan ürün numarası ekleyin.
          </p>
        )}
      </section>

      <UygulaDialog
        open={uygulaAcik}
        satirlar={oturum.lines}
        isPending={uygula.isPending}
        hata={uygulaHatasi}
        onClose={() => setUygulaAcik(false)}
        onConfirm={uygulaGonder}
      />

      <ReasonDialog
        open={iptalAcik}
        title="Sayım oturumunu iptal et"
        description="İptal geri alınamaz; oturum salt okunur olur ve hiçbir stok hareketi yazılmaz."
        label="İptal gerekçesi"
        required
        minLength={3}
        danger
        confirmLabel="Oturumu iptal et"
        isPending={iptal.isPending}
        onClose={() => setIptalAcik(false)}
        onConfirm={(reason) =>
          iptal.mutate(reason, {
            onSuccess: () => {
              toast.success("Oturum iptal edildi.");
              setIptalAcik(false);
            },
            onError: (e) => toast.error(inventoryErrorMessage(e, "Oturum iptal edilemedi.")),
          })
        }
      />

      <ReasonDialog
        open={aciklananSatir !== null}
        title="Belirsizliği açıkla"
        description="Açıklama kayda geçer ama satırı UYGULANABİLİR YAPMAZ. Farkın uygulanabilmesi için satır yeniden sayılmalıdır."
        label="Açıklama"
        required
        minLength={3}
        confirmLabel="Açıklamayı kaydet"
        isPending={acikla.isPending}
        onClose={() => setAciklananSatir(null)}
        onConfirm={(note) =>
          acikla.mutate(
            { lineId: aciklananSatir!, note },
            {
              onSuccess: () => {
                toast.success("Açıklama kaydedildi. Satır hâlâ yeniden sayılmalı.");
                setAciklananSatir(null);
              },
              onError: (e) => toast.error(inventoryErrorMessage(e, "Açıklama kaydedilemedi.")),
            }
          )
        }
      />
    </div>
  );
}
