import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { ProductCard } from "@/components/store/ProductCard";
import {
  useBookFacets,
  useCategories,
  useInfiniteProducts,
} from "@/hooks/useStore";
import { useDebounce } from "@/hooks/useDebounce";
import { StoreLandingBlocks } from "@/components/store/StoreLandingBlocks";
import { useStoreHomePage } from "@/hooks/useStoreMerchandising";
import type { ProductKind } from "@/types";
import type { ProductSearchParams } from "@/api/store";

const CONTAINER = "mx-auto max-w-[1464px] px-4 md:px-8";
const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

type Sort = "" | "price_asc" | "price_desc" | "newest" | "rating";

const SORT_LABELS: Record<Sort, string> = {
  "": "Önerilen",
  rating: "En beğenilen",
  newest: "En yeni",
  price_asc: "Fiyat (artan)",
  price_desc: "Fiyat (azalan)",
};

// "Basılı" DEĞİL: vitrinde kitap dışı fiziksel ürün de var (kalem, defter,
// fotokopi kâğıdı). Filtre DEĞERLERİ (PHYSICAL/DIGITAL) değişmedi.
const KIND_LABELS: { value: "" | ProductKind; label: string }[] = [
  { value: "", label: "Tümü" },
  { value: "PHYSICAL", label: "Fiziksel ürün" },
  { value: "DIGITAL", label: "Dijital ürün" },
];

