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

import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Link, useParams } from "react-router-dom";

import { PackageLabelButton } from "@/components/admin/packing/PackageLabel";
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
    "border-emerald-200 bg-emerald-50 text-emerald-900 ",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 ",
  error:
    "border-rose-200 bg-rose-50 text-rose-900 ",
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
 * sunucu verir; buradaki liste yalnız sunucunun 409 döneceği butonu hiç
 * göstermemek içindir.
 */
const VAZGECILEBILIR: readonly string[] = ["OPEN", "PACKED", "RETURNED"];

/**
 * Vazgeçme yetkisi DURUMA BAĞLIDIR — ekran bunu birebir yansıtmalı.
 *
 * Backend'de iki kapı üst üstedir ve ikisi de geçilmelidir
 * (`api/routers/packing.py`):
 *
 * 1. Uç `Depends(PACK)` taşır → `packing.pack` HER hâlde gerekir.
 * 2. `OPEN` olmayan paketlerde ayrıca `_yonetim_izni_ara` çalışır →
 *    `packing.manage` de gerekir ("başka birinin kararını iptal etmek";
 *    görev ayrılığı, sözleşme §6).
 *
 * Yani `PACKED`/`RETURNED` bir paketi çözmek için **her iki izin** lazımdır.
 * Yalnız `packing.pack` verilmiş kullanıcıya kapalı pakette bu düğmeyi
 * göstermek, tıklandığında kesin 403 alacak bir iş vaat etmekti; yalnız
 * `packing.manage` verilmiş kullanıcıya göstermek de aynı şey (bu kez uç
 * bağımlılığından 403).
 */
function vazgecebilir(status: string, canPack: boolean, canManage: boolean): boolean {
  if (!VAZGECILEBILIR.includes(status)) return false;
  if (!canPack) return false;
  return status === "OPEN" || canManage;
}

interface Bildirim {
  tone: ScanTone;
  title: string;
  message: string;
}

/** `schemas.packing.REASON_MAX` — gerekçe/açıklama alanlarının gerçek tavanı. */
const GEREKCE_MAX = 200;

/* ════════════════════════ Ekran ════════════════════════ */

