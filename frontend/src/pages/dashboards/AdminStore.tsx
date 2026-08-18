import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, ConfirmDialog, ErrorState, ReasonDialog } from "@/components/admin/ui";
import { DataTable } from "@/components/admin/data-table";
import { StockBadge } from "@/components/admin/StockBadge";
import { setQueryValue } from "@/lib/adminUserQuery";
import {
  filtreVarMi,
  parseUrunSorgusu,
  urunSorgusundanIstek,
  type UrunSorguDurumu,
} from "@/lib/storeProductQuery";
import { adminAreaAccess } from "@/lib/adminAccess";
import { useAuthStore } from "@/store/authStore";
import { formatTL } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { orderPaymentLabel } from "@/lib/orderPayment";
import {
  ORDER_STATUS_FILTERS,
  orderPaymentTone,
  orderStatusLabel,
  orderStatusTone,
} from "@/lib/orderStatus";
import { ROUTES } from "@/lib/routes";
import { StockLedgerPanel } from "@/components/admin/StockLedgerPanel";
import {
  ADMIN_REASON_OPTIONS,
  requiresNote,
  validateStockEdit,
  type AdminReasonCode,
} from "@/lib/stockMovements";
import { StockMovementsPanel } from "@/components/admin/StockMovementsPanel";
import { orandanYuzde, yuzdedenOran } from "@/lib/tax";
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  deliverOrder,
  refundOrder,
  shipOrder,
  updateCategory,
  updateProduct,
  uploadProductCover,
} from "@/api/store";
import {
  useAdminOrders,
  useAdminProduct,
  useAdminProducts,
  useAdminReturns,
  useBookFacets,
  useStoreConfig,
  useBulkImportProducts,
  useCategories,
  useCoupons,
  useCreateCoupon,
  useCreateVariantGroup,
  useDeleteCoupon,
  useDeriveVariant,
  useInvalidateAdminStore,
  useResolveReturn,
  useUpdateCoupon,
  useVariantConfig,
  useVariantGroup,
  useVariantGroups,
} from "@/hooks/useStore";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { digitalProductsOpen } from "@/lib/paymentAvailability";
import { isBookCategory, suggestedVariantTitle } from "@/lib/variants";
import { getErrorDetail } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type {
  BulkImportResult,
  CouponCreate,
  CouponDiscountType,
  OrderOut,
  ProductDetailOut,
  ProductKind,
  ProductSearchOut,
} from "@/types";

type SubTab =
  | "products"
  | "categories"
  | "orders"
  | "returns"
  | "coupons"
  | "stock";

/** Form alanı üstündeki küçük başlık (select'lerde placeholder yoktur). */
const ALAN_BASLIGI = "text-[11px] font-medium text-slate-500 dark:text-slate-400";

const STORE_ROUTES: Record<SubTab, string> = {
  products: ROUTES.adminStoreProducts,
  categories: ROUTES.adminStoreCategories,
  orders: ROUTES.adminStoreOrders,
  returns: ROUTES.adminStoreReturns,
  coupons: ROUTES.adminStoreCoupons,
  stock: ROUTES.adminStoreStock,
};

// Sekme → backend izin alanı (kategoriler backend'de products.manage kapsamında).
const TAB_AREA: Record<SubTab, string> = {
  products: "products",
  categories: "products",
  orders: "orders",
  returns: "returns",
  coupons: "coupons",
  // Defter salt-okunur bir teşhis yüzeyi; ürün görüntüleme izniyle açılır.
  stock: "products",
};

