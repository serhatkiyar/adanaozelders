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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  Badge,
  Button,
  ErrorState,
  PageSkeleton,
  ReasonDialog,
} from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form } from "@/components/admin/ui2/form";
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
  productDisplayName,
  productDisplaySku,
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

/**
 * Satır sayım şeması.
 *
 * Boş alan "0 sayıldı" DEĞİLDİR: sayılmamış satırın farkı "0" değil "henüz
 * sayılmadı"dır ve bu ayrım ekranın var olma sebebidir.
 */
const sayimSemasi = z.object({
  counted: z
    .string()
    .refine((v) => v.trim() !== "", "Sayılan miktarı yazın.")
    .refine((v) => Number.isInteger(Number(v)), "Miktar tam sayı olmalı.")
    .refine((v) => Number(v) >= 0, "Miktar negatif olamaz."),
});

function zaman(iso: string | null): string {
  return iso ? ZAMAN.format(new Date(iso)) : "-";
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
        : "-",
    ],
    [
      "Uygulayan",
      oturum.applied_by_admin_id
        ? `#${oturum.applied_by_admin_id} · ${zaman(oturum.applied_at)}`
        : "-",
    ],
  ];
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-3 border-b border-slate-100 px-6 py-4 ">
      <div className="mr-auto">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-slate-900 ">{oturum.code}</h2>
          <Badge tone={rozet.tone}>{rozet.label}</Badge>
        </div>
        {oturum.note && (
          <p className="mt-1 text-xs text-slate-500 ">{oturum.note}</p>
        )}
        {oturum.cancel_reason && (
          <p className="mt-1 text-xs text-slate-500 ">
            İptal gerekçesi: {oturum.cancel_reason}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        {satirlar.map(([k, v]) => (
          <div key={k}>
            <dt className="text-slate-500 ">{k}</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-slate-800 ">
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
  const rozet = lineStatusBadge(satir.status);
  const kova = bucketLabel(satir.bucket);

  // ── İP-A7d3 · satır içi sayım formu ──
  //
  // Eskiden `taslak` bir `useState` idi ve "Kaydet" düğmesi geçerlilikle
  // KAPANIYORDU (`disabled={!gecerli}`): operatör 12,5 yazdığında düğmenin
  // neden tıklanamadığını ekrandan öğrenemiyordu. Artık düğme açık kalır,
  // gönderim yapılmaz ve hata ALANIN altında çıkar.
  const form = useForm<{ counted: string }>({
    resolver: zodResolver(sayimSemasi),
    defaultValues: { counted: satir.counted_qty === null ? "" : String(satir.counted_qty) },
    mode: "onChange",
    shouldFocusError: false,
  });

  // Sunucudan yeni bir sayım/snapshot geldiğinde alan onu yansıtmalı; aksi
  // hâlde ekranda eski rakam kalır ve operatör onu "kaydedilmiş" sanır.
  //
  // `reset` kullanılır, `setValue` DEĞİL: `setValue` alanı KİRLİ bırakır ve
  // sunucudan gelen bir tazeleme, kullanıcı hiçbir şey yazmamışken kirli form
  // bekçisini uyandırırdı.
  useEffect(() => {
    form.reset({ counted: satir.counted_qty === null ? "" : String(satir.counted_qty) });
    // `form` kimliği her render'da sabittir (react-hook-form); bağımlılık
    // listesi bilerek yalnız SUNUCU verisidir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satir.counted_qty, satir.counted_at]);

  const kaydet = form.handleSubmit(
    (deger) => onSay(satir.id, Number(deger.counted)),
    () => form.setFocus("counted")
  );

  return (
    <tr
      data-testid={`count-line-${satir.id}`}
      className={rozet.needsAction && satir.status !== "PENDING" ? "bg-rose-50/40 " : undefined}
    >
      <td className="max-w-64 px-3 py-2.5 text-sm">
        <span
          data-testid="product-name"
          className="block break-words font-medium text-slate-900 "
        >
          {productDisplayName(satir)}
        </span>
        {/* SKU seçilebilir olmalı: operatör raftaki etiketle karşılaştırır. */}
        <span
          data-testid="product-sku"
          className="mt-0.5 block select-all break-all font-mono text-xs text-slate-500 "
        >
          {productDisplaySku(satir)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-sm text-slate-700 ">{kova}</td>
      <td data-testid="system" className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700 ">
        {satir.system_qty_snapshot}
      </td>
      <td data-testid="reserved" className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-500 ">
        {reservedDisplay(satir)}
      </td>
      <td data-testid="expected" className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-slate-900 ">
        {expectedPhysical(satir)}
      </td>
      <td data-testid="counted" className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700 ">
        {sayilabilir ? (
          <div className="flex items-start justify-end gap-1.5">
            <Form.Field
              control={form.control}
              name="counted"
              render={({ field }) => (
                <Form.Item>
                  <Form.Control>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="input w-24 text-right"
                      aria-label={`Sayılan miktar: ${kova} (ürün #${satir.product_id})`}
                      {...field}
                    />
                  </Form.Control>
                  <Form.ErrorMessage className="mt-1 max-w-40 text-left text-xs text-rose-700 " />
                </Form.Item>
              )}
            />
            {/* Düğme geçerlilikle KAPANMAZ (kilitli karar). */}
            <Button size="sm" variant="secondary" isPending={kaydediliyor} onClick={kaydet}>
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
            ? "text-slate-500 "
            : "text-rose-600 "
        }`}
      >
        {formatDifference(satir)}
      </td>
      <td className="px-3 py-2.5 text-sm">
        <Badge tone={rozet.tone}>{rozet.label}</Badge>
        {satir.stale_reason && (
          <p className="mt-1 max-w-52 text-xs text-slate-500 ">
            {staleReasonLabel(satir.stale_reason)}
          </p>
        )}
        {satir.resolution_note && (
          <p className="mt-1 max-w-52 text-xs italic text-slate-500 ">
            #{satir.resolved_by_admin_id}: {satir.resolution_note}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-500 ">
        {satir.counted_by_admin_id ? `#${satir.counted_by_admin_id}` : "-"}
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

/**
 * Uygulama onayı — İP-A7d3'te ortak pencereye geçti.
 *
 * Bu pencerede YAZILAN bir şey yoktur (salt okunur bir etki listesi + onay),
 * dolayısıyla kirli form bekçisi çağrılmaz ve çağrılmaması doğrudur: sorulacak
 * bir değişiklik yok. Kazanç `role="dialog"` + `aria-modal` + odak tuzağı +
 * ESC + arka plan kilidinin TEK yerden gelmesi.
 */
function UygulaPenceresi({
  yuzey,
  satirlar,
  isPending,
  hata,
  onConfirm,
}: {
  yuzey: DuzenlemeYuzeyiDurumu<never, void>;
  satirlar: CountLineOut[];
  isPending: boolean;
  hata: string | null;
  onConfirm: () => void;
}) {
  const etkiler = satirlar
    .map((s) => ({ satir: s, fark: lineDifference(s) }))
    .filter((e) => e.fark !== null && e.fark !== 0);

  return (
    <DuzenlemePenceresi
      yuzey={yuzey}
      baslik="Farkları uygula"
      aciklama="Aşağıdaki düzeltmeler stok defterine yazılacak. İşlem geri alınamaz; yanlışsa yeni bir sayım açmak gerekir."
    >
      <div className="space-y-4">
        {etkiler.length === 0 ? (
          <p className="text-sm text-slate-600 ">
            Fark yok: hiçbir stok hareketi yazılmayacak, oturum yalnız kapanacak.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 ">
            {etkiler.map(({ satir, fark }) => (
              <li key={satir.id} className="px-4 py-2.5 text-sm text-slate-800 ">
                {productDisplayName(satir)} · {bucketLabel(satir.bucket)}{" "}
                <span className="font-semibold tabular-nums">{formatDifference(satir)}</span>
                <span className="ml-2 text-xs text-slate-500 ">
                  ({expectedPhysical(satir)} → {satir.counted_qty})
                </span>
                <span className="sr-only">{fark}</span>
              </li>
            ))}
          </ul>
        )}
        {hata && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 ">
            {hata}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={isPending} onClick={yuzey.kapat}>
            Vazgeç
          </Button>
          <Button isPending={isPending} onClick={onConfirm}>
            Farkları uygula
          </Button>
        </div>
      </div>
    </DuzenlemePenceresi>
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

  // Pencere durumu ekranda YAŞAMAZ (İP-A4 sözleşmesi) — üç bağın üçü de yüzeye
  // taşındı.
  const uygulaYuzeyi = useDuzenlemeYuzeyi<never, void>();
  const iptalYuzeyi = useDuzenlemeYuzeyi<never, void>();
  const aciklamaYuzeyi = useDuzenlemeYuzeyi<number, void>();
  const [uygulaHatasi, setUygulaHatasi] = useState<string | null>(null);

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
        uygulaYuzeyi.kapat();
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
      <section className="rounded-2xl border border-slate-200 bg-white ">
        <Ozet oturum={oturum} />

        {/* Eylem barı — FSM ve izne göre yalnız anlamlı olanlar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-6 py-3 ">
          {canCount && eylemler.includes("products") && (
            <UrunEklemeFormu ekle={urunEkle} />
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
                  uygulaYuzeyi.yeniAc();
                }}
              >
                Farkları uygula
              </Button>
            )}
            {canCount && eylemler.includes("cancel") && (
              <Button size="sm" variant="ghost" onClick={() => iptalYuzeyi.yeniAc()}>
                Oturumu iptal et
              </Button>
            )}
          </div>
        </div>

        {engeller.length > 0 && canApply && eylemler.includes("apply") && (
          <ul
            data-testid="apply-blockers"
            className="space-y-1 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-900 "
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
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500 ">
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
            <tbody className="divide-y divide-slate-100 ">
              {oturum.lines.map((s) => (
                <SatirGorunumu
                  key={s.id}
                  satir={s}
                  sayilabilir={sayilabilir}
                  kaydediliyor={say.isPending}
                  onAcikla={aciklamaYuzeyi.ac}
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
          <p className="px-6 py-8 text-center text-sm text-slate-500 ">
            Oturumda henüz ürün yok. Yukarıdan ürün numarası ekleyin.
          </p>
        )}
      </section>

      <UygulaPenceresi
        yuzey={uygulaYuzeyi}
        satirlar={oturum.lines}
        isPending={uygula.isPending}
        hata={uygulaHatasi}
        onConfirm={uygulaGonder}
      />

      <ReasonDialog
        open={iptalYuzeyi.acik}
        title="Sayım oturumunu iptal et"
        description="İptal geri alınamaz; oturum salt okunur olur ve hiçbir stok hareketi yazılmaz."
        label="İptal gerekçesi"
        required
        minLength={3}
        danger
        confirmLabel="Oturumu iptal et"
        isPending={iptal.isPending}
        onClose={iptalYuzeyi.kapat}
        onConfirm={(reason) =>
          iptal.mutate(reason, {
            onSuccess: () => {
              toast.success("Oturum iptal edildi.");
              iptalYuzeyi.kapat();
            },
            onError: (e) => toast.error(inventoryErrorMessage(e, "Oturum iptal edilemedi.")),
          })
        }
      />

      <ReasonDialog
        open={aciklamaYuzeyi.acik}
        title="Belirsizliği açıkla"
        description="Açıklama kayda geçer ama satırı UYGULANABİLİR YAPMAZ. Farkın uygulanabilmesi için satır yeniden sayılmalıdır."
        label="Açıklama"
        required
        minLength={3}
        confirmLabel="Açıklamayı kaydet"
        isPending={acikla.isPending}
        onClose={aciklamaYuzeyi.kapat}
        onConfirm={(note) =>
          acikla.mutate(
            { lineId: aciklamaYuzeyi.kayit!, note },
            {
              onSuccess: () => {
                toast.success("Açıklama kaydedildi. Satır hâlâ yeniden sayılmalı.");
                aciklamaYuzeyi.kapat();
              },
              onError: (e) => toast.error(inventoryErrorMessage(e, "Açıklama kaydedilemedi.")),
            }
          )
        }
      />
    </div>
  );
}

/* ── Ürün ekleme (satır içi form) ── */

/**
 * Oturuma ürün ekleme — İP-A7d3'te `Form.*`a geçti.
 *
 * Eskiden girdi bir `useState` idi ve "Ekle" düğmesi geçersiz girişte **hiçbir
 * şey yapmıyordu** (`if (!idler.length) return;`): operatör "12a" yazıp Ekle'ye
 * bastığında ekranda hiçbir şey olmuyordu ve neden olmadığını öğrenemiyordu.
 * Sessiz `return` bir doğrulama değil, gizlenmiş bir hatadır.
 */
const urunEklemeSemasi = z.object({
  idler: z
    .string()
    .refine((v) => v.trim() !== "", "Ürün numarası yazın.")
    .refine(
      (v) =>
        v
          .split(/[\s,]+/)
          .filter(Boolean)
          .every((p) => Number.isInteger(Number(p)) && Number(p) > 0),
      "Yalnız pozitif ürün numaraları yazın (ör. 12, 34)."
    ),
});

function UrunEklemeFormu({
  ekle,
}: {
  ekle: ReturnType<typeof useAddCountProducts>;
}) {
  const form = useForm<{ idler: string }>({
    resolver: zodResolver(urunEklemeSemasi),
    defaultValues: { idler: "" },
    mode: "onChange",
    shouldFocusError: false,
  });

  // Satır içi form: pencere yok, beyan zorunlu (İP-A7d2 · SK-3).
  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: ekle.error, pencereSiz: true });

  const gonder = form.handleSubmit(
    (deger) => {
      const idler = deger.idler
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      ekle.mutate(idler, {
        onSuccess: () => {
          form.reset({ idler: "" });
          toast.success("Ürünler oturuma eklendi.");
        },
        onError: (e) =>
          form.setError("idler", {
            type: "server",
            message: inventoryErrorMessage(e, "Ürün eklenemedi."),
          }),
      });
    },
    () => form.setFocus("idler")
  );

  return (
    <div className="mr-auto flex flex-wrap items-start gap-2">
      <Form.Field
        control={form.control}
        name="idler"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Ürün ekle</Form.Label>
            <Form.Control>
              <input className="input w-40" placeholder="12, 34" inputMode="numeric" {...field} />
            </Form.Control>
            <Form.ErrorMessage className="mt-1 max-w-56 text-xs text-rose-700 " />
          </Form.Item>
        )}
      />
      {/* Düğme geçerlilikle KAPANMAZ (kilitli karar). */}
      <Button size="sm" variant="secondary" className="mt-6" isPending={ekle.isPending} onClick={gonder}>
        Ekle
      </Button>
    </div>
  );
}
