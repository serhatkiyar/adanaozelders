import { useMemo, useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { ProductCard } from "@/components/store/ProductCard";
import { useCategories, useProducts, useInfiniteProducts } from "@/hooks/useStore";
import { useDebounce } from "@/hooks/useDebounce";
import { getRecentlyViewedProducts } from "@/lib/recentlyViewedProducts";
import type { ProductKind } from "@/types";
import type { ProductSearchParams } from "@/api/store";

const CONTAINER = "mx-auto max-w-screen-2xl px-4 md:px-8";
const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

type Sort = "" | "price_asc" | "price_desc" | "newest" | "rating";

const SORT_LABELS: Record<Sort, string> = {
  "": "Önerilen",
  rating: "En beğenilen",
  newest: "En yeni",
  price_asc: "Fiyat (artan)",
  price_desc: "Fiyat (azalan)",
};

const KIND_LABELS: { value: "" | ProductKind; label: string }[] = [
  { value: "", label: "Tümü" },
  { value: "PHYSICAL", label: "Basılı" },
  { value: "DIGITAL", label: "Dijital" },
];

export default function StorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get("q") || "";
  const urlCat = searchParams.get("category");

  const [q, setQ] = useState(urlQ);
  const [categoryId, setCategoryId] = useState<number | undefined>(urlCat ? Number(urlCat) : undefined);
  const [kind, setKind] = useState<"" | ProductKind>("");
  const [sort, setSort] = useState<Sort>("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [inStock, setInStock] = useState(false);
  const [minRating, setMinRating] = useState<number | undefined>(undefined);

  const debouncedQ = useDebounce(q, 350);
  const debMin = useDebounce(minPrice, 400);
  const debMax = useDebounce(maxPrice, 400);

  useEffect(() => {
    setQ(urlQ);
  }, [urlQ]);

  useEffect(() => {
    setCategoryId(urlCat ? Number(urlCat) : undefined);
  }, [urlCat]);

  const { data: categories } = useCategories();
  const topCategories = useMemo(
    () => (categories ?? []).filter((c) => !c.parent_id),
    [categories]
  );

  const isFiltering = !!(
    debouncedQ || categoryId || kind || debMin || debMax || inStock || minRating
  );

  const searchInput: ProductSearchParams = {
    q: debouncedQ || undefined,
    category_id: categoryId,
    kind: kind || undefined,
    min_price: debMin ? Number(debMin) : undefined,
    max_price: debMax ? Number(debMax) : undefined,
    in_stock: inStock || undefined,
    min_rating: minRating,
    sort: sort || undefined,
    limit: 24,
  };

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteProducts(searchInput);
  const products = useMemo(() => data?.pages.flat() ?? [], [data]);

  const resetFilters = () => {
    setQ("");
    setCategoryId(undefined);
    setKind("");
    setSort("");
    setMinPrice("");
    setMaxPrice("");
    setInStock(false);
    setMinRating(undefined);
    setSearchParams({});
  };

  return (
    <StoreLayout title="Mağaza">
      <Seo
        title="Mağaza — Adana Özel Ders"
        description="Kitaplar, deneme setleri, kırtasiye ve eğitmenlerin dijital ders notları. Tek hesapla alışveriş."
      />

      {isFiltering ? (
        /* ── Arama / filtre görünümü: yan filtre + ızgara ── */
        <div className={`${CONTAINER} py-8`}>
          <div className="flex flex-col gap-8 md:flex-row">
            {/* Yan filtre */}
            <aside className="w-full flex-shrink-0 md:w-64">
              <div className="sticky top-24 rounded-2xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">Kategoriler</h3>
                <div className="flex flex-col gap-1">
                  <FilterButton
                    active={categoryId === undefined}
                    onClick={() => {
                      setCategoryId(undefined);
                      searchParams.delete("category");
                      setSearchParams(searchParams);
                    }}
                    label="Tüm Ürünler"
                  />
                  {topCategories.map((c) => (
                    <FilterButton
                      key={c.id}
                      active={categoryId === c.id}
                      onClick={() => {
                        setCategoryId(c.id);
                        searchParams.set("category", c.id.toString());
                        setSearchParams(searchParams);
                      }}
                      label={c.name}
                      count={c.product_count ?? undefined}
                    />
                  ))}
                </div>

                <hr className="my-5 border-slate-100 dark:border-slate-800" />

                {/* Fiyat aralığı */}
                <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">Fiyat aralığı</h3>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    placeholder="En az"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <span className="text-slate-400">–</span>
                  <input
                    type="number"
                    min={0}
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    placeholder="En çok"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>

                <hr className="my-5 border-slate-100 dark:border-slate-800" />

                <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">Format</h3>
                <div className="flex flex-col gap-1">
                  {KIND_LABELS.map((k) => (
                    <FilterButton
                      key={k.value}
                      active={kind === k.value}
                      onClick={() => setKind(k.value)}
                      label={k.label}
                    />
                  ))}
                </div>

                <hr className="my-5 border-slate-100 dark:border-slate-800" />

                <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">Değerlendirme</h3>
                <div className="flex flex-col gap-1">
                  <FilterButton active={minRating === undefined} onClick={() => setMinRating(undefined)} label="Tümü" />
                  {[4, 3].map((r) => (
                    <FilterButton
                      key={r}
                      active={minRating === r}
                      onClick={() => setMinRating(r)}
                      label={`${r}★ ve üzeri`}
                    />
                  ))}
                </div>

                <hr className="my-5 border-slate-100 dark:border-slate-800" />

                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={inStock}
                    onChange={(e) => setInStock(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                  />
                  Sadece stoktakiler
                </label>
              </div>
            </aside>

            {/* Sonuçlar */}
            <div className="flex-1">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
                    {debouncedQ
                      ? `"${debouncedQ}" için sonuçlar`
                      : categoryId
                      ? topCategories.find((c) => c.id === categoryId)?.name ?? "Ürünler"
                      : "Tüm Ürünler"}
                  </h1>
                  {!isLoading && (
                    <p className="mt-0.5 text-sm text-slate-400">
                      {products.length}
                      {hasNextPage ? "+" : ""} ürün
                    </p>
                  )}
                </div>

                <label className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                  <span className="font-medium">Sırala:</span>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  >
                    {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
                      <option key={s} value={s}>
                        {SORT_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {isLoading ? (
                <div className={GRID}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="animate-pulse rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                      <div className="aspect-[4/5] rounded-lg bg-slate-100 dark:bg-slate-800" />
                      <div className="mt-4 h-4 w-3/4 rounded bg-slate-100 dark:bg-slate-800" />
                      <div className="mt-2 h-4 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
                    </div>
                  ))}
                </div>
              ) : products.length > 0 ? (
                <>
                  <div className={GRID}>
                    {products.map((p) => (
                      <ProductCard key={p.id} product={p} />
                    ))}
                  </div>
                  {hasNextPage && (
                    <div className="mt-8 flex justify-center">
                      <button
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="rounded-full border border-slate-200 px-6 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:text-indigo-400"
                      >
                        {isFetchingNextPage ? "Yükleniyor…" : "Daha fazla yükle"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-slate-100 bg-white py-24 text-center dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 dark:bg-slate-800">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.3-4.3" />
                    </svg>
                  </div>
                  <h3 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">Sonuç bulunamadı</h3>
                  <p className="text-slate-500 dark:text-slate-400">Aradığınız kriterlere uygun ürün yok. Filtreleri temizleyip tekrar deneyin.</p>
                  <button
                    onClick={resetFilters}
                    className="mt-6 rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                  >
                    Filtreleri temizle
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── Vitrin (filtre yokken): gerçek ürün kuşakları ── */
        <div className={`${CONTAINER} flex flex-col gap-12 py-10`}>
          <RecentlyViewedRail />
          <ProductScroller
            title="Öne çıkanlar"
            params={{ sort: "rating", limit: 12 }}
            to={`${ROUTES.store}?sort=rating`}
          />
          <ProductScroller
            title="Yeni gelenler"
            params={{ sort: "newest", limit: 12 }}
            to={`${ROUTES.store}?sort=newest`}
          />
          {topCategories.slice(0, 3).map((c) => (
            <ProductScroller
              key={c.id}
              title={c.name}
              params={{ category_id: c.id, limit: 12 }}
              to={`${ROUTES.store}?category=${c.id}`}
            />
          ))}
        </div>
      )}
    </StoreLayout>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
        active
          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
      }`}
    >
      <span>{label}</span>
      {count != null && <span className="text-xs opacity-60">{count}</span>}
    </button>
  );
}

function RecentlyViewedRail() {
  const [items] = useState(() => getRecentlyViewedProducts());
  if (items.length === 0) return null;
  return (
    <div>
      <h2 className="mb-6 text-xl font-semibold text-slate-900 md:text-2xl dark:text-white">
        Son görüntülediklerin
      </h2>
      <div className="hide-scrollbar flex snap-x gap-4 overflow-x-auto pb-4 md:gap-6">
        {items.map((p) => (
          <div key={p.id} className="w-[160px] shrink-0 snap-start md:w-[200px]">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductScroller({
  title,
  params,
  to,
}: {
  title: string;
  params: ProductSearchParams;
  to: string;
}) {
  const { data: products, isLoading } = useProducts(params);

  if (isLoading) {
    return (
      <div>
        <h2 className="mb-6 text-xl font-semibold text-slate-900 md:text-2xl dark:text-white">{title}</h2>
        <div className="hide-scrollbar flex gap-4 overflow-x-auto">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[280px] w-[160px] shrink-0 animate-pulse rounded-xl bg-slate-100 md:w-[200px] dark:bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  if (!products || products.length === 0) return null;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900 md:text-2xl dark:text-white">{title}</h2>
        <Link
          to={to}
          className="group flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Tümünü gör
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition-transform group-hover:translate-x-1">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
      <div className="hide-scrollbar flex snap-x gap-4 overflow-x-auto pb-4 md:gap-6">
        {products.map((p) => (
          <div key={p.id} className="w-[160px] shrink-0 snap-start md:w-[200px]">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </div>
  );
}
