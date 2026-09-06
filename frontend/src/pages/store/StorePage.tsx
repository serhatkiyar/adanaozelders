import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { ProductCard } from "@/components/store/ProductCard";
import {
  useBookFacets,
  useCategories,
  useCategoryFacets,
  useInfiniteProducts,
} from "@/hooks/useStore";
import { useDebounce } from "@/hooks/useDebounce";
import { AnaVitrin } from "@/pages/store/vitrin/AnaVitrin";
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
  // Seçenekler kategoriye göre daralır: "Kırtasiye"de yayınevi listesi
  // göstermek kullanıcıyı boş sonuca sürükler.
  const { data: bookFacets } = useBookFacets(categoryId);

  // "Eksen:Değer" öğeleri — sunucunun `variant` parametre biçimi.
  const variantParam = Object.entries(variantSel).flatMap(([eksen, degerler]) =>
    degerler.map((d) => `${eksen}:${d}`),
  );

  // ── Kenar çubuğu kategori kaynağı (1 Eyl, Trendyol/Amazon paritesi) ──
  // ARAMA modunda liste "İlgili kategoriler"dir: sunucudan aramaya kapsamlı
  // sayaçlar gelir, eşleşmesi olmayan kategori HİÇ görünmez ("soru bankası"
  // ararken Ev ve Kişisel Bakım listelenmez). Gezinme modunda tüm ağaç,
  // kırılımlı (seçilinin çocukları + üst kademeye dönüş).
  const aramaModu = !!debouncedQ;
  const { data: facetler } = useCategoryFacets(
    {
      q: debouncedQ || undefined,
      kind: kind || undefined,
      min_price: debMin ? Number(debMin) : undefined,
      max_price: debMax ? Number(debMax) : undefined,
      min_rating: minRating,
      publisher: publishers.length ? publishers : undefined,
      author: authors.length ? authors : undefined,
      cover_type: coverTypes.length ? coverTypes : undefined,
      variant: variantParam.length ? variantParam : undefined,
    },
    aramaModu,
  );
  const listeKaynak = useMemo(
    () => (aramaModu ? facetler ?? [] : categories ?? []),
    [aramaModu, facetler, categories],
  );
  const topCategories = useMemo(() => {
    const t = listeKaynak.filter((c) => !c.parent_id);
    // Arama modunda en çok eşleşen üstte (Trendyol sıralaması).
    return aramaModu ? [...t].sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0)) : t;
  }, [listeKaynak, aramaModu]);
  // Ad/ebeveyn aramaları TAM ağaçtan: seçili kategori aramada 0 eşleşse de
  // adı ve dönüş yolu doğru kalmalı.
  const kategoriById = useMemo(
    () => new Map((categories ?? []).map((c) => [c.id, c])),
    [categories],
  );
  const cocuklar = useMemo(() => {
    const m = new Map<number, typeof topCategories>();
    for (const c of listeKaynak) {
      if (c.parent_id) {
        const arr = m.get(c.parent_id) ?? [];
        arr.push(c);
        m.set(c.parent_id, arr);
      }
    }
    if (aramaModu)
      for (const arr of m.values())
        arr.sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0));
    return m;
  }, [listeKaynak, aramaModu]);
  const seciliKategori = categoryId ? kategoriById.get(categoryId) : undefined;

  const kategoriSec = (id: number | undefined) => {
    setCategoryId(id);
    if (id === undefined) searchParams.delete("category");
    else searchParams.set("category", String(id));
    setSearchParams(searchParams);
  };

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
        title="Mağaza, Adana Özel Ders"
        description="Kitaplar, deneme setleri, kırtasiye ve eğitmenlerin dijital ders notları. Tek hesapla alışveriş."
      />

      {isFiltering ? (
        /* ── Arama / filtre görünümü: yan filtre + ızgara ── */
        <div className={`${CONTAINER} py-8`}>
          <div className="flex flex-col gap-8 md:flex-row">
            {/* Yan filtre */}
            <aside className="w-full flex-shrink-0 md:w-64">
              <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-slate-100 bg-white p-5 pr-4 ">
                <h3 className="mb-4 text-base font-semibold text-slate-900 ">
                  {aramaModu ? "İlgili kategoriler" : "Kategoriler"}
                </h3>
                <div className="flex flex-col gap-1">
                  {aramaModu ? (
                    /* ARAMA modu (Baymard/Amazon usulü): kapsamlı ağacın
                       TAMAMI baştan açık ve girintili — tıklayınca bir şey
                       "açılmaz", yalnız filtre uygulanır. Veri tek istekte
                       zaten elde; yükleme hissi yapısal olarak yok. */
                    <>
                      <FilterButton
                        active={categoryId === undefined}
                        onClick={() => kategoriSec(undefined)}
                        label="Tüm sonuçlar"
                      />
                      {topCategories.map((kok) => (
                        <FacetDali
                          key={kok.id}
                          dugum={kok}
                          derinlik={0}
                          cocuklar={cocuklar}
                          seciliId={categoryId}
                          onSec={kategoriSec}
                        />
                      ))}
                    </>
                  ) : seciliKategori ? (
                    <>
                      {/* Üst kademeye dönüş */}
                      <button
                        type="button"
                        onClick={() => kategoriSec(seciliKategori.parent_id ?? undefined)}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                      >
                        <span aria-hidden="true">←</span>
                        {seciliKategori.parent_id
                          ? kategoriById.get(seciliKategori.parent_id)?.name ?? "Üst kategori"
                          : "Tüm Ürünler"}
                      </button>
                      <FilterButton
                        active
                        onClick={() => {}}
                        label={seciliKategori.name}
                      />
                      {(cocuklar.get(seciliKategori.id) ?? []).map((c) => (
                        <div key={c.id} className="pl-3">
                          <FilterButton
                            active={false}
                            onClick={() => kategoriSec(c.id)}
                            label={c.name}
                          />
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      <FilterButton
                        active
                        onClick={() => kategoriSec(undefined)}
                        label="Tüm Ürünler"
                      />
                      {topCategories.map((c) => (
                        <FilterButton
                          key={c.id}
                          active={false}
                          onClick={() => kategoriSec(c.id)}
                          label={c.name}
                        />
                      ))}
                    </>
                  )}
                </div>

                <hr className="my-5 border-slate-100 " />

                {/* Fiyat aralığı */}
                <h3 className="mb-3 text-base font-semibold text-slate-900 ">
                  Fiyat aralığı
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    placeholder="En az"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-marka-mid "
                  />
                  <span className="text-slate-400">–</span>
                  <input
                    type="number"
                    min={0}
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    placeholder="En çok"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-marka-mid "
                  />
                </div>

                {/* "Ürün türü" (Fiziksel/Dijital) filtresi KALDIRILDI (1 Eyl,
                    kullanıcı kararı): dijital ürün kolu şu an kullanılmıyor;
                    müşteriye anlamsız bir teknik ayrım gösteriyordu. Backend
                    `kind` paramı duruyor — kol açılırsa filtre geri gelir. */}
                <hr className="my-5 border-slate-100 " />

                <h3 className="mb-3 text-base font-semibold text-slate-900 ">
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

                <hr className="my-5 border-slate-100 " />

                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700 ">
                  <input
                    type="checkbox"
                    checked={inStock}
                    onChange={(e) => setInStock(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-marka focus:ring-marka-focus "
                  />
                  Sadece stoktakiler
                </label>

                {/* Kitap künyesi: seçenekler veriden gelir, sayaçlı. Boşsa
                    bölüm hiç çizilmez, kırtasiye kategorisinde yayınevi
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
                    Ebat…), değerler karışmaz; bkz. backend list_book_facets. */}
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
                  <h1 className="text-xl font-semibold text-slate-900 ">
                    {debouncedQ
                      ? `"${debouncedQ}" için sonuçlar`
                      : categoryId
                        ? (seciliKategori?.name ?? "Ürünler")
                        : "Tüm Ürünler"}
                  </h1>
                  {!isLoading && (
                    <p className="mt-0.5 text-sm text-slate-400">
                      {products.length}
                      {hasNextPage ? "+" : ""} ürün
                    </p>
                  )}
                </div>

                <label className="flex items-center gap-3 text-sm text-slate-500 ">
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
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 outline-none transition-colors hover:border-slate-300 focus:border-marka-mid "
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
                      className="animate-pulse rounded-xl border border-slate-100 bg-white p-4 "
                    >
                      <div className="aspect-[4/5] rounded-lg bg-slate-100 " />
                      <div className="mt-4 h-4 w-3/4 rounded bg-slate-100 " />
                      <div className="mt-2 h-4 w-1/2 rounded bg-slate-100 " />
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
                        className="rounded-full border border-slate-200 px-6 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-marka-mid hover:text-marka disabled:opacity-50 "
                      >
                        {isFetchingNextPage
                          ? "Yükleniyor…"
                          : "Daha fazla yükle"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-slate-100 bg-white py-24 text-center ">
                  <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 ">
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
                  <h3 className="mb-1 text-lg font-semibold text-slate-900 ">
                    Sonuç bulunamadı
                  </h3>
                  <p className="text-slate-500 ">
                    {debouncedQ && seciliKategori
                      ? `"${seciliKategori.name}" içinde eşleşme yok.`
                      : "Aradığınız kriterlere uygun ürün yok. Filtreleri temizleyip tekrar deneyin."}
                  </p>
                  {/* Arama + kategori birlikte boş dönerse en olası niyet:
                      aramayı TÜM mağazada tekrarlamak (1 Eyl). */}
                  {debouncedQ && seciliKategori && (
                    <button
                      onClick={() => kategoriSec(undefined)}
                      className="mt-6 rounded-full bg-marka px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-marka-hover"
                    >
                      Tüm kategorilerde ara
                    </button>
                  )}
                  <button
                    onClick={resetFilters}
                    className={
                      debouncedQ && seciliKategori
                        ? "mt-3 block w-full text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
                        : "mt-6 rounded-full bg-marka px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-marka-hover"
                    }
                  >
                    Filtreleri temizle
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── MANUEL VİTRİN (kullanıcı kararı, 28 Ağu 2026) ──
           Eski sözleşme "ana sayfa VERİDİR, panelden düzenlenir" idi; CMS/Puck
           yönetimi kullanıcı kararıyla söküldü. Vitrin artık KODDUR
           (pages/store/vitrin/AnaVitrin.tsx): sıfır istek, sıfır düşüş yolu,
           yükleme/degraded durumu yok, değişiklik = kod düzenlemesi. */
        <AnaVitrin />
      )}
    </StoreLayout>
  );
}


/** Arama modunun kategori dalı: düğüm + TÜM alt dalları açık, girintili. */
function FacetDali({
  dugum,
  derinlik,
  cocuklar,
  seciliId,
  onSec,
}: {
  dugum: { id: number; name: string; product_count?: number | null };
  derinlik: number;
  cocuklar: Map<number, { id: number; name: string; product_count?: number | null }[]>;
  seciliId: number | undefined;
  onSec: (id: number | undefined) => void;
}) {
  return (
    <div style={{ paddingLeft: derinlik ? 12 : 0 }} className="flex flex-col gap-1">
      <FilterButton
        active={seciliId === dugum.id}
        onClick={() => onSec(dugum.id)}
        label={dugum.name}
      />
      {(cocuklar.get(dugum.id) ?? []).map((c) => (
        <FacetDali
          key={c.id}
          dugum={c}
          derinlik={derinlik + 1}
          cocuklar={cocuklar}
          seciliId={seciliId}
          onSec={onSec}
        />
      ))}
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
      // Seçim Amazon usulü: dolgu hapı değil KALIN koyu metin (1 Eyl planı).
      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
        active
          ? "font-bold text-slate-900 "
          : "font-medium text-slate-600 hover:text-slate-900 "
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
      <hr className="my-5 border-slate-100 " />
      <h3 className="mb-3 text-base font-semibold text-slate-900 ">
        {title}
      </h3>
      <div className="flex flex-col gap-1">
        {visible.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-slate-600 transition hover:bg-slate-50 "
          >
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => toggle(option.value)}
              className="h-4 w-4 rounded border-slate-300 text-marka focus:ring-marka-focus "
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
          className="mt-2 text-xs font-semibold text-marka transition hover:text-marka-hover "
        >
          {expanded ? "Daha az göster" : `Tümünü göster (${options.length})`}
        </button>
      )}
    </>
  );
}