export default function PackingStationPage() {
  const { id } = useParams<{ id: string }>();
  const paketId = Number(id);
  const gecerliId = Number.isInteger(paketId) && paketId > 0;

  const { canView, canPack, canManage } = usePackingAccess();
  const query = usePackage(gecerliId ? paketId : null, canView);

  const scan = useScanPackageItem();
  const undo = useUndoPackageScan();
  const complete = useCompletePackage();
  const voidPackage = useVoidPackage();

  const [kod, setKod] = useState("");
  const [bildirim, setBildirim] = useState<Bildirim | null>(null);
  // ── İP-A7d3 · göç dalgası 3 ──
  //
  // Üç pencere durumu da ekranda yaşıyordu ve bu tabanın en yoğun kalemiydi
  // (`CountSessionDetailPage` ile birlikte 3'er bağ). Üçü de `useDuzenlemeYuzeyi`ye
  // taşındı: ekran artık "pencere açık mı" durumu TUTMAZ, bir yüzey açar.
  //
  // Yüzeylerin ayrı olması bilinçlidir: aynı anda yalnız biri açık olabilir ama
  // hedefleri farklı türdendir (satır / satır / paketin kendisi) ve tek bir
  // birleşik yüzey, hangi pencerenin hangi hedefe ait olduğunu tipten silerdi.
  const manuelYuzeyi = useDuzenlemeYuzeyi<PackageItem, void>();
  const geriAlYuzeyi = useDuzenlemeYuzeyi<PackageItem, void>();
  const vazgecYuzeyi = useDuzenlemeYuzeyi<never, void>();
  const manuelSatir = manuelYuzeyi.kayit;
  const geriAlSatir = geriAlYuzeyi.kayit;
  const [tamamlaHatasi, setTamamlaHatasi] = useState<string | null>(null);
  const kutuRef = useRef<HTMLInputElement>(null);

  /* ── İdempotency anahtarları: MANTIKSAL İŞLEM başına sabit ──
   *
   * Anahtar eskiden `mutate` çağrısının İÇİNDE üretiliyordu: ağ zaman aşımı ya
   * da kullanıcının ikinci denemesi YENİ bir anahtar doğuruyor, sunucu aynı işi
   * iki ayrı iş sanıyordu. Sonucu somut: aynı fiziksel kitap iki kez sayılır,
   * geri alma (durum-idempotan DEĞİL) adedi iki kez düşürür (sözleşme §7 S7).
   *
   * Desen `components/admin/inventory/DamageDialog.tsx` ve
   * `pages/admin/inventory/CountSessionDetailPage.tsx`'ten alındı: anahtar
   * `useRef`'te yaşar, tek gönderim niyeti boyunca DEĞİŞMEZ, işlem kesinleşince
   * yenilenir.
   *
   * Okutmada ek bir incelik var: anahtar **okutulan koda bağlanır**. Aynı kodu
   * yeniden denemek (ağ hatası sonrası) aynı işlemdir; BAŞKA bir kod okutmak
   * yeni bir işlemdir ve eski anahtarla gönderilseydi sunucu ilk taramanın
   * sonucunu tekrar oynatırdı (`replayed`) — operatör yanlış kitabı kutuya
   * koyar ve ekran "okutuldu" derdi.
   */
  const taramaAnahtariRef = useRef<{ kod: string; anahtar: string } | null>(null);
  const manuelAnahtarRef = useRef<{ satirId: number; anahtar: string } | null>(null);
  const geriAlAnahtarRef = useRef<{ satirId: number; anahtar: string } | null>(null);

  /** Bu koda ait anahtar; kod değiştiyse yeni işlem başlar. */
  const taramaAnahtari = (kod: string): string => {
    if (taramaAnahtariRef.current?.kod !== kod) {
      taramaAnahtariRef.current = { kod, anahtar: newIdempotencyKey() };
    }
    return taramaAnahtariRef.current.anahtar;
  };

  /**
   * Satır işlemlerinin (elle doğrulama / geri alma) anahtarı.
   *
   * Okutmadaki mantığın aynısı, kimlik alanı satır: aynı satırı yeniden denemek
   * aynı işlemdir, başka satıra geçmek yenisidir. Pencerenin kapanıp yeniden
   * açılması anahtarı YENİLEMEZ — yenileseydi ağ hatasından sonraki yeniden
   * deneme sunucuya ikinci bir iş gibi görünür ve geri alma (durum-idempotan
   * DEĞİL) adedi iki kez düşürürdü.
   */
  const satirAnahtari = (
    ref: typeof manuelAnahtarRef,
    satirId: number,
  ): string => {
    if (ref.current?.satirId !== satirId) {
      ref.current = { satirId, anahtar: newIdempotencyKey() };
    }
    return ref.current.anahtar;
  };

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
    // Enter'a basılı tutabilir.
    if (!deger || scan.isPending || !paket) return;
    scan.mutate(
      { packageId: paket.id, payload: { code: deger, idempotency_key: taramaAnahtari(deger) } },
      {
        onSuccess: (sonuc) => {
          // Sunucu yanıt verdi = işlem kesinleşti (red de bir sonuçtur ve ize
          // yazıldı). Sıradaki okutma YENİ bir iştir: aynı kitabın ikinci
          // kopyası da aynı barkodu taşır ve eski anahtarla gönderilseydi
          // sunucu ilk sonucu tekrar oynatır, ikinci kopya hiç sayılmazdı.
          taramaAnahtariRef.current = null;
          sonucuIsle(sonuc.result);
        },
        // Hata yolunda anahtar KORUNUR: kullanıcı aynı kodu yeniden gönderirse
        // sunucu bunu tek iş olarak görür.
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

  /* ── Tutarsızlık GİZLENMEZ ──
   *
   * `packageProgress.remaining` `Math.max(..., 0)` uygular, yani bir satırdaki
   * fazlalık başka bir satırın eksiğini maskeleyebilir: A'dan 0/2, B'den 3/1
   * okutulmuşsa toplam 3/3 çıkar ve "0 adet kaldı" yazılır — buton ise haklı
   * olarak kapalıdır. Operatör neden kapatamadığını görmeli.
   *
   * Saf kural katmanı (`lib/packing.ts`) başka bir ajanın alanı ve `remaining`
   * sözleşmesi sunucudaki sayılarla birebir kalsın diye orada DEĞİŞTİRİLMEDİ;
   * düzeltme sunum katmanında yapılır: eksik adet satır satır, tavanlanmadan
   * toplanır.
   */
  const eksikAdet = paket.items.reduce(
    (n, s) => n + Math.max(s.expected_qty - s.scanned_qty, 0),
    0,
  );
  const fazlaSatirlar = paket.items.filter((s) => s.scanned_qty > s.expected_qty);

  return (
    <div className="space-y-4">
      {/* ── Başlık: hangi kutu, hangi sipariş, hangi durum ── */}
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-4 ">
        <div className="mr-auto min-w-0">
          <p className="text-lg font-bold tracking-tight text-slate-900 ">
            {paket.code}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 ">
            Sipariş{" "}
            <Link
              to={`${ROUTES.adminPackingPackages}?siparis=${paket.order_id}`}
              className="font-semibold text-panel-accent hover:underline"
            >
              #{paket.order_id}
            </Link>{" "}
            · {paket.package_no}. paket
          </p>
        </div>
        <Badge tone={DURUM_TONU[paket.status] ?? "neutral"}>
          {PACKAGE_STATUS_LABEL[paket.status] ?? paket.status}
        </Badge>
        <span className="text-sm font-semibold tabular-nums text-slate-600 ">
          {ilerleme.scanned} / {ilerleme.expected} okutuldu
        </span>
        {/* Etiket yalnız kutu ELDE ve içeriği DOĞRULANMIŞken basılır
            (`canPrintLabel`); karar bileşenin kendisindedir ki istasyon ile
            paket listesi ayrışmasın. Basmak hiçbir yazma isteği atmaz. */}
        <PackageLabelButton
          packageId={paket.id}
          code={paket.code}
          status={paket.status}
        />
        {vazgecebilir(paket.status, canPack, canManage) && (
          <Button size="sm" variant="ghost" onClick={() => vazgecYuzeyi.yeniAc()}>
            Paketten vazgeç
          </Button>
        )}
      </section>

      {fazlaSatirlar.length > 0 && (
        // Fazla okutulmuş satır bir VERİ TUTARSIZLIĞIDIR: sunucu `OVER_QTY` ile
        // reddettiği hâlde adet beklenenin üstündeyse ya bayat bir yanıt
        // görüyoruz ya da kayıt bozulmuş. Ekran bunu gizlerse operatör kutuya
        // fazladan ürün koyup kapatır.
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-900 "
        >
          <p className="font-bold">Veri tutarsızlığı: beklenenden fazla okutulmuş satır var</p>
          <ul className="mt-1 list-disc pl-5">
            {fazlaSatirlar.map((s) => (
              <li key={s.order_item_id}>
                “{s.title}” — beklenen {s.expected_qty}, okutulan {s.scanned_qty}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Kutuya fazladan ürün koymayın. Sayfayı yenileyin; sayı değişmiyorsa
            fazlalığı gerekçeyle geri alın ve yöneticinize bildirin.
          </p>
        </div>
      )}

      {/* ── Okutma kutusu ── */}
      {acik && canPack && (
        <section className="rounded-2xl border border-slate-200 bg-white px-6 py-4 ">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              okut();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <label htmlFor="paketleme-kod" className="min-w-0 flex-1 basis-64">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 ">
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
      <section className="rounded-2xl border border-slate-200 bg-white ">
        <div className="border-b border-slate-100 px-6 py-3 ">
          <h2 className="text-sm font-bold text-slate-900 ">
            Kutuya girecek kalemler
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 ">
            Her satır ürünün kendi kodundan doğrulanır; kodu okunamayan satır
            gerekçeyle elle kapatılır ve gerekçe kayda geçer.
          </p>
        </div>
        <ul className="divide-y divide-slate-100 px-6 ">
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
                  <p className="text-sm font-medium text-slate-900 ">
                    {satir.title}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500 ">
                    {satir.sku ?? "SKU yok"}
                    {satir.barcode ? ` · ${satir.barcode}` : ""}
                  </p>
                </div>
                {/* Renk tek başına durum göstermez: sayı da, işaret de metin. */}
                <p className="shrink-0 text-sm tabular-nums">
                  <span
                    className={
                      tamam
                        ? "font-bold text-emerald-600 "
                        : "font-bold text-slate-900 "
                    }
                  >
                    {satir.scanned_qty}
                  </span>
                  {" / "}
                  <span className="text-slate-600 ">
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
                        onClick={() => geriAlYuzeyi.ac(satir)}
                      >
                        Geri al
                      </Button>
                    )}
                    {!tamam && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => manuelYuzeyi.ac(satir)}
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
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-4 ">
          <div className="mr-auto min-w-0">
            {/* Disabled buton sessiz kalmaz: operatör NEDEN kapatamadığını
                görmeli. Gerekçe tek cümledir — `completeBlockers` satır satır
                metin üretir ve her satırda ürün başlığını TEKRAR eder; başlıklar
                zaten hemen yukarıdaki listede ve her satırın "taranan /
                beklenen" sayısı görünür durumda. Engelin VARLIĞI için yine saf
                kural katmanı otoritedir (`engeller.length`), yalnız sunumu
                sadeleşir. */}
            {engeller.length === 0 ? (
              <p className="text-xs text-slate-500 ">
                Bütün kalemler doğrulandı. Kutuyu kapatıp etiketini yapıştırın.
              </p>
            ) : paket.items.length === 0 ? (
              <p className="text-xs leading-5 text-amber-700 ">
                {engeller[0]}
              </p>
            ) : (
              <p className="text-xs leading-5 text-amber-700 ">
                Paketi kapatmak için {eksikAdet} adet daha okutulmalı. Eksik
                satırlar listede “taranan / beklenen” sayısıyla görünür.
              </p>
            )}
          </div>
          <Button
            variant="success"
            disabled={engeller.length > 0}
            isPending={complete.isPending}
            onClick={() => {
              setTamamlaHatasi(null);
              complete.mutate(paket.id, {
                onSuccess: () => toast.success(`${paket.code} paketlendi.`),
                onError: (e) => {
                  // Toast geçicidir ve tam da en pahalı hatalarda kaybolur:
                  // 409 STALE (kalem listesi değişti) ile 409 eksik-kalem
                  // birbirinden yalnız METİNLE ayrılır. Sebep ekranda KALIR.
                  const mesaj = getErrorMessage(e, "Paket kapatılamadı.");
                  setTamamlaHatasi(mesaj);
                  toast.error(mesaj);
                },
              });
            }}
          >
            Paketi tamamla
          </Button>
          {tamamlaHatasi && (
            <div
              role="alert"
              className="w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 "
            >
              <p className="font-bold">Paket kapatılamadı</p>
              <p className="mt-0.5">{tamamlaHatasi}</p>
              <p className="mt-0.5 opacity-90">
                Kalem listesi değişmiş olabilir (sipariş güncellendi). Sayfayı
                yenileyip ekrandaki adetleri kutuyla yeniden karşılaştırın.
              </p>
            </div>
          )}
        </section>
      )}

      {!acik && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500 ">
          Bu paket “{PACKAGE_STATUS_LABEL[paket.status] ?? paket.status}” durumunda;
          okutma ve kapatma yalnız paketlenmekte olan pakette yapılır.
        </p>
      )}

      {/* ── Gerekçeli pencereler ── */}
      <ReasonDialog
        open={manuelYuzeyi.acik}
        title="Elle doğrula"
        description={
          manuelSatir
            ? `“${manuelSatir.title}” satırı koddan okutulmadan kapatılacak. Gerekçe kayda geçer.`
            : ""
        }
        label="Gerekçe"
        placeholder="Örn. ürün barkodu yırtılmış, rafta el yazısı etiket var"
        required
        maxLength={GEREKCE_MAX}
        cancelLabel="İptal"
        isPending={scan.isPending}
        onClose={manuelYuzeyi.kapat}
        onConfirm={(reason) => {
          if (!manuelSatir) return;
          scan.mutate(
            {
              packageId: paket.id,
              payload: {
                manual: true,
                manual_reason: reason,
                order_item_id: manuelSatir.order_item_id,
                idempotency_key: satirAnahtari(
                  manuelAnahtarRef,
                  manuelSatir.order_item_id,
                ),
              },
            },
            {
              onSuccess: (sonuc) => {
                manuelAnahtarRef.current = null;
                manuelYuzeyi.kapat();
                sonucuIsle(sonuc.result);
              },
              onError: (e) => {
                // Pencere KAPANIR ama anahtar korunur: kullanıcı aynı satırı
                // yeniden denerse (aynı gerekçeyle) sunucu tek iş görür.
                manuelYuzeyi.kapat();
                hataylaIsle(e, "Elle doğrulama gönderilemedi.");
              },
            },
          );
        }}
      />

      <ReasonDialog
        open={geriAlYuzeyi.acik}
        title="Okutmayı geri al"
        description={
          geriAlSatir
            ? `“${geriAlSatir.title}” satırından bir adet düşülecek. Gerekçe kayda geçer.`
            : ""
        }
        label="Gerekçe"
        placeholder="Örn. yanlış kutuya kondu, rafa geri götürüldü"
        required
        maxLength={GEREKCE_MAX}
        cancelLabel="İptal"
        isPending={undo.isPending}
        onClose={geriAlYuzeyi.kapat}
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
                idempotency_key: satirAnahtari(
                  geriAlAnahtarRef,
                  geriAlSatir.order_item_id,
                ),
              },
            },
            {
              onSuccess: () => {
                geriAlAnahtarRef.current = null;
                geriAlYuzeyi.kapat();
                toast.success("Okutma geri alındı.");
              },
              onError: (e) => {
                geriAlYuzeyi.kapat();
                toast.error(getErrorMessage(e, "Geri alınamadı."));
              },
            },
          );
        }}
      />

      <ReasonDialog
        open={vazgecYuzeyi.acik}
        title="Paketten vazgeç"
        description="Kutu bozulur, içerik rafa döner ve sipariş yeniden paketlenmeyi bekler. Gerekçe kayda geçer."
        label="Gerekçe"
        placeholder="Örn. sipariş iptal edildi, kutu hasar gördü"
        required
        danger
        maxLength={GEREKCE_MAX}
        confirmLabel="Vazgeç"
        // Onay düğmesinin adı da "Vazgeç" olduğu için iptal düğmesi "İptal"e
        // çekilir: aynı erişilebilir adı taşıyan iki düğme, ekran okuyucuda
        // hangisinin işlemi yaptığını ayırt edilemez hâle getiriyordu.
        cancelLabel="İptal"
        isPending={voidPackage.isPending}
        onClose={vazgecYuzeyi.kapat}
        onConfirm={(reason) =>
          voidPackage.mutate(
            { packageId: paket.id, reason },
            {
              onSuccess: () => {
                vazgecYuzeyi.kapat();
                toast.success(`${paket.code} paketinden vazgeçildi.`);
              },
              onError: (e) => {
                vazgecYuzeyi.kapat();
                toast.error(getErrorMessage(e, "Paketten vazgeçilemedi."));
              },
            },
          )
        }
      />
    </div>
  );
}