export default function StorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get("q") || "";
  const urlCat = searchParams.get("category");
  const rawUrlKind = searchParams.get("kind");
  const urlKind: "" | ProductKind =
    rawUrlKind === "PHYSICAL" || rawUrlKind === "DIGITAL" ? rawUrlKind : "";
  const rawUrlSort = searchParams.get("sort");
  const urlSort: Sort =
    rawUrlSort && rawUrlSort in SORT_LABELS ? (rawUrlSort as Sort) : "";

  const [q, setQ] = useState(urlQ);
  const [categoryId, setCategoryId] = useState<number | undefined>(
    urlCat ? Number(urlCat) : undefined,
  );
  const [kind, setKind] = useState<"" | ProductKind>(urlKind);
  const [sort, setSort] = useState<Sort>(urlSort);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [inStock, setInStock] = useState(false);
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  // Kitap künyesi daraltmaları (çoklu seçim).
  const [publishers, setPublishers] = useState<string[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [coverTypes, setCoverTypes] = useState<string[]>([]);
  // Varyant eksen daraltmaları: eksen adı → seçili değerler. Eksen adları
  // veriden gelir (book-facets → variant_axes); istemcide sözlük kopyası yok.
  const [variantSel, setVariantSel] = useState<Record<string, string[]>>({});

  const debouncedQ = useDebounce(q, 350);
  const debMin = useDebounce(minPrice, 400);
  const debMax = useDebounce(maxPrice, 400);

  useEffect(() => {
    setQ(urlQ);
  }, [urlQ]);

  useEffect(() => {
    setCategoryId(urlCat ? Number(urlCat) : undefined);
  }, [urlCat]);

  useEffect(() => {
    setKind(urlKind);
  }, [urlKind]);

  useEffect(() => {
    setSort(urlSort);
  }, [urlSort]);

  const { data: categories } = useCategories();
  const { data: canonicalHome, isLoading: isCanonicalHomeLoading } = useStoreHomePage();
  // Seçenekler kategoriye göre daralır: "Kırtasiye"de yayınevi listesi
  // göstermek kullanıcıyı boş sonuca sürükler.
  const { data: bookFacets } = useBookFacets(categoryId);
  const topCategories = useMemo(
    () => (categories ?? []).filter((c) => !c.parent_id),
    [categories],
  );

  const isFiltering = !!(
    debouncedQ ||
    categoryId ||
    kind ||
    sort ||
    debMin ||
    debMax ||
    inStock ||
    minRating ||
    publishers.length ||
    authors.length ||
    coverTypes.length ||
    Object.values(variantSel).some((v) => v.length)
  );

  // "Eksen:Değer" öğeleri — sunucunun `variant` parametre biçimi.
  const variantParam = Object.entries(variantSel).flatMap(([eksen, degerler]) =>
    degerler.map((d) => `${eksen}:${d}`),
  );

  const searchInput: ProductSearchParams = {
    q: debouncedQ || undefined,
    category_id: categoryId,
    kind: kind || undefined,
    min_price: debMin ? Number(debMin) : undefined,
    max_price: debMax ? Number(debMax) : undefined,
    in_stock: inStock || undefined,
    min_rating: minRating,
    publisher: publishers.length ? publishers : undefined,
    author: authors.length ? authors : undefined,
    cover_type: coverTypes.length ? coverTypes : undefined,
    variant: variantParam.length ? variantParam : undefined,
    sort: sort || undefined,
    limit: 24,
  };

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteProducts(searchInput);
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
    setPublishers([]);
    setAuthors([]);
    setCoverTypes([]);
    setVariantSel({});
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
                <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
                  Kategoriler
                </h3>
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
                <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
                  Fiyat aralığı
                </h3>
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

                <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
                  Ürün türü
                </h3>
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

                <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
                  Değerlendirme
                </h3>
                <div className="flex flex-col gap-1">
                  <FilterButton
                    active={minRating === undefined}
                    onClick={() => setMinRating(undefined)}
                    label="Tümü"
                  />
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

                {/* Kitap künyesi: seçenekler veriden gelir, sayaçlı. Boşsa
                    bölüm hiç çizilmez — kırtasiye kategorisinde yayınevi
                    listesi göstermek kullanıcıyı boş sonuca sürüklerdi. */}
                <FacetGroup
                  title="Yayınevi"
                  options={bookFacets?.publisher}
                  selected={publishers}
                  onToggle={setPublishers}
                />
                <FacetGroup
                  title="Yazar"
                  options={bookFacets?.author}
                  selected={authors}
                  onToggle={setAuthors}
                />
                <FacetGroup
                  title="Kapak"
                  options={bookFacets?.cover_type}
                  selected={coverTypes}
                  onToggle={setCoverTypes}
                />
                {/* Varyant eksenleri: eksen ADINA göre ayrı kutular (Renk,
                    Ebat…) — değerler karışmaz; bkz. backend list_book_facets. */}
                {Object.entries(bookFacets?.variant_axes ?? {}).map(
                  ([eksen, secenekler]) => (
                    <FacetGroup
                      key={eksen}
                      title={eksen}
                      options={secenekler}
                      selected={variantSel[eksen] ?? []}
                      onToggle={(next) =>
                        setVariantSel((s) => ({ ...s, [eksen]: next }))
                      }
                    />
                  ),
                )}
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
                        ? (topCategories.find((c) => c.id === categoryId)
                            ?.name ?? "Ürünler")
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
                    onChange={(event) => {
                      const secilen = event.target.value as Sort;
                      setSort(secilen);
                      // TB-70 (b): sıralama URL'DE yaşamalı. `q`, `category`
                      // ve `kind` zaten orada; sıralamanın yerelde kalması
                      // paylaşılan/yer imlenen adresin farklı bir liste
                      // göstermesi demekti. Boş değer parametreyi SİLER —
                      // `?sort=` kuyruğu "seçim yapılmış" gibi görünür.
                      if (secilen) searchParams.set("sort", secilen);
                      else searchParams.delete("sort");
                      setSearchParams(searchParams);
                    }}
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
                    <div
                      key={i}
                      className="animate-pulse rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                    >
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
                        {isFetchingNextPage
                          ? "Yükleniyor…"
                          : "Daha fazla yükle"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-slate-100 bg-white py-24 text-center dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 dark:bg-slate-800">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-slate-400"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.3-4.3" />
                    </svg>
                  </div>
                  <h3 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
                    Sonuç bulunamadı
                  </h3>
                  <p className="text-slate-500 dark:text-slate-400">
                    Aradığınız kriterlere uygun ürün yok. Filtreleri temizleyip
                    tekrar deneyin.
                  </p>
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
        /* ── Vitrin (filtre yokken): yönetilen kanonik HOME akışı ── */
        <>
          {/* TEK NESİL. Eskiden burada üç kademeli bir fallback vardı:
              kanonik bloklar yoksa eski hero (G2) + eski bölümler (G3), o da
              yoksa koda gömülü ürün şeritleri. Bu, sektörün "silent fallback"
              dediği anti-desendi — hatayı operatörden ve izlemeden gizleyen
              görünmez bir kod yolu değişimi. Üstelik aynı sayfanın eski
              kopyasını değil, BAŞKA BİR NESLİN içeriğini basıyordu; bozukluk
              günlerce yaşayabilir ve kimse fark etmezdi.

              Yerine geçen sözleşme:
                • varsayılan ana sayfa VERİDİR (migration/seed ile garanti
                  edilen, panelden düzenlenebilir bir sayfa) — koda gömülü
                  bir dal değil,
                • çalışma zamanı hatasında React Query önbellekteki son iyi
                  kopyayı tutar (stale-if-error kalıbı),
                • elde hiçbir şey yoksa düşüş GÖRÜNÜR olur: kullanıcıya açık
                  bir uyarı, sunucuda `/health → storefront: degraded`. */}
          {canonicalHome?.revision && Array.isArray(canonicalHome.revision.blocks) ? (
            <StoreLandingBlocks page={canonicalHome} />
          ) : isCanonicalHomeLoading ? (
            <div className={`${CONTAINER} py-10`}><HomeFlowSkeleton /></div>
          ) : (
            <div className={`${CONTAINER} py-16`}>
              <div
                role="alert"
                className="mx-auto max-w-lg border-l-2 border-amber-400 bg-amber-50/60 py-4 pl-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
              >
                <p className="font-semibold">Vitrin şu anda görüntülenemiyor.</p>
                <p className="mt-1">
                  Ürünleri aramaya ve kategorilere göz atmaya devam
                  edebilirsiniz.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </StoreLayout>
  );
}

function HomeFlowSkeleton() {
  return (
    <div aria-label="Mağaza bölümleri yükleniyor" className="space-y-5">
      <div className="h-7 w-48 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      <div className="flex gap-4 overflow-hidden md:gap-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-[280px] w-[160px] shrink-0 animate-pulse rounded-xl bg-slate-100 md:w-[200px] dark:bg-slate-800"
          />
        ))}
      </div>
    </div>
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

function FacetGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options?: { value: string; count: number }[];
  selected: string[];
  onToggle: (next: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!options?.length) return null;

  const visible = expanded
    ? options
    : [
        ...options.slice(0, 8),
        ...options.slice(8).filter((o) => selected.includes(o.value)),
      ];

  const toggle = (value: string) =>
    onToggle(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );

  return (
    <>
      <hr className="my-5 border-slate-100 dark:border-slate-800" />
      <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
        {title}
      </h3>
      <div className="flex flex-col gap-1">
        {visible.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60"
          >
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => toggle(option.value)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
            />
            <span className="min-w-0 flex-1 truncate">{option.value}</span>
            <span className="shrink-0 text-xs text-slate-400">
              {option.count}
            </span>
          </label>
        ))}
      </div>
      {options.length > 8 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-semibold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400"
        >
          {expanded ? "Daha az göster" : `Tümünü göster (${options.length})`}
        </button>
      )}
    </>
  );
}