export default function AdminStore() {
  const { pathname } = useLocation();
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  const sub =
    (Object.entries(STORE_ROUTES).find(([, route]) => pathname === route)?.[0] as
      | SubTab
      | undefined) ?? "products";
  if (!adminAreaAccess(permissions, ...Object.values(TAB_AREA)).canView) {
    return <AccessDenied area="Mağaza" />;
  }
  return (
    <div>
      <div className="mb-4 flex gap-2">
        {(
          [
            ["products", "Ürünler"],
            ["categories", "Kategoriler"],
            ["orders", "Siparişler"],
            ["returns", "İadeler"],
            ["coupons", "Kuponlar"],
            ["stock", "Stok hareketleri"],
          ] as [SubTab, string][]
        ).filter(([v]) => adminAreaAccess(permissions, TAB_AREA[v]).canView).map(([v, label]) => (
          <NavLink
            key={v}
            to={STORE_ROUTES[v]}
            aria-current={sub === v ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              sub === v
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {label}
          </NavLink>
        ))}
      </div>
      {sub === "products" ? (
        <ProductsPanel />
      ) : sub === "categories" ? (
        <CategoriesPanel />
      ) : sub === "orders" ? (
        <OrdersPanel />
      ) : sub === "returns" ? (
        <ReturnsPanel />
      ) : sub === "stock" ? (
        <StockMovementsPanel />
      ) : (
        <CouponsPanel />
      )}
    </div>
  );
}

/* ── Ürünler ── */

function ProductsPanel() {
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

// Ortak ürün formu — hem oluşturma hem düzenleme (künye dahil tüm alanlar).
function ProductForm({
  mode,
  initial,
  onDone,
}: {
  mode: "create" | "edit";
  initial?: ProductDetailOut;
  onDone: () => void;
}) {
  const isEdit = mode === "edit";
  const { data: categories } = useCategories();
  // Dijital ürün kapısı (İSTEMCİ AYNASI — otorite sunucudadır). Bilgi
  // yüklenmediyse/uç patladıysa FAIL-CLOSED: bkz. lib/paymentAvailability.
  const { data: odemeUygunlugu } = usePaymentAvailability();
  const dijitalAcik = digitalProductsOpen(odemeUygunlugu);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<ProductKind>((initial?.kind as ProductKind) ?? "PHYSICAL");
  const [price, setPrice] = useState(initial ? String(initial.price) : "");
  const [compareAt, setCompareAt] = useState(initial?.compare_at_price ? String(initial.compare_at_price) : "");
  // KDV: formda YUZDE tutulur, istekte ORAN gider (bkz. lib/tax.ts). Yeni
  // urunde bos baslar — varsayilan oran YOKTUR, karar veri olarak girilir.
  const [taxPercent, setTaxPercent] = useState(orandanYuzde(initial?.tax_rate));
  const [stock, setStock] = useState(initial?.stock != null ? String(initial.stock) : "");
  const [categoryId, setCategoryId] = useState(initial?.category_id != null ? String(initial.category_id) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "HIDDEN" | "DRAFT">(
    initial?.status === "HIDDEN" || initial?.status === "DRAFT" ? initial.status : "ACTIVE"
  );
  // Kitap künyesi (opsiyonel, katlanır; künye doluysa düzenlemede açık başlar).
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [publisher, setPublisher] = useState(initial?.publisher ?? "");
  const [isbn, setIsbn] = useState(initial?.isbn ?? "");
  const [pageCount, setPageCount] = useState(initial?.page_count != null ? String(initial.page_count) : "");
  const [dimensions, setDimensions] = useState(initial?.dimensions ?? "");
  const [pubYear, setPubYear] = useState(initial?.publication_year != null ? String(initial.publication_year) : "");
  const [edition, setEdition] = useState(initial?.edition ?? "");
  const [language, setLanguage] = useState(initial?.language ?? "");
  const [coverType, setCoverType] = useState(initial?.cover_type ?? "");
  // ── Kategori varsayılanından KDV ön-doldurma (Faz 4) ──
  // Yalnız form kolaylığı: sunucu kategori varsayılanından ASLA oran türetmez
  // (`tax_rate` üründe zorunlu veri). Kural: kullanıcının ELLE yazdığı değer
  // EZİLMEZ — alan boşken ya da hâlâ önceki OTOMATİK değerdeyken doldurulur.
  // Kategorilerin varsayılanı yoksa (bugünkü NULL dünyası) hiçbir şey yapmaz.
  const [autoTaxPercent, setAutoTaxPercent] = useState<string | null>(null);
  useEffect(() => {
    const secili = (categories ?? []).find((c) => c.id === Number(categoryId));
    const oneri = orandanYuzde(secili?.effective_tax_rate);
    if (!oneri) return;
    setTaxPercent((mevcut) => {
      if (mevcut !== "" && mevcut !== autoTaxPercent) return mevcut;
      setAutoTaxPercent(oneri);
      return oneri;
    });
    // autoTaxPercent bilinçli olarak bağımlılıkta DEĞİL: kendi güncellediği
    // değeri izleseydi döngü kurulurdu; karşılaştırma set callback'i içinde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, categories]);

  const hasKunye = !!(
    initial &&
    (initial.author || initial.publisher || initial.isbn || initial.page_count ||
      initial.dimensions || initial.publication_year || initial.edition ||
      initial.language || initial.cover_type)
  );
  const [showSpecs, setShowSpecs] = useState(hasKunye);
  // Varyant üyeliği (Faz 2). Sözlükler backend'den (variant-config) gelir.
  const [variantGroupId, setVariantGroupId] = useState<number | null>(
    initial?.variant_group_id ?? null
  );
  const [option1Value, setOption1Value] = useState(initial?.option1_value ?? "");
  const [option2Value, setOption2Value] = useState(initial?.option2_value ?? "");
  const [variantSort, setVariantSort] = useState(
    initial?.variant_sort != null ? String(initial.variant_sort) : "0"
  );
  const [barcode, setBarcode] = useState(initial?.barcode ?? "");
  const [showVariant, setShowVariant] = useState(initial?.variant_group_id != null);
  const { data: variantConfig } = useVariantConfig();
  // Kitap kategorisinde varyant kapalı (backend 409'unun aynası): bölüm
  // gizlenir, seçili grup varsa uyarıyla birlikte gösterilir (silinmez —
  // sessiz veri kaybı olmasın, admin kararı görerek versin).
  const kitapKategorisi = isBookCategory(
    categories ?? [],
    categoryId ? Number(categoryId) : null,
    variantConfig?.book_root_slugs ?? []
  );
  // Kitap kategorisi seçilince künye bölümü KENDİLİĞİNDEN açılır: kitapta
  // yazar/yayınevi/ISBN beklenen alanlardır, katlanmış bölüm onları görünmez
  // kılıyordu. Efekt yalnız AÇAR, asla kapatmaz ve `kitapKategorisi`
  // DEĞİŞTİĞİNDE çalışır — böylece kullanıcı bölümü elle kapattığında
  // (kategori aynı kaldığı sürece) onunla inatlaşmaz.
  useEffect(() => {
    if (kitapKategorisi) setShowSpecs(true);
  }, [kitapKategorisi]);
  // Stok gerekcesi: yalniz DUZENLEMEDE ve deger degistiginde zorunlu.
  // (Yeni urunde ilk stok `INITIAL` hareketidir; gerekcesi sabittir.)
  const [stockReason, setStockReason] = useState<AdminReasonCode | "">("");
  const [stockNote, setStockNote] = useState("");
  const stokDegisti =
    isEdit && kind === "PHYSICAL" && Number(stock || 0) !== Number(initial?.stock ?? 0);

  const mutation = useMutation({
    mutationFn: () => {
      // Oran once dogrulanir: gecersizse istek HIC gitmez. Sunucu da 422
      // doner (tek guvenlik siniri orasidir), ama kullanici hatayi formda
      // ve Turkce gormeli.
      const oran = yuzdedenOran(taxPercent);
      if (!oran.ok) throw new Error(oran.hata ?? "KDV oranı geçersiz");
      if (variantGroupId != null) {
        // Sunucu da 400/409 verir; ama admin hatayı formda Türkçe görmeli.
        if (!barcode.trim()) {
          throw new Error("Varyant grubundaki ürün için barkod zorunlu");
        }
        if (!option1Value.trim()) {
          throw new Error("1. eksen değeri zorunlu");
        }
        if (kitapKategorisi) {
          throw new Error("Kitap kategorisindeki üründe varyant açılamaz");
        }
      }
      const base = {
        title,
        price,
        tax_rate: oran.oran,
        compare_at_price: compareAt || null,
        stock: kind === "PHYSICAL" && stock ? Number(stock) : null,
        category_id: categoryId ? Number(categoryId) : null,
        description: description || null,
        author: author || null,
        publisher: publisher || null,
        isbn: isbn || null,
        page_count: pageCount ? Number(pageCount) : null,
        dimensions: dimensions || null,
        publication_year: pubYear ? Number(pubYear) : null,
        edition: edition || null,
        language: language || null,
        cover_type: coverType || null,
        // Varyant üyeliği: grup yoksa eksen değerleri de null gider (sunucu
        // gruptan çıkışta değerleri zaten temizler; form da tutarlı gönderir).
        variant_group_id: variantGroupId,
        option1_value: variantGroupId != null ? option1Value.trim() || null : null,
        option2_value: variantGroupId != null ? option2Value.trim() || null : null,
        variant_sort:
          variantGroupId != null ? parseInt(variantSort, 10) || 0 : 0,
        barcode: barcode.trim() || null,
      };
      if (isEdit) {
        // Delta SUNUCUDA, urun satiri kilitli iken hesaplanir; istemci yalniz
        // HEDEFI gonderir. Ayni hedefin tekrari sunucuda sifir delta uretir ve
        // hareket yazilmaz — bu yuzden gerekce de istenmez.
        const dogrulama = validateStockEdit({
          current: Number(initial?.stock ?? 0),
          next: Number(stock || 0),
          reason: (stockReason || null) as AdminReasonCode | null,
          note: stockNote || null,
        });
        if (kind === "PHYSICAL" && !dogrulama.ok) {
          throw new Error(dogrulama.error ?? "Stok düzenlemesi geçersiz");
        }
        return updateProduct(initial!.id, {
          ...base,
          status,
          ...(dogrulama.submitStock ? dogrulama.payload : { stock: undefined }),
        });
      }
      return createProduct({ ...base, kind, status });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Ürün güncellendi" : "Ürün eklendi");
      onDone();
    },
    onError: (err: unknown) => {
      const metin =
        err instanceof Error && err.message ? err.message : null;
      toast.error(metin ?? (isEdit ? "Ürün güncellenemedi" : "Ürün eklenemedi"));
    },
  });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ürün adı" className="input sm:col-span-2" />
      {/* Select'lerin placeholder'ı olmaz: ne sorulduğu GÖRÜNÜR bir başlıkla
          yazılır (metin alanlarında bu işi placeholder yapıyor). */}
      {isEdit ? (
        <label className="flex flex-col gap-1">
          <span className={ALAN_BASLIGI}>Durum</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "HIDDEN" | "DRAFT")} className="input">
            <option value="ACTIVE">Yayında</option>
            <option value="HIDDEN">Gizli</option>
            <option value="DRAFT">Taslak</option>
          </select>
        </label>
      ) : (
        // Açıklama `<label>` DIŞINDA: içeride kalsaydı select'in erişilebilir
        // adına eklenir ve alanın adı "Ürün türü Dijital ürün satışı kapalı…"
        // olurdu (ekran okuyucuda ve testte ölçüldü).
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span className={ALAN_BASLIGI}>Ürün türü</span>
            {/* "Basılı" DEĞİL: mağaza kitap dışı ürün de satar (kalem, defter,
                fotokopi kâğıdı). Değerler (PHYSICAL/DIGITAL) değişmedi —
                `kind` DB trigger'ıyla değiştirilemez, etiket ise serbesttir. */}
            <select value={kind} onChange={(e) => setKind(e.target.value as ProductKind)} className="input">
              <option value="PHYSICAL">Fiziksel ürün</option>
              {/* Bayrak kapalıyken seçilemez: kaydedilen dijital ürün satılamaz
                  (checkout 503) ve `kind` sonradan DEĞİŞTİRİLEMEZ. Sunucu da
                  reddeder — burası kullanıcıyı 503'e kadar yürütmemek için. */}
              <option value="DIGITAL" disabled={!dijitalAcik}>
                Dijital ürün
              </option>
            </select>
          </label>
          {!dijitalAcik && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Dijital ürün satışı kapalı olduğu için bu seçenek kullanılamıyor.
              Bayrak açılana dek yalnız fiziksel ürün eklenebilir.
            </span>
          )}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className={ALAN_BASLIGI}>Kategori (opsiyonel)</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Kategori" className="input">
          <option value="">Kategori seçilmedi</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Fiyat (TL)" inputMode="decimal" className="input" />
      <input value={compareAt} onChange={(e) => setCompareAt(e.target.value)} placeholder="Eski fiyat (opsiyonel)" inputMode="decimal" className="input" />
      <label className="flex flex-col gap-1">
        <input
          value={taxPercent}
          onChange={(e) => setTaxPercent(e.target.value)}
          placeholder="KDV oranı (%)"
          inputMode="decimal"
          aria-label="KDV oranı (%)"
          className="input"
        />
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Yüzde olarak yazın (ör. 20). Fiyat KDV dahildir; oran faturadaki
          matrah ayrıştırması için kullanılır.
        </span>
      </label>
      {kind === "PHYSICAL" && (
        <input value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Stok" inputMode="numeric" className="input" />
      )}
      {stokDegisti && (
        <div className="sm:col-span-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-xs text-amber-900 dark:text-amber-200">
            Stok {initial?.stock ?? 0} → {Number(stock || 0)} olarak
            değişecek. Bu hareket deftere gerekçesiyle yazılır.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={stockReason}
              onChange={(e) => setStockReason(e.target.value as AdminReasonCode | "")}
              className="input"
            >
              <option value="">Gerekçe seçin…</option>
              {ADMIN_REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {requiresNote((stockReason || null) as AdminReasonCode | null) && (
              <input
                value={stockNote}
                onChange={(e) => setStockNote(e.target.value)}
                placeholder="Açıklama (zorunlu)"
                className="input"
              />
            )}
          </div>
        </div>
      )}
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Açıklama" rows={2} className="input sm:col-span-2" />

      {/* Kitap künyesi — opsiyonel, katlanır. Kitap kategorisi seçiliyse
          kendiliğinden açılır (yukarıdaki efekt); kitap dışı üründe kapalı
          kalır ve başlık ne yapılması gerektiğini söyler. */}
      <div className="sm:col-span-2">
        <button
          type="button"
          onClick={() => setShowSpecs((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${showSpecs ? "rotate-90" : ""}`}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          Kitap künyesi — kitap dışı ürünlerde boş bırakın
        </button>
        {showSpecs && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <p className="text-[11px] text-slate-400 sm:col-span-2 dark:text-slate-500">
              Ebat dışındaki alanlar yalnız kitapta anlamlıdır; kırtasiye
              ürününde ebadı yazıp diğerlerini boş bırakabilirsiniz.
            </p>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Yazar" className="input" />
            <input value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="Yayınevi" className="input" />
            <input value={isbn} onChange={(e) => setIsbn(e.target.value)} placeholder="ISBN / Barkod" className="input" />
            <input value={pageCount} onChange={(e) => setPageCount(e.target.value)} placeholder="Sayfa sayısı" inputMode="numeric" className="input" />
            <input value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder="Ebat (ör. 20 x 27 cm · A4)" className="input" />
            <input value={pubYear} onChange={(e) => setPubYear(e.target.value)} placeholder="Basım yılı" inputMode="numeric" className="input" />
            <input value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="Baskı (ör. 1. Basım)" className="input" />
            <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Dil (ör. Türkçe)" className="input" />
            <input value={coverType} onChange={(e) => setCoverType(e.target.value)} placeholder="Kapak tipi (ör. İnce Kapak)" className="input" />
          </div>
        )}
      </div>

      {/* Varyant üyeliği — kitap kategorisinde kapalı (backend 409'unun aynası) */}
      <div className="sm:col-span-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        {kitapKategorisi ? (
          variantGroupId != null ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Bu ürün bir varyant grubunda ama seçilen kategori kitap
                kategorisi — kitapta varyant açılamaz. Kaydetmeden önce grubu
                kaldırın ya da kategoriyi değiştirin.
              </p>
              <button
                type="button"
                onClick={() => {
                  setVariantGroupId(null);
                  setOption1Value("");
                  setOption2Value("");
                }}
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Gruptan çıkar
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Kitap kategorisinde varyant açılamaz — farklı baskı/cilt ayrı
              ISBN'li ayrı bir üründür.
            </p>
          )
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowVariant((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${showVariant ? "rotate-90" : ""}`}>
                <path d="M9 18l6-6-6-6" />
              </svg>
              Varyantlar (renk, ebat…)
              {variantGroupId != null && (
                <span className="text-xs font-normal text-slate-400">— grupta</span>
              )}
            </button>
            {showVariant && (
              <VariantMembershipFields
                groupId={variantGroupId}
                onGroupChange={(id) => {
                  setVariantGroupId(id);
                  if (id == null) {
                    setOption1Value("");
                    setOption2Value("");
                  }
                }}
                option1Value={option1Value}
                option2Value={option2Value}
                onOption1Change={setOption1Value}
                onOption2Change={setOption2Value}
                variantSort={variantSort}
                onVariantSortChange={setVariantSort}
                barcode={barcode}
                onBarcodeChange={setBarcode}
                currentProductId={initial?.id}
              />
            )}
          </>
        )}
      </div>

      <button
        type="button"
        disabled={mutation.isPending || !title || !price || !taxPercent}
        onClick={() => mutation.mutate()}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900 sm:col-span-2"
      >
        {isEdit ? "Kaydet" : "Ürünü ekle"}
      </button>
    </div>
  );
}

/** Ürün formunun varyant bölümü: grup seç/oluştur + eksen değerleri +
 *  kardeş listesi + (kayıtlı üründe) "varyant türet".
 *
 *  Eksen ADLARI yalnız sözlükten seçilir (backend `variant-config`); eksen
 *  DEĞERLERİ serbest metindir. Kardeşler saç-teli çizgili satır listesidir —
 *  kart değil (calm layout).
 */
function VariantMembershipFields({
  groupId,
  onGroupChange,
  option1Value,
  option2Value,
  onOption1Change,
  onOption2Change,
  variantSort,
  onVariantSortChange,
  barcode,
  onBarcodeChange,
  currentProductId,
}: {
  groupId: number | null;
  onGroupChange: (id: number | null) => void;
  option1Value: string;
  option2Value: string;
  onOption1Change: (v: string) => void;
  onOption2Change: (v: string) => void;
  variantSort: string;
  onVariantSortChange: (v: string) => void;
  barcode: string;
  onBarcodeChange: (v: string) => void;
  currentProductId?: number;
}) {
  const { data: config } = useVariantConfig();
  const { data: groups } = useVariantGroups();
  const { data: groupDetail } = useVariantGroup(groupId);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAxis1, setNewAxis1] = useState("");
  const [newAxis2, setNewAxis2] = useState("");
  const createGroup = useCreateVariantGroup();

  const group = groups?.find((g) => g.id === groupId) ?? groupDetail ?? null;
  const axes = config?.axes ?? [];

  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          value={groupId != null ? String(groupId) : ""}
          onChange={(e) => {
            if (e.target.value === "__yeni__") {
              setCreating(true);
              return;
            }
            setCreating(false);
            onGroupChange(e.target.value ? Number(e.target.value) : null);
          }}
          aria-label="Varyant grubu"
          className="input"
        >
          <option value="">Varyant grubu yok</option>
          {(groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.title} ({g.option1_name}
              {g.option2_name ? ` × ${g.option2_name}` : ""}, {g.member_count} ürün)
            </option>
          ))}
          <option value="__yeni__">＋ Yeni grup oluştur…</option>
        </select>
        {group && (
          <input
            value={barcode}
            onChange={(e) => onBarcodeChange(e.target.value)}
            placeholder="Barkod (zorunlu — raftaki ayırt edici)"
            aria-label="Barkod"
            className="input"
          />
        )}
      </div>

      {creating && (
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Grup adı (ör. Fosforlu Kalem)"
            className="input sm:col-span-2"
          />
          <select value={newAxis1} onChange={(e) => setNewAxis1(e.target.value)} aria-label="1. eksen" className="input">
            <option value="">1. eksen…</option>
            {axes.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select value={newAxis2} onChange={(e) => setNewAxis2(e.target.value)} aria-label="2. eksen (opsiyonel)" className="input">
            <option value="">2. eksen yok</option>
            {axes
              .filter((a) => a !== newAxis1)
              .map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
          </select>
          <div className="sm:col-span-4 flex items-center gap-3">
            <Button
              size="sm"
              disabled={!newTitle.trim() || !newAxis1 || createGroup.isPending}
              onClick={() =>
                createGroup.mutate(
                  {
                    title: newTitle.trim(),
                    option1_name: newAxis1,
                    option2_name: newAxis2 || null,
                  },
                  {
                    onSuccess: (g) => {
                      toast.success("Varyant grubu oluşturuldu");
                      setCreating(false);
                      setNewTitle("");
                      onGroupChange(g.id);
                    },
                    onError: (err: unknown) =>
                      toast.error(getErrorDetail(err, "Grup oluşturulamadı")),
                  }
                )
              }
            >
              Grubu oluştur
            </Button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {group && (
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={option1Value}
            onChange={(e) => onOption1Change(e.target.value)}
            placeholder={`${group.option1_name} (ör. Sarı)`}
            aria-label={group.option1_name}
            className="input"
          />
          {group.option2_name && (
            <input
              value={option2Value}
              onChange={(e) => onOption2Change(e.target.value)}
              placeholder={`${group.option2_name}`}
              aria-label={group.option2_name}
              className="input"
            />
          )}
          <input
            value={variantSort}
            onChange={(e) => onVariantSortChange(e.target.value)}
            placeholder="Sıra (0, 1, 2…)"
            aria-label="Varyant sırası"
            inputMode="numeric"
            className="input"
          />
        </div>
      )}

      {groupDetail && groupDetail.members.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Gruptaki varyantlar
          </p>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-700/60">
            {groupDetail.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">
                  {[m.option1_value, m.option2_value].filter(Boolean).join(" / ")}
                  <span className="text-slate-400"> · {m.title}</span>
                  {m.id === currentProductId && (
                    <span className="ml-1.5 text-xs text-indigo-600 dark:text-indigo-400">(bu ürün)</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {formatTL(m.price)}
                  {m.stock != null && ` · stok ${m.stock}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {currentProductId != null &&
        groupId != null &&
        groupDetail?.members.some((m) => m.id === currentProductId) && (
          <DeriveVariantForm
            productId={currentProductId}
            group={groupDetail}
          />
        )}
    </div>
  );
}

/** "Bu üründen yeni varyant türet" — künye/fiyat/görsel kaynaktan kopyalanır. */
function DeriveVariantForm({
  productId,
  group,
}: {
  productId: number;
  group: NonNullable<ReturnType<typeof useVariantGroup>["data"]>;
}) {
  const [open, setOpen] = useState(false);
  const [value1, setValue1] = useState("");
  const [value2, setValue2] = useState("");
  const [newBarcode, setNewBarcode] = useState("");
  const derive = useDeriveVariant();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        ＋ Bu üründen yeni varyant türet
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Künye, fiyat ve görseller bu üründen kopyalanır; yeni varyant{" "}
        <b>taslak</b> olarak oluşur. Başlık önerisi:{" "}
        {value1 ? suggestedVariantTitle(group.title, value1, value2 || null) : "—"}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          value={value1}
          onChange={(e) => setValue1(e.target.value)}
          placeholder={group.option1_name}
          aria-label={`Yeni ${group.option1_name}`}
          className="input"
        />
        {group.option2_name && (
          <input
            value={value2}
            onChange={(e) => setValue2(e.target.value)}
            placeholder={group.option2_name}
            aria-label={`Yeni ${group.option2_name}`}
            className="input"
          />
        )}
        <input
          value={newBarcode}
          onChange={(e) => setNewBarcode(e.target.value)}
          placeholder="Yeni barkod (zorunlu)"
          aria-label="Yeni barkod"
          className="input"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={
            derive.isPending ||
            !value1.trim() ||
            !newBarcode.trim() ||
            (!!group.option2_name && !value2.trim())
          }
          onClick={() =>
            derive.mutate(
              {
                productId,
                payload: {
                  option1_value: value1.trim(),
                  option2_value: group.option2_name ? value2.trim() : null,
                  barcode: newBarcode.trim(),
                },
              },
              {
                onSuccess: (yeni) => {
                  toast.success(`Varyant türetildi: ${yeni.title} (taslak)`);
                  setOpen(false);
                  setValue1("");
                  setValue2("");
                  setNewBarcode("");
                },
                onError: (err: unknown) =>
                  toast.error(getErrorDetail(err, "Varyant türetilemedi")),
              }
            )
          }
        >
          Türet
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
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

function EditProductModal({
  id,
  onClose,
  onSaved,
}: {
  id: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, isLoading } = useAdminProduct(id);

  // Navbar backdrop-blur'ü position:fixed'i bozmasın diye body'ye portal.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Ürünü düzenle</h3>
          <button onClick={onClose} aria-label="Kapat" className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-300">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {isLoading || !data ? (
          <p className="py-8 text-center text-sm text-slate-400">Yükleniyor…</p>
        ) : (
          <>
            <ProductForm mode="edit" initial={data} onDone={onSaved} />
            <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-700">
              <StockLedgerPanel productId={data.id} kind={data.kind} />
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ── Toplu içe aktar (CSV) ── */

const CSV_COLUMNS =
  "title,kind,price,tax_rate,compare_at_price,stock,category_slug,status,cover_url,description,author,publisher,isbn,page_count,dimensions,publication_year,edition,language,cover_type";

function BulkImportPanel({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const importer = useBulkImportProducts();

  function downloadTemplate() {
    const sample =
      `${CSV_COLUMNS}
` +
      "AYT Matematik Soru Bankası,PHYSICAL,339,399,25,yks-kitaplari,ACTIVE,,Açıklama metni,Seyit Dönmez,Bilgi Sarmal Yayınları,9786258070187,416,19 x 27,2026,1. Basım,Türkçe,Karton Kapak";
    // BOM (﻿) → Excel Türkçe karakterleri doğru açar.
    const blob = new Blob([`﻿${sample}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "urun-sablonu.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function run() {
    if (!file) return;
    importer.mutate(file, {
      onSuccess: (r) => {
        setResult(r);
        toast.success(`${r.created} ürün eklendi${r.skipped ? `, ${r.skipped} atlandı` : ""}`);
        onDone();
      },
      onError: (err: unknown) => {
        const detail =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "İçe aktarma başarısız";
        toast.error(detail);
      },
    });
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700">
      <p className="text-slate-600 dark:text-slate-300">
        CSV ile toplu ürün ekle. İlk satır başlık olmalı; <b>title</b>, <b>price</b> ve{" "}
        <b>tax_rate</b> zorunlu. KDV oranını <b>oran</b> olarak yazın (0.20 = %20);
        oransız satırlar oluşturulmaz ve aşağıda tek tek raporlanır. Aynı ISBN varsa
        atlanır. Platform (fiziksel/dijital) ürünü oluşturur.
      </p>
      <button
        type="button"
        onClick={downloadTemplate}
        className="mt-2 font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        Şablon CSV indir
      </button>
      <p className="mt-2 break-words text-xs text-slate-400">Sütunlar: {CSV_COLUMNS}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
          }}
          className="text-sm text-slate-600 dark:text-slate-300"
        />
        <button
          type="button"
          disabled={!file || importer.isPending}
          onClick={run}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          {importer.isPending ? "İçe aktarılıyor…" : "İçe aktar"}
        </button>
      </div>

      {result && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
          <p className="font-medium text-slate-800 dark:text-slate-200">
            {result.created} eklendi · {result.skipped} atlandı · {result.errors.length} hata
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-rose-600 dark:text-rose-400">
              {result.errors.map((er) => (
                <li key={er.row}>
                  Satır {er.row}: {er.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Kategoriler ── */

function CategoriesPanel() {
  const { canView, canManage } = useAdminAreaAccess("products");
  const { data: categories, isError, error } = useCategories();
  const invalidate = useInvalidateAdminStore();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => createCategory({ name }),
    onSuccess: () => {
      toast.success("Kategori eklendi");
      setName("");
      invalidate();
    },
  });
  const [deleting, setDeleting] = useState<{ id: number; name: string } | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => {
      toast.success("Kategori silindi");
      setDeleting(null);
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorDetail(err, "Kategori silinemedi")),
  });

  if (!canView) return <AccessDenied area="Kategoriler" />;
  if (isError) {
    return <ErrorState description={getErrorDetail(error, "Kategoriler yüklenemedi.")} />;
  }

  return (
    <div>
      {canManage ? (
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kategori adı" className="input flex-1" />
          <button
            type="button"
            disabled={!name || create.isPending}
            onClick={() => create.mutate()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            Ekle
          </button>
        </div>
      ) : (
        <ReadOnlyNotice />
      )}
      <div className="mt-4 space-y-2">
        {(categories ?? []).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {c.name} <span className="text-slate-400">({c.product_count ?? 0})</span>
            </span>
            <span className="flex items-center gap-3">
              <KategoriKdvRozeti category={c} canManage={canManage} onChange={invalidate} />
              {canManage && (
                <button type="button" onClick={() => setDeleting({ id: c.id, name: c.name })} className="text-xs font-medium text-rose-500 hover:underline">
                  Sil
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="Kategoriyi sil"
        description={deleting ? `"${deleting.name}" kategorisi silinecek.` : ""}
        confirmLabel="Kategoriyi sil"
        danger
        isPending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

/** Kategori satırındaki varsayılan KDV göstergesi + satır içi düzenleme.
 *
 *  Oranlar mali müşavir onayı bekliyor — bu yüzey değerlerin GİRİLECEĞİ
 *  yerdir, kod hiçbir oran önermez. "miras" etiketi, kendi değeri boş olup
 *  atasından devralan kategoriyi ayırt eder (yanlışlıkla "burada tanımlı"
 *  sanılıp kökteki değer aranmasın).
 */
function KategoriKdvRozeti({
  category,
  canManage,
  onChange,
}: {
  category: import("@/types").ProductCategory;
  canManage: boolean;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [percent, setPercent] = useState(orandanYuzde(category.default_tax_rate));
  const save = useMutation({
    mutationFn: (default_tax_rate: string | null) =>
      updateCategory(category.id, { default_tax_rate }),
    onSuccess: () => {
      toast.success("Varsayılan KDV güncellendi");
      setEditing(false);
      onChange();
    },
    onError: (err: unknown) =>
      toast.error(getErrorDetail(err, "Varsayılan KDV güncellenemedi")),
  });

  const kendi = orandanYuzde(category.default_tax_rate);
  const efektif = orandanYuzde(category.effective_tax_rate);
  const etiket = kendi
    ? `KDV %${kendi}`
    : efektif
      ? `KDV %${efektif} (miras)`
      : "KDV —";

  if (!editing) {
    return (
      <span className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        {etiket}
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setPercent(kendi);
              setEditing(true);
            }}
            className="font-medium text-slate-600 hover:underline dark:text-slate-300"
          >
            Düzenle
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <input
        value={percent}
        onChange={(e) => setPercent(e.target.value)}
        placeholder="%"
        inputMode="decimal"
        aria-label={`${category.name} varsayılan KDV (%)`}
        className="input w-20 py-1 text-xs"
      />
      <button
        type="button"
        disabled={save.isPending}
        onClick={() => {
          if (!percent.trim()) {
            save.mutate(null); // boş bırakmak varsayılanı TEMİZLER
            return;
          }
          const oran = yuzdedenOran(percent);
          if (!oran.ok) {
            toast.error(oran.hata ?? "KDV oranı geçersiz");
            return;
          }
          save.mutate(oran.oran);
        }}
        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        Kaydet
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
      >
        Vazgeç
      </button>
    </span>
  );
}

/* ── Siparişler ── */

function OrdersPanel() {
  const { canView, canManage } = useAdminAreaAccess("orders");
  const [params, setParams] = useSearchParams();
  // Durum URL'de yaşar: filtreli liste linki paylaşılabilir ve sayfa
  // yenilendiğinde seçim korunur. Beyaz liste, bilinmeyen bir değerin
  // sunucuya gidip 422 üretmesini (ya da sessizce boş liste dönmesini) önler.
  const hamDurum = params.get("durum");
  const durum =
    hamDurum && ORDER_STATUS_FILTERS.includes(hamDurum) ? hamDurum : undefined;
  const { data, isLoading, isError, error, refetch } = useAdminOrders(durum);
  const invalidate = useInvalidateAdminStore();
  // "Teslim edildi" siparişi terminal duruma taşır ve teslimat akışını kapatır;
  // yanlış satıra tıklama geri alınamaz (P1-5 gerekçesi).
  const [teslimSiparisi, setTeslimSiparisi] = useState<number | null>(null);

  const ship = useMutation({
    mutationFn: ({ id, tracking }: { id: number; tracking: string }) => shipOrder(id, tracking),
    onSuccess: () => {
      toast.success("Kargoya verildi");
      invalidate();
    },
  });
  const deliver = useMutation({
    mutationFn: (id: number) => deliverOrder(id),
    onSuccess: () => {
      toast.success("Sipariş teslim edildi olarak işaretlendi");
      setTeslimSiparisi(null);
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorDetail(err, "İşlem başarısız")),
  });
  // Gerekçe ZORUNLU (backend `AdminOrderActionIn`): iade denetim izine
  // gerekçesiz yazılamaz, bu yüzden aksiyon önce gerekçe penceresi açar.
  const [iadeSiparisi, setIadeSiparisi] = useState<number | null>(null);
  const refund = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      refundOrder(id, reason),
    onSuccess: () => {
      toast.success("İade edildi");
      setIadeSiparisi(null);
      invalidate();
    },
    onError: () => toast.error("İade başarısız"),
  });

  if (!canView) return <AccessDenied area="Siparişler" />;
  // P1-6: hata "Sipariş yok." diye gösterilemez.
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "Siparişler yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }
  const siparisler = data?.items ?? [];
  const toplam = data?.total ?? -1;
  // Kesilme, GERÇEK sunucu davranışından okunur: eşleşen toplam, dönen kayıt
  // sayısından büyükse liste kesilmiştir.
  //
  // Önceki hâli sabit `200`e bakıyordu ve üretimde ASLA tetiklenemiyordu
  // (P1-5): istemci `limit` göndermiyor, sunucu varsayılan 100 uyguluyor,
  // `X-Total-Count` dönmüyordu — 130 siparişin 100'ü gösteriliyor ve
  // kullanıcıya hiçbir şey söylenmiyordu. Test ise sahte sunucuya 200 kayıt
  // uydurarak geçiyordu.
  //
  // Sipariş listesinde henüz sayfalama yok (kapsam dışı); geldiği gün bu
  // uyarı KALKMALI, çünkü sayfalı listede toplam zaten görünür ve uyarı
  // yanıltıcı olur (E-5 nöbetçisi bunu koruyor).
  const kesilmisOlabilir = toplam > siparisler.length;

  const kolonlar: ColumnDef<OrderOut, unknown>[] = [
    {
      id: "no",
      accessorFn: (o) => o.id,
      header: "No",
      cell: ({ row }) => (
        <span className="font-semibold text-slate-800 dark:text-slate-200">
          #{row.original.id}
        </span>
      ),
    },
    {
      id: "tarih",
      accessorFn: (o) => o.created_at,
      header: "Tarih",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-slate-500">
          {formatDateTime(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "musteri",
      accessorFn: (o) => o.ship_recipient ?? "",
      header: "Müşteri",
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.ship_recipient ?? (
            <span className="text-slate-400">Dijital sipariş</span>
          )}
        </span>
      ),
    },
    {
      id: "kalem",
      accessorFn: (o) => o.items?.length ?? 0,
      header: "Kalem",
      cell: ({ row }) => {
        const adet = row.original.items?.length ?? 0;
        // Kalem listesi BOŞ ise bu "sipariş boş" demek değildir; eski/bozuk
        // veride `order_items` satırı hiç olmayabilir (bkz. lib/orderItems).
        return adet > 0 ? (
          <span className="text-sm">{adet}</span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        );
      },
    },
    {
      id: "toplam",
      accessorFn: (o) => o.total,
      header: "Toplam",
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-medium">
          {formatTL(row.original.total)}
        </span>
      ),
    },
    {
      id: "odeme",
      accessorFn: (o) => o.payment_status,
      header: "Ödeme",
      cell: ({ row }) => (
        <Badge tone={orderPaymentTone(row.original.payment_status)}>
          {orderPaymentLabel(row.original.payment_status)}
        </Badge>
      ),
    },
    {
      id: "durum",
      accessorFn: (o) => o.status,
      header: "Durum",
      cell: ({ row }) => (
        <Badge tone={orderStatusTone(row.original.status)}>
          {orderStatusLabel(row.original.status)}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const o = row.original;
        if (!canManage) return null;
        return (
          <div className="flex flex-wrap justify-end gap-2">
            {o.has_physical && o.payment_status === "PAID" && o.status === "PAID" && (
              <ShipButton onShip={(tracking) => ship.mutate({ id: o.id, tracking })} />
            )}
            {o.status === "SHIPPED" && (
              <button type="button" onClick={() => setTeslimSiparisi(o.id)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs dark:border-slate-700">
                Teslim edildi
              </button>
            )}
            {o.payment_status === "PAID" && (
              <button type="button" onClick={() => setIadeSiparisi(o.id)} className="rounded-lg border border-rose-200 px-3 py-1 text-xs text-rose-600 dark:border-rose-500/30">
                İade et
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      {!canManage && <ReadOnlyNotice />}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Durum
          <select
            value={durum ?? ""}
            onChange={(e) =>
              setParams((onceki) =>
                setQueryValue(new URLSearchParams(onceki), {
                  durum: e.target.value || undefined,
                })
              )
            }
            className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">Tümü</option>
            {ORDER_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {orderStatusLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DataTable
        columns={kolonlar}
        data={siparisler}
        getRowId={(o) => String(o.id)}
        isLoading={isLoading}
        page={1}
        pageSize={Math.max(siparisler.length, 1)}
        total={siparisler.length}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        emptyTitle={durum ? "Sonuç bulunamadı" : "Henüz sipariş yok"}
        emptyDescription={
          durum
            ? "Bu durumda sipariş bulunmuyor; filtreyi değiştirmeyi deneyin."
            : "İlk sipariş geldiğinde burada görünecek."
        }
        emptyAction={
          durum ? (
            <Button size="sm" variant="secondary" onClick={() => setParams({})}>
              Filtreleri temizle
            </Button>
          ) : undefined
        }
        truncationNotice={
          kesilmisOlabilir ? (
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Toplam {toplam} siparişin ilk {siparisler.length} tanesi
              gösteriliyor; listenin tamamı bu değil. Daraltmak için durum
              filtresini kullanın.
            </p>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={teslimSiparisi !== null}
        title="Siparişi teslim edildi işaretle"
        description={`#${teslimSiparisi} siparişi teslim edilmiş sayılacak ve teslimat akışı kapanacak.`}
        confirmLabel="Teslim edildi olarak işaretle"
        isPending={deliver.isPending}
        onClose={() => setTeslimSiparisi(null)}
        onConfirm={() => teslimSiparisi !== null && deliver.mutate(teslimSiparisi)}
      />

      <ReasonDialog
        open={iadeSiparisi !== null}
        title="Siparişi iade et"
        description="Gerekçe sipariş geçmişine ve denetim izine yazılacak."
        label="İade gerekçesi"
        required
        minLength={3}
        maxLength={500}
        danger
        confirmLabel="İade et"
        isPending={refund.isPending}
        onClose={() => setIadeSiparisi(null)}
        onConfirm={(reason) =>
          iadeSiparisi !== null && refund.mutate({ id: iadeSiparisi, reason })
        }
      />
    </div>
  );
}

function ShipButton({ onShip }: { onShip: (tracking: string) => void }) {
  const [tracking, setTracking] = useState("");
  return (
    <div className="flex gap-2">
      <input
        value={tracking}
        onChange={(e) => setTracking(e.target.value)}
        placeholder="Takip no"
        className="rounded-lg border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
      />
      <button type="button" onClick={() => onShip(tracking)} className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white dark:bg-white dark:text-slate-900">
        Kargola
      </button>
    </div>
  );
}

/* ── İadeler (RMA) ── */

const RETURN_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Bekliyor", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" },
  APPROVED: { label: "Onaylandı", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
  REJECTED: { label: "Reddedildi", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400" },
};

function ReturnsPanel() {
  const { canView, canManage } = useAdminAreaAccess("returns");
  const [decision, setDecision] = useState<{ id: number; action: "approve" | "reject" } | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const { data: returns, isLoading, isError, error, refetch } =
    useAdminReturns(onlyPending ? "PENDING" : undefined);
  const resolve = useResolveReturn();

  function approve(id: number) {
    resolve.mutate(
      { id, action: "approve" },
      {
        onSuccess: () => { toast.success("İade onaylandı, ödeme iade edildi"); setDecision(null); },
        onError: (err: unknown) => {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
            "İade onaylanamadı";
          toast.error(detail);
        },
      }
    );
  }

  function reject(id: number, note: string) {
    resolve.mutate(
      { id, action: "reject", adminNote: note || null },
      {
        onSuccess: () => { toast.success("İade talebi reddedildi"); setDecision(null); },
        onError: () => toast.error("İşlem başarısız"),
      }
    );
  }

  if (!canView) return <AccessDenied area="İadeler" />;
  // P1-6: "Bekleyen iade talebi yok." metni hata hâlinde BASILAMAZ — yönetici
  // kuyruğu boş sanıp bekleyen iadeyi atlar (denetim raporunun örneği).
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "İade talepleri yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }
  if (isLoading) return <p className="text-sm text-slate-400">Yükleniyor…</p>;

  return (
    <div className="space-y-3">
      {!canManage && <ReadOnlyNotice />}
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={onlyPending}
          onChange={(e) => setOnlyPending(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        Yalnız bekleyenler
      </label>

      {returns && returns.length > 0 ? (
        returns.map((r) => {
          const badge = RETURN_STATUS_LABELS[r.status] ?? { label: r.status, cls: "bg-slate-100 text-slate-500" };
          return (
            <div key={r.id} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Sipariş #{r.order_id}
                  {r.order && <> · {formatTL(r.order.total)}</>}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{formatDateTime(r.created_at)}</p>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
                {r.reason}
              </p>
              {r.order?.ship_recipient && (
                <p className="mt-1 text-xs text-slate-500">
                  {r.order.ship_recipient}
                  {r.order.ship_address ? ` — ${r.order.ship_address}` : ""}
                </p>
              )}
              {r.admin_note && (
                <p className="mt-2 text-xs text-slate-500">
                  <span className="font-medium">Not:</span> {r.admin_note}
                </p>
              )}
              {canManage && r.status === "PENDING" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => setDecision({ id: r.id, action: "approve" })}
                    className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Onayla & iade et
                  </button>
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => setDecision({ id: r.id, action: "reject" })}
                    className="rounded-lg border border-rose-200 px-3 py-1 text-xs text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
                  >
                    Reddet
                  </button>
                </div>
              )}
            </div>
          );
        })
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">
          {onlyPending ? "Bekleyen iade talebi yok." : "İade talebi yok."}
        </p>
      )}
      <ConfirmDialog
        open={decision?.action === "approve"}
        title="İade talebini onayla"
        description="Müşteriye ödeme iadesi yapılacak ve ürün stoğu geri yüklenecek."
        confirmLabel="Onayla ve iade et"
        danger
        isPending={resolve.isPending}
        onClose={() => setDecision(null)}
        onConfirm={() => decision && approve(decision.id)}
      />
      <ReasonDialog
        open={decision?.action === "reject"}
        title="İade talebini reddet"
        description="Moderasyon notu müşteriye iletilecek."
        label="Red gerekçesi"
        confirmLabel="Talebi reddet"
        danger
        isPending={resolve.isPending}
        onClose={() => setDecision(null)}
        onConfirm={(note) => decision && reject(decision.id, note)}
      />
    </div>
  );
}

/* ── Kuponlar ── */

const EMPTY_COUPON: CouponCreate = {
  code: "",
  discount_type: "PERCENT",
  discount_value: 10,
  min_subtotal: 0,
  max_uses: null,
  per_user_limit: 1,
  is_active: true,
};

function CouponsPanel() {
  const { canView, canManage } = useAdminAreaAccess("coupons");
  const { data: coupons, isLoading, isError, error, refetch } = useCoupons();
  const create = useCreateCoupon();
  const update = useUpdateCoupon();
  const del = useDeleteCoupon();
  const [form, setForm] = useState<CouponCreate>(EMPTY_COUPON);
  const [deleting, setDeleting] = useState<{ id: number; code: string } | null>(null);

  function submit() {
    if (!form.code.trim()) {
      toast.error("Kod gir");
      return;
    }
    create.mutate(
      { ...form, code: form.code.trim().toUpperCase() },
      {
        onSuccess: () => {
          toast.success("Kupon oluşturuldu");
          setForm(EMPTY_COUPON);
        },
        onError: (err: unknown) => {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
            "Kupon oluşturulamadı";
          toast.error(detail);
        },
      }
    );
  }

  const inputCls =
    "rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white";

  if (!canView) return <AccessDenied area="Kuponlar" />;
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "Kuponlar yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {!canManage && <ReadOnlyNotice />}
      {/* Oluştur */}
      {canManage && (
      <div className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Yeni kupon</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="KOD"
            className={`${inputCls} uppercase`}
          />
          <select
            value={form.discount_type}
            onChange={(e) => setForm({ ...form, discount_type: e.target.value as CouponDiscountType })}
            className={inputCls}
          >
            <option value="PERCENT">Yüzde %</option>
            <option value="FIXED">Sabit TL</option>
          </select>
          <input
            type="number"
            value={form.discount_value}
            onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
            placeholder="Değer"
            className={inputCls}
          />
          <input
            type="number"
            value={form.min_subtotal ?? 0}
            onChange={(e) => setForm({ ...form, min_subtotal: Number(e.target.value) })}
            placeholder="Min sepet"
            className={inputCls}
          />
          <input
            type="number"
            value={form.max_uses ?? ""}
            onChange={(e) => setForm({ ...form, max_uses: e.target.value ? Number(e.target.value) : null })}
            placeholder="Maks kullanım"
            className={inputCls}
          />
          <input
            type="number"
            value={form.per_user_limit ?? ""}
            onChange={(e) => setForm({ ...form, per_user_limit: e.target.value ? Number(e.target.value) : null })}
            placeholder="Kişi başı"
            className={inputCls}
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={create.isPending}
          className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Kupon oluştur
        </button>
      </div>
      )}

      {/* Liste */}
      {isLoading ? (
        <p className="text-sm text-slate-400">Yükleniyor…</p>
      ) : !coupons || coupons.length === 0 ? (
        <p className="text-sm text-slate-400">Henüz kupon yok.</p>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 dark:border-slate-800"
            >
              <div className="text-sm">
                <span className="font-semibold text-slate-900 dark:text-white">{c.code}</span>
                <span className="ml-2 text-slate-500">
                  {c.discount_type === "PERCENT" ? `%${c.discount_value}` : formatTL(c.discount_value)} indirim
                </span>
                <span className="ml-2 text-xs text-slate-400">
                  min {formatTL(c.min_subtotal)} · kullanım {c.used_count}
                  {c.max_uses ? `/${c.max_uses}` : ""}
                </span>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: c.id, payload: { is_active: !c.is_active } })}
                    className={`rounded-lg px-3 py-1 text-xs font-medium ${
                      c.is_active
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {c.is_active ? "Aktif" : "Pasif"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting({ id: c.id, code: c.code })}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                  >
                    Sil
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Kuponu sil"
        description={deleting ? `${deleting.code} kuponu silinecek.` : ""}
        confirmLabel="Kuponu sil"
        danger
        isPending={del.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}
