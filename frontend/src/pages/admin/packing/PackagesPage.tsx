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
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";

import {
  PackageLabelButton,
  canPrintLabel,
} from "@/components/admin/packing/PackageLabel";
import { PackingLabelSheet } from "@/components/admin/packing/PackingLabelSheet";
import { DataTable } from "@/components/admin/data-table";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
} from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { usePackages, useRepackPackage, useUnpackPackage } from "@/hooks/usePacking";
import { formatDateTime } from "@/lib/datetime";
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

/**
 * Süzgecin kabul ettiği değerler — **kapalı küme**.
 *
 * Eskiden `hamDurum in PACKAGE_STATUS_LABEL` yazıyordu. `in` prototip zincirini
 * de kapsar: `?durum=toString`, `?durum=constructor`, `?durum=__proto__` hepsi
 * "geçerli" sayılıyor ve sunucuya `status=toString` olarak GİDİYORDU. Sonuç 422
 * ve sebebi görünmeyen boş bir ekrandı. `Set` prototip taşımaz; `Object.hasOwn`
 * ise ES2022'dir ve bu projenin hedefi ES2020.
 */
const GECERLI_DURUMLAR: ReadonlySet<string> = new Set<string>(
  Object.keys(PACKAGE_STATUS_LABEL),
);

/**
 * Satırın durumu için ANLAMLI olan tek zaman damgası.
 *
 * Hepsini birden basmak (açıldı + paketlendi + zimmetlendi + döndü) satırı
 * okunamaz hâle getirirdi; damgaların çoğu zaten `null`'dır. Gösterilen damga
 * "bu kutu en son ne zaman ne oldu" sorusunu cevaplar — kuyrukta unutulmuş
 * kutuyu görünür kılan da budur.
 */
