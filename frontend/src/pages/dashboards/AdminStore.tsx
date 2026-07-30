import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { NavLink, useLocation } from "react-router-dom";
import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ConfirmDialog, ReasonDialog } from "@/components/admin/ui";
import { adminAreaAccess } from "@/lib/adminAccess";
import { useAuthStore } from "@/store/authStore";
import { formatTL } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/routes";
import { StockLedgerPanel } from "@/components/admin/StockLedgerPanel";
import {
  ADMIN_REASON_OPTIONS,
  requiresNote,
  validateStockEdit,
  type AdminReasonCode,
} from "@/lib/stockMovements";
import { StockMovementsPanel } from "@/components/admin/StockMovementsPanel";
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  deliverOrder,
  refundOrder,
  shipOrder,
  updateProduct,
  uploadProductCover,
} from "@/api/store";
import {
  useAdminOrders,
  useAdminProduct,
  useAdminProducts,
  useAdminReturns,
  useBulkImportProducts,
  useCategories,
  useCoupons,
  useCreateCoupon,
  useDeleteCoupon,
  useInvalidateAdminStore,
  useResolveReturn,
  useUpdateCoupon,
} from "@/hooks/useStore";
import { toast } from "@/store/toastStore";
import type {
  BulkImportResult,
  CouponCreate,
  CouponDiscountType,
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
  const { data: products, isLoading } = useAdminProducts();
  const invalidate = useInvalidateAdminStore();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);

  if (!canView) return <AccessDenied area="Ürünler" />;

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
      <div className="mt-4 space-y-2">
        {isLoading ? (
          <p className="text-sm text-slate-400">Yükleniyor…</p>
        ) : products && products.length > 0 ? (
          products.map((p) => (
            <AdminProductRow key={p.id} product={p} canManage={canManage} onChange={invalidate} />
          ))
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">Ürün yok.</p>
        )}
      </div>
    </div>
  );
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
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<ProductKind>((initial?.kind as ProductKind) ?? "PHYSICAL");
  const [price, setPrice] = useState(initial ? String(initial.price) : "");
  const [compareAt, setCompareAt] = useState(initial?.compare_at_price ? String(initial.compare_at_price) : "");
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
  const hasKunye = !!(
    initial &&
    (initial.author || initial.publisher || initial.isbn || initial.page_count ||
      initial.dimensions || initial.publication_year || initial.edition ||
      initial.language || initial.cover_type)
  );
  const [showSpecs, setShowSpecs] = useState(hasKunye);
  // Stok gerekcesi: yalniz DUZENLEMEDE ve deger degistiginde zorunlu.
  // (Yeni urunde ilk stok `INITIAL` hareketidir; gerekcesi sabittir.)
  const [stockReason, setStockReason] = useState<AdminReasonCode | "">("");
  const [stockNote, setStockNote] = useState("");
  const stokDegisti =
    isEdit && kind === "PHYSICAL" && Number(stock || 0) !== Number(initial?.stock ?? 0);

  const mutation = useMutation({
    mutationFn: () => {
      const base = {
        title,
        price,
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
      {isEdit ? (
        <select value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "HIDDEN" | "DRAFT")} className="input">
          <option value="ACTIVE">Yayında</option>
          <option value="HIDDEN">Gizli</option>
          <option value="DRAFT">Taslak</option>
        </select>
      ) : (
        <select value={kind} onChange={(e) => setKind(e.target.value as ProductKind)} className="input">
          <option value="PHYSICAL">Basılı</option>
          <option value="DIGITAL">Dijital</option>
        </select>
      )}
      <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
        <option value="">Kategori (opsiyonel)</option>
        {(categories ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Fiyat (TL)" inputMode="decimal" className="input" />
      <input value={compareAt} onChange={(e) => setCompareAt(e.target.value)} placeholder="Eski fiyat (opsiyonel)" inputMode="decimal" className="input" />
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

      {/* Künye / kitap bilgileri — opsiyonel, katlanır */}
      <div className="sm:col-span-2">
        <button
          type="button"
          onClick={() => setShowSpecs((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${showSpecs ? "rotate-90" : ""}`}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          Künye / kitap bilgileri (opsiyonel)
        </button>
        {showSpecs && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Yazar" className="input" />
            <input value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="Yayınevi" className="input" />
            <input value={isbn} onChange={(e) => setIsbn(e.target.value)} placeholder="ISBN / Barkod" className="input" />
            <input value={pageCount} onChange={(e) => setPageCount(e.target.value)} placeholder="Sayfa sayısı" inputMode="numeric" className="input" />
            <input value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder="Ebat (ör. 20 x 27)" className="input" />
            <input value={pubYear} onChange={(e) => setPubYear(e.target.value)} placeholder="Basım yılı" inputMode="numeric" className="input" />
            <input value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="Baskı (ör. 1. Basım)" className="input" />
            <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Dil (ör. Türkçe)" className="input" />
            <input value={coverType} onChange={(e) => setCoverType(e.target.value)} placeholder="Kapak tipi (ör. İnce Kapak)" className="input" />
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={mutation.isPending || !title || !price}
        onClick={() => mutation.mutate()}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900 sm:col-span-2"
      >
        {isEdit ? "Kaydet" : "Ürünü ekle"}
      </button>
    </div>
  );
}

function AdminProductRow({
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
      onChange();
    },
  });
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
        <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
          {product.cover_url && <img src={product.cover_url} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{product.title}</p>
          <p className="text-xs text-slate-500">
            {formatTL(product.price)} · {product.kind === "DIGITAL" ? "Dijital" : "Basılı"}
            {product.seller_type === "TUTOR" ? ` · ${product.tutor_name ?? "Eğitmen"}` : ""}
          </p>
          <span className="text-[11px] text-slate-400">{product.status}</span>
        </div>
        {canManage && (
          <div className="flex flex-col items-end gap-1 text-xs">
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
            <button type="button" onClick={() => remove.mutate()} className="font-medium text-rose-500 hover:underline">
              Sil
            </button>
          </div>
        )}
      </div>

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
  "title,kind,price,compare_at_price,stock,category_slug,status,cover_url,description,author,publisher,isbn,page_count,dimensions,publication_year,edition,language,cover_type";

function BulkImportPanel({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const importer = useBulkImportProducts();

  function downloadTemplate() {
    const sample =
      `${CSV_COLUMNS}\n` +
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
        CSV ile toplu ürün ekle. İlk satır başlık olmalı; yalnız <b>title</b> ve <b>price</b>{" "}
        zorunlu. Aynı ISBN varsa atlanır. Platform (fiziksel/dijital) ürünü oluşturur.
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
  const { data: categories } = useCategories();
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
  const remove = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => {
      toast.success("Kategori silindi");
      invalidate();
    },
  });

  if (!canView) return <AccessDenied area="Kategoriler" />;

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
          <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {c.name} <span className="text-slate-400">({c.product_count ?? 0})</span>
            </span>
            {canManage && (
              <button type="button" onClick={() => remove.mutate(c.id)} className="text-xs font-medium text-rose-500 hover:underline">
                Sil
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Siparişler ── */

function OrdersPanel() {
  const { canView, canManage } = useAdminAreaAccess("orders");
  const { data: orders, isLoading } = useAdminOrders();
  const invalidate = useInvalidateAdminStore();

  const ship = useMutation({
    mutationFn: ({ id, tracking }: { id: number; tracking: string }) => shipOrder(id, tracking),
    onSuccess: () => {
      toast.success("Kargoya verildi");
      invalidate();
    },
  });
  const deliver = useMutation({
    mutationFn: (id: number) => deliverOrder(id),
    onSuccess: invalidate,
  });
  const refund = useMutation({
    mutationFn: (id: number) => refundOrder(id),
    onSuccess: () => {
      toast.success("İade edildi");
      invalidate();
    },
    onError: () => toast.error("İade başarısız"),
  });

  if (!canView) return <AccessDenied area="Siparişler" />;
  if (isLoading) return <p className="text-sm text-slate-400">Yükleniyor…</p>;

  return (
    <div className="space-y-3">
      {!canManage && <ReadOnlyNotice />}
      {orders && orders.length > 0 ? (
        orders.map((o) => (
          <div key={o.id} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                #{o.id} · {formatTL(o.total)}
              </span>
              <span className="text-xs text-slate-400">{formatDateTime(o.created_at)}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {o.status} · {o.payment_status}
              {o.has_physical ? " · Kargolu" : " · Dijital"}
            </p>
            {o.ship_address && (
              <p className="mt-1 text-xs text-slate-500">
                {o.ship_recipient} — {o.ship_address}
              </p>
            )}
            {canManage && (
              <div className="mt-2 flex flex-wrap gap-2">
                {o.has_physical && o.payment_status === "PAID" && o.status === "PAID" && (
                  <ShipButton onShip={(tracking) => ship.mutate({ id: o.id, tracking })} />
                )}
                {o.status === "SHIPPED" && (
                  <button type="button" onClick={() => deliver.mutate(o.id)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs dark:border-slate-700">
                    Teslim edildi
                  </button>
                )}
                {o.payment_status === "PAID" && (
                  <button type="button" onClick={() => refund.mutate(o.id)} className="rounded-lg border border-rose-200 px-3 py-1 text-xs text-rose-600 dark:border-rose-500/30">
                    İade et
                  </button>
                )}
              </div>
            )}
          </div>
        ))
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">Sipariş yok.</p>
      )}
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
  const { data: returns, isLoading } = useAdminReturns(onlyPending ? "PENDING" : undefined);
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
  const { data: coupons, isLoading } = useCoupons();
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
