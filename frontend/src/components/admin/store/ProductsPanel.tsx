/**
 * Mağaza "Ürünler" sekmesi — İP-A5'te `AdminStore.tsx`ten AYNEN taşındı.
 *
 * Panel KENDİ durumunu taşır (arama taslağı, form/içe-aktarma görünürlüğü);
 * diğer sekmelerle paylaştığı hiçbir React durumu yoktur — ortak zemin URL
 * (`useSearchParams`) ve React Query önbelleğidir. Bölme bu yüzden prop
 * geçirmeden yapılabildi.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, ConfirmDialog, ErrorState } from "@/components/admin/ui";
import { DataTable } from "@/components/admin/data-table";
import { StockBadge } from "@/components/admin/StockBadge";
import { deleteProduct, updateProduct, uploadProductCover } from "@/api/store";
import {
  useAdminProducts,
  useBookFacets,
  useInvalidateAdminStore,
  useStoreConfig,
} from "@/hooks/useStore";
import { setQueryValue } from "@/lib/adminUserQuery";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import {
  filtreVarMi,
  parseUrunSorgusu,
  urunSorgusundanIstek,
  type UrunSorguDurumu,
} from "@/lib/storeProductQuery";
import { toast } from "@/store/toastStore";
import type { ProductSearchOut } from "@/types";

import { BulkImportPanel } from "./BulkImportPanel";
import { EditProductModal } from "./EditProductModal";
import { ProductForm } from "./ProductForm";

export function ProductsPanel() {
  const { canView, canManage } = useAdminAreaAccess("products");
  const [params, setParams] = useSearchParams();
  const durum = parseUrunSorgusu(params);
  const { data, isLoading, isError, error, refetch } = useAdminProducts(
    urunSorgusundanIstek(durum)
  );
  const config = useStoreConfig();
  const invalidate = useInvalidateAdminStore();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Arama kutusu yerel state tutar ve gecikmeli olarak URL'e yazar: her tuş
  // vuruşunda URL'i (ve dolayısıyla isteği) tazelemek hem gereksiz istek
  // üretir hem de geri tuşunu kullanılamaz hâle getirir.
  const [aramaTaslak, setAramaTaslak] = useState(durum.q);
  const urlQ = durum.q;
  useEffect(() => setAramaTaslak(urlQ), [urlQ]);
  useEffect(() => {
    if (aramaTaslak === urlQ) return;
    const zamanlayici = setTimeout(() => {
      setParams(
        (onceki) => {
          const sonraki = new URLSearchParams(onceki);
          if (aramaTaslak) sonraki.set("q", aramaTaslak);
          else sonraki.delete("q");
          // Arama daraldığında eski sayfa numarası geçersizdir: 4. sayfadayken
          // arama yapıp boş sonuç görmek, "kayıt yok" sanılan bir ekran üretir.
          sonraki.delete("sayfa");
          return sonraki;
        },
        { replace: true }
      );
    }, 300);
    return () => clearTimeout(zamanlayici);
  }, [aramaTaslak, urlQ, setParams]);

  function guncelle(degisiklikler: Record<string, string | number | undefined>) {
    setParams((onceki) => {
      const sonraki = setQueryValue(new URLSearchParams(onceki), degisiklikler);
      // Sayfa numarası filtre/sıralama değişiminde sıfırlanır (kendisi
      // değiştirilmiyorsa).
      if (!("sayfa" in degisiklikler)) sonraki.delete("sayfa");
      return sonraki;
    });
  }

  if (!canView) return <AccessDenied area="Ürünler" />;
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "Ürünler yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }

  const urunler = data?.items ?? [];
  const toplam = data?.total ?? -1;
  const filtreli = filtreVarMi(durum);
  const esik = config.data?.low_stock_threshold;

  const kolonlar: ColumnDef<ProductSearchOut, unknown>[] = [
    // `accessorFn` sıralama İÇİN gerekli: TanStack, veri erişimi olmayan
    // (yalnız `cell` taşıyan) kolonları "display" sayar ve `getCanSort()`
    // false döndürür — başlık düğmeye dönüşmez. Sıralamanın kendisi sunucuda
    // yapılır (`manualSorting`), erişim yalnız kolonu sıralanabilir kılar.
    {
      id: "title",
      accessorFn: (p) => p.title,
      header: "Başlık",
      enableSorting: true,
      cell: ({ row }) => <UrunHucresi product={row.original} />,
    },
    {
      id: "stock",
      accessorFn: (p) => p.stock ?? -1,
      header: "Stok",
      enableSorting: true,
      // Eşik bilinmiyorsa rozet "azalan" ayrımını yapmaz ama "Tükendi"yi
      // yine gösterir (bkz. StockBadge).
      cell: ({ row }) => <StockBadge stock={row.original.stock} threshold={esik} />,
    },
    {
      id: "price",
      accessorFn: (p) => p.price,
      header: "Fiyat",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{formatTL(row.original.price)}</span>
      ),
    },
    {
      id: "status",
      header: "Durum",
      cell: ({ row }) => <UrunDurumRozeti status={row.original.status} />,
    },
    {
      id: "created_at",
      accessorFn: (p) => p.id,
      header: "Eklenme",
      enableSorting: true,
      // Değer gösterilmez, kolon yalnız "Eklenme sırasına göre sırala"
      // düğmesini taşır: tarihin kendisi listede bir karar girdisi değil,
      // sırası öyle.
      cell: () => null,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <UrunAksiyonlari
          product={row.original}
          canManage={canManage}
          onChange={invalidate}
        />
      ),
    },
  ];

  return (
    <div>
      {canManage ? (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowImport((v) => !v)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            {showImport ? "Kapat" : "Toplu içe aktar"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
          >
            {showForm ? "Kapat" : "Yeni ürün"}
          </button>
        </div>
      ) : (
        <ReadOnlyNotice />
      )}
      {canManage && showImport && <BulkImportPanel onDone={invalidate} />}
      {showForm && (
        <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <ProductForm
            mode="create"
            onDone={() => {
              setShowForm(false);
              invalidate();
            }}
          />
        </div>
      )}

      <UrunFiltreCubugu
        durum={durum}
        aramaTaslak={aramaTaslak}
        onArama={setAramaTaslak}
        onDegis={guncelle}
      />

      <div className="mt-4">
        <DataTable
          columns={kolonlar}
          data={urunler}
          getRowId={(p) => String(p.id)}
          isLoading={isLoading}
          sorting={[{ id: durum.sort, desc: durum.order === "desc" }]}
          onSortingChange={(guncelleyici) => {
            const sonraki =
              typeof guncelleyici === "function"
                ? guncelleyici([{ id: durum.sort, desc: durum.order === "desc" }])
                : guncelleyici;
            const ilk = sonraki[0];
            if (!ilk) return;
            guncelle({ sirala: ilk.id, yon: ilk.desc ? "desc" : "asc" });
          }}
          page={durum.page}
          pageSize={durum.pageSize}
          total={toplam < 0 ? urunler.length : toplam}
          onPageChange={(sayfa) => guncelle({ sayfa })}
          onPageSizeChange={(boyut) => guncelle({ limit: boyut, sayfa: 1 })}
          emptyTitle={filtreli ? "Sonuç bulunamadı" : "Henüz ürün eklenmemiş"}
          emptyDescription={
            filtreli
              ? "Arama veya filtreleri değiştirmeyi deneyin."
              : "İlk ürünü ekleyerek kataloğu oluşturmaya başlayın."
          }
          emptyAction={
            filtreli ? (
              <Button size="sm" variant="secondary" onClick={() => setParams({})}>
                Filtreleri temizle
              </Button>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

/** Filtre çubuğu — arama + stok + yayınevi/yazar. Tablonun ÜSTÜNDE, tek şerit. */
function UrunFiltreCubugu({
  durum,
  aramaTaslak,
  onArama,
  onDegis,
}: {
  durum: UrunSorguDurumu;
  aramaTaslak: string;
  onArama: (deger: string) => void;
  onDegis: (degisiklikler: Record<string, string | number | undefined>) => void;
}) {
  const facets = useBookFacets();
  const yayinevleri = facets.data?.publisher ?? [];
  const yazarlar = facets.data?.author ?? [];

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="flex-1 min-w-56 text-xs font-medium text-slate-500 dark:text-slate-400">
        Ürün ara
        <input
          type="search"
          value={aramaTaslak}
          onChange={(e) => onArama(e.target.value)}
          placeholder="Başlık, yazar, yayınevi, ISBN veya SKU"
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
      </label>

      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
        Stok durumu
        <select
          value={durum.stok ?? ""}
          onChange={(e) => onDegis({ stok: e.target.value || undefined })}
          className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="">Tümü</option>
          <option value="tukendi">Tükendi</option>
          <option value="azalan">Azalan</option>
          <option value="kritik">Tükendi + azalan</option>
          <option value="var">Stokta</option>
        </select>
      </label>

      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
        Yayınevi
        <select
          value={durum.yayinevi}
          onChange={(e) => onDegis({ yayinevi: e.target.value || undefined })}
          className="mt-1 block max-w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="">Tümü</option>
          {yayinevleri.map((f) => (
            <option key={f.value} value={f.value}>
              {f.value} ({f.count})
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
        Yazar
        <select
          value={durum.yazar}
          onChange={(e) => onDegis({ yazar: e.target.value || undefined })}
          className="mt-1 block max-w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="">Tümü</option>
          {yazarlar.map((f) => (
            <option key={f.value} value={f.value}>
              {f.value} ({f.count})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Birincil hücre: görsel + başlık + künye satırı (yazar · yayınevi · ISBN). */
function UrunHucresi({ product }: { product: ProductSearchOut }) {
  const kunye = [product.author, product.publisher, product.isbn].filter(Boolean);
  return (
    <div className="flex items-center gap-3">
      <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
        {product.cover_url && (
          <img src={product.cover_url} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
          {product.title}
        </p>
        {kunye.length > 0 && (
          <p className="truncate text-xs text-slate-500">{kunye.join(" · ")}</p>
        )}
      </div>
    </div>
  );
}

const URUN_DURUM_ETIKETI: Record<string, { label: string; tone: "success" | "neutral" | "warning" }> = {
  ACTIVE: { label: "Yayında", tone: "success" },
  HIDDEN: { label: "Gizli", tone: "neutral" },
  DRAFT: { label: "Taslak", tone: "warning" },
};

function UrunDurumRozeti({ status }: { status?: string | null }) {
  if (!status) return null;
  const esleme = URUN_DURUM_ETIKETI[status];
  // Bilinmeyen durum HAM basılır: sessizce gizlemek, yeni bir durum eklendiğinde
  // ekranın boş hücre göstermesine yol açardı.
  return <Badge tone={esleme?.tone ?? "neutral"}>{esleme?.label ?? status}</Badge>;
}

/** Satır aksiyonları — kart düzeninden tablo hücresine taşındı.
 *
 *  Yıkıcı aksiyonların sözleşmesi DEĞİŞMEDİ: "Sil" tek başına DELETE
 *  göndermez, önce `ConfirmDialog` açılır (P1-5). Taşınan yalnız yerleşim.
 */
function UrunAksiyonlari({
  product,
  canManage,
  onChange,
}: {
  product: ProductSearchOut;
  canManage: boolean;
  onChange: () => void;
}) {
  const cover = useMutation({
    mutationFn: (file: File) => uploadProductCover(product.id, file),
    onSuccess: () => {
      toast.success("Kapak güncellendi");
      onChange();
    },
  });
  const toggle = useMutation({
    mutationFn: () =>
      updateProduct(product.id, {
        status: product.status === "ACTIVE" ? "HIDDEN" : "ACTIVE",
      }),
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: () => deleteProduct(product.id),
    onSuccess: () => {
      toast.success("Ürün silindi");
      setDeleting(false);
      onChange();
    },
    // P1-5 sınıfı: sessiz başarısızlık yönetici için "silindi" ile aynı görünür.
    onError: (err: unknown) => toast.error(getErrorDetail(err, "Ürün silinemedi")),
  });
  const [editing, setEditing] = useState(false);
  // Yıkıcı aksiyon ONAY penceresi olmadan tetiklenmez: katalogdan ürün
  // düşürmek yanlış satıra tıklamayla geri alınamaz bir sonuç üretir.
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {canManage ? (
        <div className="flex items-center justify-end gap-3 whitespace-nowrap text-xs">
          <label className="cursor-pointer font-medium text-slate-600 hover:underline dark:text-slate-300">
            Kapak
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && cover.mutate(e.target.files[0])} />
          </label>
          <button type="button" onClick={() => setEditing(true)} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Düzenle
          </button>
          <button type="button" onClick={() => toggle.mutate()} className="font-medium text-slate-600 hover:underline dark:text-slate-300">
            {product.status === "ACTIVE" ? "Gizle" : "Yayınla"}
          </button>
          <button type="button" onClick={() => setDeleting(true)} className="font-medium text-rose-500 hover:underline">
            Sil
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleting}
        title="Ürünü sil"
        description={`"${product.title}" katalogdan kaldırılacak.`}
        confirmLabel="Ürünü sil"
        danger
        isPending={remove.isPending}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />

      {editing && (
        <EditProductModal
          id={product.id}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChange();
          }}
        />
      )}
    </>
  );
}