function zamanDamgasi(paket: Package): string | null {
  const secim: { at: string | null; etiket: string } = (() => {
    switch (paket.status) {
      case "OPEN":
        return { at: paket.created_at, etiket: "açıldı" };
      case "PACKED":
        return { at: paket.packed_at, etiket: "paketlendi" };
      case "HANDED_OVER":
      case "RETURN_PENDING":
        return { at: paket.handed_over_at, etiket: "kuryeye verildi" };
      case "RETURNED":
        return { at: paket.returned_at, etiket: "depoya alındı" };
      case "DELIVERED":
        return { at: paket.delivered_at, etiket: "teslim edildi" };
      case "VOID":
        return { at: paket.unpacked_at ?? paket.void_at, etiket: paket.unpacked_at ? "bozuldu" : "vazgeçildi" };
      default:
        return { at: null, etiket: "" };
    }
  })();
  // Boş alan kalabalığı üretilmez: damga yoksa satırda hiçbir şey yazmaz.
  if (!secim.at) return null;
  return `${secim.etiket} · ${formatDateTime(secim.at)}`;
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
  const navigate = useNavigate();
  // Süzgeç + sayfa ortak katmanda (İP-A4 · Görev 3b): varsayılan adrese
  // yazılmaz, süzgeç değişince sayfa 1'e döner, geri tuşu çalışır.
  //
  // Adres adları KORUNDU (`durum`, `siparis`, `sayfa`): paylaşılmış eski
  // bağlantılar ve `DeliveryOrdersPage`ten gelen `?siparis=` kısayolu
  // çalışmaya devam etmeli.
  const url = useUrlDurumu(
    { durum: "", siparis: 0, sayfa: 1, boyut: LIMIT },
    { sayfaAnahtari: "sayfa", filtreDisi: ["sayfa", "boyut"] },
  );
  // Beyaz liste `useUrlDurumu`ya devredilemez: kanca tipi ve varsayılanı
  // yönetir, `?durum=drop_table` gibi bir değeri eleyemez.
  const hamDurum = url.degerler.durum;
  const durum =
    hamDurum && GECERLI_DURUMLAR.has(hamDurum) ? (hamDurum as PackageStatus) : undefined;
  const siparis = siparisNo(url.degerler.siparis ? String(url.degerler.siparis) : null);
  const sayfa = sayfaNo(String(url.degerler.sayfa));
  const boyut = url.degerler.boyut > 0 ? url.degerler.boyut : LIMIT;

  const query = usePackages(
    { status: durum, orderId: siparis, limit: boyut, offset: (sayfa - 1) * boyut },
    canView,
  );
  const repack = useRepackPackage();
  const unpack = useUnpackPackage();
  // Pencere durumu ekranda yaşamaz.
  const yenidenPaketle = useDuzenlemeYuzeyi<Package, void>();
  const bozulduDamgasi = useDuzenlemeYuzeyi<Package, void>();
  // Toplu etiket seçimi. Sayfa değişince ya da süzgeç yenilenince seçim
  // korunmaz (aşağıda temizlenir): görünmeyen bir satırın etiketini basmak,
  // operatörün elinde olmayan bir kutuya kâğıt üretmek demektir.
  const [secili, setSecili] = useState<number[]>([]);
  const etiketSayfasi = useDuzenlemeYuzeyi<never, void>();

  const paketler = query.data?.items ?? [];
  const toplam = query.data?.total ?? 0;

  // Etiket YALNIZ kutu elde ve içeriği doğrulanmışken basılır (`canPrintLabel`:
  // PACKED · RETURNED); seçim kutusu da yalnız o satırlarda çıkar.
  const basilabilirler = paketler.filter((p) => canPrintLabel(p.status));
  const seciliGorunen = secili.filter((id) => basilabilirler.some((p) => p.id === id));

  const secimDegistir = (id: number) =>
    setSecili((onceki) =>
      onceki.includes(id) ? onceki.filter((x) => x !== id) : [...onceki, id],
    );

  /** Satır aksiyonları — masaüstü hücresi ve mobil kart AYNI parçayı basar. */
  const satirAksiyonlari = (paket: Package) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Yeniden basım yan etkisizdir: paket durumu da QR token'ı da
          değişmez (`repack` sonrası eski etiket geçerli kalır). */}
      <PackageLabelButton
        packageId={paket.id}
        code={paket.code}
        status={paket.status}
        label="Etiket"
      />
      {canManage && paket.status === "RETURNED" && (
        <Button size="sm" variant="secondary" onClick={() => yenidenPaketle.ac(paket)}>
          Yeniden paketle
        </Button>
      )}
      {canManage && paket.status === "VOID" && !paket.unpacked_at && (
        <Button size="sm" variant="secondary" onClick={() => bozulduDamgasi.ac(paket)}>
          Bozuldu olarak işaretle
        </Button>
      )}
    </div>
  );

  const secimKutusu = (paket: Package) =>
    canPrintLabel(paket.status) ? (
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0"
        aria-label={`${paket.code} etiketini seç`}
        checked={secili.includes(paket.id)}
        onChange={() => secimDegistir(paket.id)}
      />
    ) : null;

  const kolonlar = useMemo<ColumnDef<Package, unknown>[]>(
    () => [
      {
        id: "secim",
        header: "",
        enableSorting: false,
        cell: ({ row }) => secimKutusu(row.original),
      },
      {
        accessorKey: "code",
        header: "Paket",
        enableSorting: false,
        cell: ({ row }) => {
          const damga = zamanDamgasi(row.original);
          return (
            <div className="min-w-0">
              <Link
                to={ROUTES.adminPackingPackage(row.original.id)}
                className="text-sm font-semibold text-panel-accent hover:underline"
              >
                {row.original.code}
              </Link>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Sipariş #{row.original.order_id}
                {(row.original.items?.length ?? 0) > 0 &&
                  ` · ${row.original.items.length} kalem`}
                {damga && ` · ${damga}`}
              </p>
            </div>
          );
        },
      },
      {
        id: "durum",
        header: "Durum",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge tone={DURUM_TONU[row.original.status] ?? "neutral"}>
            {satirEtiketi(row.original)}
          </Badge>
        ),
      },
      {
        id: "aksiyonlar",
        header: "İşlem",
        enableSorting: false,
        cell: ({ row }) => satirAksiyonlari(row.original),
      },
    ],
    // Aksiyonlar seçime, izne ve iki yüzeye bağlı; hepsi her render'da
    // yeniden kurulur, memo yalnız tabloya sabit kimlik vermek için.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage, secili, paketler],
  );

  /** Süzgeç değişince sayfa sıfırlaması artık kancanın işi. */
  const suzgecUygula = (yeni: PackageStatus | null) => {
    setSecili([]);
    url.ayarla({ durum: yeni ?? "" });
  };

  const sayfaGit = (yeni: number) => {
    setSecili([]);
    url.ayarla({ sayfa: yeni });
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
            onClick={() => url.ayarla({ siparis: 0 })}
            className="min-h-9 rounded-lg bg-panel-accent-soft px-3 text-xs font-semibold text-panel-accent transition hover:bg-panel-accent-soft/70"
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
      ) : (
        <>
          {basilabilirler.length > 0 && (
            // Vardiyada tek tek yazdırmak gerçekçi değil: kapanan kutuların
            // etiketleri tek sayfada basılır (A4, sayfa başına 8).
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3 dark:border-slate-800">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={seciliGorunen.length === basilabilirler.length}
                  onChange={(e) =>
                    setSecili(e.target.checked ? basilabilirler.map((p) => p.id) : [])
                  }
                />
                Bu sayfadaki basılabilir {basilabilirler.length} paketi seç
              </label>
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                disabled={seciliGorunen.length === 0}
                onClick={() => etiketSayfasi.yeniAc()}
              >
                Seçili {seciliGorunen.length} etiketi yazdır
              </Button>
            </div>
          )}
          <div className="px-6 pb-4">
            <DataTable
              columns={kolonlar}
              data={paketler}
              getRowId={(p) => String(p.id)}
              isLoading={query.isLoading}
              /* Boş durum İKİYE ayrıldı: "süzgeç eşleşmedi" bir düzeltme
                 talimatı, "hiç paket yok" bir durum bildirimidir. Eskiden
                 ikisi de "Bu süzgeçte paket yok" diyordu ve depoda hiç kutu
                 açılmamışken bile kullanıcıya var olmayan bir süzgeci
                 aratıyordu. */
              emptyTitle={url.filtreliMi ? "Bu süzgeçte paket yok" : "Henüz paket açılmadı"}
              emptyDescription={
                url.filtreliMi
                  ? "Süzgeci genişletin ya da kuyruktan yeni bir paket açın."
                  : "Paketleme kuyruğundan ilk kutuyu açtığınızda burada listelenir."
              }
              emptyAction={
                url.filtreliMi ? (
                  <Button size="sm" variant="secondary" onClick={() => { setSecili([]); url.temizle(); }}>
                    Süzgeci temizle
                  </Button>
                ) : undefined
              }
              /* Satır tıklaması VE satır aksiyonu birlikte: SK-1'in korumasının
                 ilk gerçek ekranı (A7d1'de yalnız sentetik sondayla ölçülmüştü).
                 Kolondaki `<a>`, aksiyon `<button>`ları ve seçim `<input>`u —
                 üçü de satırı açmamalı. */
              onRowClick={(p) => navigate(ROUTES.adminPackingPackage(p.id))}
              satirAdi={(p) => `${p.code} — paket detayı`}
              renderMobileRow={(paket) => {
                const damga = zamanDamgasi(paket);
                return (
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                          {paket.code}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          Sipariş #{paket.order_id}
                          {damga && ` · ${damga}`}
                        </p>
                      </div>
                      <Badge tone={DURUM_TONU[paket.status] ?? "neutral"}>
                        {satirEtiketi(paket)}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {secimKutusu(paket)}
                      {satirAksiyonlari(paket)}
                    </div>
                  </div>
                );
              }}
              page={sayfa}
              pageSize={boyut}
              total={toplam}
              onPageChange={sayfaGit}
              onPageSizeChange={(yeni) => {
                setSecili([]);
                url.ayarla({ boyut: yeni, sayfa: 1 });
              }}
            />
          </div>
        </>
      )}

      {etiketSayfasi.acik && (
        <PackingLabelSheet packageIds={seciliGorunen} onClose={etiketSayfasi.kapat} />
      )}

      <ConfirmDialog
        open={yenidenPaketle.acik}
        title="Yeniden dağıtıma ver"
        description={
          yenidenPaketle.kayit
            ? `${yenidenPaketle.kayit.code} yeniden dağıtıma girer. Kutunun üstündeki etiket GEÇERLİ kalır; yeni etiket basmayın.`
            : ""
        }
        confirmLabel="Yeniden paketle"
        cancelLabel="İptal"
        isPending={repack.isPending}
        onClose={yenidenPaketle.kapat}
        onConfirm={() => {
          const hedef = yenidenPaketle.kayit;
          if (!hedef) return;
          repack.mutate(hedef.id, {
            onSuccess: () => {
              yenidenPaketle.kapat();
              toast.success("Paket yeniden dağıtıma hazır.");
            },
            onError: (e) => {
              yenidenPaketle.kapat();
              toast.error(getErrorMessage(e, "Paket yeniden dağıtıma verilemedi."));
            },
          });
        }}
      />

      <ConfirmDialog
        open={bozulduDamgasi.acik}
        title="Kutu bozuldu mu?"
        description={
          bozulduDamgasi.kayit
            ? `${bozulduDamgasi.kayit.code} kutusunun fiziksel olarak açıldığını ve içeriğin rafa geri konduğunu işaretleyeceksiniz. Bu damga stok hareketi YAZMAZ; sayım envanterden yapılır.`
            : ""
        }
        confirmLabel="Bozuldu"
        cancelLabel="İptal"
        isPending={unpack.isPending}
        onClose={bozulduDamgasi.kapat}
        onConfirm={() => {
          const hedef = bozulduDamgasi.kayit;
          if (!hedef) return;
          unpack.mutate(hedef.id, {
            onSuccess: () => {
              bozulduDamgasi.kapat();
              toast.success("Kutu bozuldu olarak işaretlendi.");
            },
            onError: (e) => {
              bozulduDamgasi.kapat();
              toast.error(getErrorMessage(e, "İşaretlenemedi."));
            },
          });
        }}
      />
    </section>
  );
}
