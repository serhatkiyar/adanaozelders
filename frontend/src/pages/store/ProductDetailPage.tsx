import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { JsonLd } from "@/components/JsonLd";
import { StarRating } from "@/components/StarRating";
import { RatingHistogram } from "@/components/store/RatingHistogram";
import { ProductCard } from "@/components/store/ProductCard";
import { HoverZoomImage } from "@/components/store/HoverZoomImage";
import { DeliveryPromiseBadge } from "@/components/store/DeliveryPromiseBadge";
import { FullScreenSpinner } from "@/components/Spinner";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { formatTL } from "@/lib/money";
import { buildSpecRows } from "@/lib/productSpecs";
import { recordViewedProduct } from "@/lib/recentlyViewedProducts";
import {
  useProduct,
  useStoreConfig,
  useProductReviews,
  useProductRatingDistribution,
  useCreateProductReview,
  useCategories,
  useProducts,
  useNotifyWhenInStock,
} from "@/hooks/useStore";
import { useCartStore } from "@/store/cartStore";
import { useFavoritesStore } from "@/store/favoritesStore";
import { useAuthStore } from "@/store/authStore";
import { alisverisYapabilir } from "@/lib/roles";
import type { ProductCategory, ProductKind, ProductVariants } from "@/types";
import { toast } from "@/store/toastStore";

// Düşük stok eşiği burada SABİT DEĞİL: sunucudan (`GET /store/config`)
// okunur. Tek kaynak `backend/core/stock_policy.py`; vitrinin kendi kopyasını
// taşıması, eşik değiştiğinde yönetim listesiyle vitrinin farklı aciliyet
// göstermesine yol açardı (audit P1-2 — eşik 3'e çekilse bile vitrin "Son 4
// ürün" demeye devam ediyordu).

type DetailTab = "about" | "reviews" | "policy";

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: product, isLoading, isError } = useProduct(slug);
  const lowStockThreshold = useStoreConfig().data?.low_stock_threshold;
  const { data: reviews } = useProductReviews(product?.id);
  const { data: distribution } = useProductRatingDistribution(product?.id);
  const { data: categories } = useCategories();
  const navigate = useNavigate();
  const add = useCartStore((s) => s.add);
  const toggleFav = useFavoritesStore((s) => s.toggle);
  const favItems = useFavoritesStore((s) => s.items);
  const user = useAuthStore((s) => s.user);
  const [activeImg, setActiveImg] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("about");
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Benzer ürünler: aynı kategoriden (kendisi hariç). Kategori yoksa -1 → boş döner.
  const { data: relatedRaw } = useProducts({
    category_id: product?.category_id ?? -1,
    limit: 12,
  });
  const related = useMemo(
    () => (relatedRaw ?? []).filter((p) => p.id !== product?.id).slice(0, 10),
    [relatedRaw, product?.id]
  );
  const category = useMemo(
    () => (categories ?? []).find((c) => c.id === product?.category_id),
    [categories, product?.category_id]
  );
  // Breadcrumb için kategori zinciri (kök → mevcut), parent_id'i yukarı yürüterek.
  const categoryTrail = useMemo(() => {
    if (!categories) return [] as ProductCategory[];
    const byId = new Map(categories.map((c) => [c.id, c]));
    const trail: ProductCategory[] = [];
    const seen = new Set<number>();
    let cur = product?.category_id != null ? byId.get(product.category_id) : undefined;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      trail.unshift(cur);
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    }
    return trail;
  }, [categories, product?.category_id]);
  // "Daha fazlasını keşfet": kategorinin çocukları, yoksa kardeş kategoriler.
  const discoverChips = useMemo(() => {
    if (!categories || !category) return [] as ProductCategory[];
    const children = categories.filter((c) => c.parent_id === category.id);
    if (children.length) return children;
    return categories.filter(
      (c) => c.parent_id === category.parent_id && c.id !== category.id
    );
  }, [categories, category]);

  // Lightbox klavye gezinmesi (Esc kapatır, ←/→ galeride gezer).
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxOpen(false);
        return;
      }
      if (!product) return;
      const g = [
        ...(product.cover_url ? [product.cover_url] : []),
        ...product.images.map((i) => i.url),
      ];
      if (g.length < 2) return;
      const cur = Math.max(0, g.indexOf(activeImg ?? g[0]));
      if (e.key === "ArrowLeft") setActiveImg(g[(cur - 1 + g.length) % g.length]);
      else if (e.key === "ArrowRight") setActiveImg(g[(cur + 1) % g.length]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, activeImg, product]);

  // Görüntülenen ürünü "son görüntülenenler"e kaydet (localStorage).
  useEffect(() => {
    if (product) recordViewedProduct(product);
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <FullScreenSpinner />;
  if (isError || !product) {
    return (
      <StoreLayout title="Ürün">
        <div className="mx-auto max-w-3xl py-20 text-center">
          <p className="text-slate-600 ">Ürün bulunamadı.</p>
          <Link to={ROUTES.store} className="mt-4 inline-block text-sm font-medium underline">
            Mağazaya dön
          </Link>
        </div>
      </StoreLayout>
    );
  }

  const gallery = [
    ...(product.cover_url ? [product.cover_url] : []),
    ...product.images.map((i) => i.url),
  ];
  const hero = activeImg ?? gallery[0] ?? null;
  const heroIndex = Math.max(0, gallery.indexOf(hero ?? ""));
  const soldOut = !product.in_stock;
  // Eşik bilinmiyorsa (config ucu düştü) uyarı BASILMAZ: yanlış eşikle
  // "son N ürün" demek müşteriye uydurulmuş bir aciliyet gösterir.
  // "Stokta yok" bundan ayrıdır ve eşik gerektirmez.
  //
  // ── Tedarikçiden karşılanan ürün "az kaldı" DEMEZ (tedarikçi senkronu) ──
  //
  // `fulfillment === "SUPPLIER"` yalnız KENDİ stoğumuz 0 iken doğar
  // (`core/stock_policy.py::karsilanma_kaynagi`) ama ürün satılabilir kalır.
  // Bu koşul olmadan `product.stock === 0 <= eşik` sağlanıyor ve ekran
  // **"Son 0 ürün"** basıyordu: hem anlamsız hem de amber renkte uydurulmuş
  // bir aciliyet — yukarıdaki notun tam olarak yasakladığı şey.
  const lowStock =
    product.kind === "PHYSICAL" &&
    !soldOut &&
    product.fulfillment !== "SUPPLIER" &&
    product.stock != null &&
    product.stock > 0 &&
    lowStockThreshold != null &&
    product.stock <= lowStockThreshold;
  const alisverisAcik = alisverisYapabilir(user?.role_id);
  // D&R gibi: platform ürününde satıcı adı gösterilmez; yalnız eğitmen (çok-satıcılı) üründe.
  const showSeller = product.seller_type === "TUTOR" && !!product.tutor_name;
  const subtitle = [product.author, product.publisher].filter(Boolean).join(" · ");
  const isFav = favItems.some((i) => i.id === product.id);

  function addToCart() {
    add(product!, 1);
    toast.success("Sepete eklendi");
  }

  // "Şimdi Al": sepete ekle + doğrudan ödemeye git (giriş/adres gerekirse checkout yönlendirir).
  function buyNow() {
    add(product!, 1);
    navigate(ROUTES.storeCheckout);
  }

  // Paylaş: native paylaşım varsa onu, yoksa bağlantıyı panoya kopyala.
  async function shareProduct() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: product!.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Bağlantı kopyalandı");
      }
    } catch {
      /* kullanıcı paylaşımı iptal etti — sessiz geç */
    }
  }

  const specRows = buildSpecRows(product);
  // Alış kutusu yakınında öne çıkan birkaç künye (yazar/yayınevi başlıkta zaten var).
  const highlightRows = specRows
    .filter((r) => r.key !== "author" && r.key !== "publisher")
    .slice(0, 4);

  // Sekmeler — "Ürün Açıklaması" (serbest metin + künye birlikte) yalnız içerik varsa görünür.
  const hasAbout = !!product.description || specRows.length > 0;
  const tabDefs: { key: DetailTab; label: string }[] = [
    ...(hasAbout ? [{ key: "about" as const, label: "Ürün Açıklaması" }] : []),
    { key: "reviews" as const, label: "Değerlendirmeler" },
    { key: "policy" as const, label: "İptal ve İade" },
  ];
  const activeTab = tabDefs.some((t) => t.key === tab) ? tab : tabDefs[0].key;

  function openReviews() {
    setTab("reviews");
    document.getElementById("urun-sekmeler")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // schema.org: künye doluysa Product + Book çoklu-tip (offers + kitap meta).
  const isBook = specRows.length > 0;
  const bookProps = isBook
    ? {
        ...(product.author ? { author: { "@type": "Person", name: product.author } } : {}),
        ...(product.publisher ? { publisher: product.publisher } : {}),
        ...(product.isbn ? { isbn: product.isbn } : {}),
        ...(product.page_count ? { numberOfPages: product.page_count } : {}),
        ...(product.language ? { inLanguage: product.language } : {}),
        ...(product.edition ? { bookEdition: product.edition } : {}),
        ...(product.publication_year ? { datePublished: String(product.publication_year) } : {}),
      }
    : {};

  return (
    <StoreLayout title={product.title}>
      <Seo
        title={`${product.title}, Mağaza`}
        description={product.description ?? undefined}
        type="article"
        image={product.cover_url ?? undefined}
      >
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": isBook ? ["Product", "Book"] : "Product",
            name: product.title,
            description: product.description ?? undefined,
            image: gallery,
            ...bookProps,
            offers: {
              "@type": "Offer",
              price: Number(product.price),
              priceCurrency: product.currency,
              availability: soldOut
                ? "https://schema.org/OutOfStock"
                : "https://schema.org/InStock",
            },
            ...(product.rating_count > 0 && product.rating_average
              ? {
                  aggregateRating: {
                    "@type": "AggregateRating",
                    ratingValue: product.rating_average.toFixed(1),
                    reviewCount: product.rating_count,
                  },
                }
              : {}),
          }}
        />
      </Seo>

      <div className="mx-auto max-w-[76rem] px-4 py-6 md:px-0">
        {/* Breadcrumb — kategori zinciri */}
        <nav className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500 ">
          <Link to={ROUTES.store} className="hover:text-indigo-600 ">
            Mağaza
          </Link>
          {categoryTrail.map((c) => (
            <span key={c.id} className="flex items-center gap-1.5">
              <span className="text-slate-300 ">/</span>
              <Link
                to={`${ROUTES.store}?category=${c.id}`}
                className="hover:text-indigo-600 "
              >
                {c.name}
              </Link>
            </span>
          ))}
          <span className="text-slate-300 ">/</span>
          <span className="line-clamp-1 text-slate-700 ">{product.title}</span>
        </nav>

        <div className="mt-5 grid gap-10 md:grid-cols-2">
          {/* Galeri */}
          <div className="flex flex-col gap-3">
            {hero ? (
              <HoverZoomImage src={hero} alt={product.title} onOpen={() => setLightboxOpen(true)}>
                {/* Favori + paylaş — sağ üst köşe */}
                <div className="absolute right-3 top-3 z-10 flex gap-2">
                  <button
                    type="button"
                    aria-label={isFav ? "Favorilerden çıkar" : "Favorilere ekle"}
                    aria-pressed={isFav}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFav(product);
                    }}
                    className={`flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition-colors ${
                      isFav
                        ? "text-indigo-600 "
                        : "text-slate-400 hover:text-indigo-600 "
                    }`}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={isFav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Paylaş"
                    onClick={(e) => {
                      e.stopPropagation();
                      shareProduct();
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-indigo-600 "
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                  </button>
                </div>
              </HoverZoomImage>
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-2xl border border-slate-200 text-slate-300 ">
                Görsel yok
              </div>
            )}
            {gallery.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {gallery.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setActiveImg(url)}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-white p-1 transition-colors ${
                      hero === url ? "border-indigo-500 ring-1 ring-indigo-500" : "border-slate-200 hover:border-slate-300 "
                    }`}
                  >
                    <img src={url} alt="" className="h-full w-full object-contain mix-blend-multiply" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bilgi + fiyat + sepet */}
          <div className="flex flex-col">
            {showSeller && (
              <span className="text-sm text-slate-400 ">{product.tutor_name}</span>
            )}
            <h1 className="mt-1 text-2xl font-semibold leading-snug text-slate-900 ">
              {product.title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 text-sm text-slate-500 ">{subtitle}</p>
            )}

            {/* Değerlendirme — yalnız gerçek veride */}
            {product.rating_count > 0 ? (
              <div className="mt-3 flex items-center gap-2">
                <StarRating value={product.rating_average ?? 0} />
                <span className="text-sm font-medium text-slate-700 ">
                  {product.rating_average?.toFixed(1)}
                </span>
                <button
                  type="button"
                  onClick={openReviews}
                  className="text-sm text-slate-500 hover:text-indigo-600 hover:underline "
                >
                  {product.rating_count} değerlendirme
                </button>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-400">Henüz değerlendirme yok</div>
            )}

            {/* Varyant seçici — kardeşler; görsel değişimi ek iş istemez,
                seçim kardeşin SAYFASINA gider ve görseller ürün başınadır. */}
            {product.variants && product.variants.members.length > 1 && (
              <VariantPicker variants={product.variants} currentId={product.id} />
            )}

            {/* Fiyat */}
            <div className="mt-6 flex items-baseline gap-3">
              <span className="text-3xl font-semibold text-slate-900 ">
                {formatTL(product.price)}
              </span>
              {product.compare_at_price &&
                Number(product.compare_at_price) > Number(product.price) && (
                  <span className="text-base text-slate-400 line-through">
                    {formatTL(product.compare_at_price)}
                  </span>
                )}
            </div>

            {product.kind === "PHYSICAL" && (soldOut || lowStock) && (
              <p className="mt-1 text-sm">
                {soldOut ? (
                  <span className="text-slate-500">Stokta yok</span>
                ) : (
                  <span className="font-medium text-amber-600 ">
                    Son {product.stock} ürün
                  </span>
                )}
              </p>
            )}

            {/* Tedarikçi stoğundan karşılanan ürün (D-2).
                Tek satır, nötr renk: bu bir uyarı değil, dürüst bir beklenti
                ayarı. Maliyet/marj BURADA GÖRÜNMEZ (D-6), `supplier` bloğu
                public yanıtta zaten boştur. */}
            {product.fulfillment === "SUPPLIER" && (
              <p className="mt-2 text-sm text-slate-500 ">
                Tedarikçi stoğundan temin edilir; teslim süresi biraz
                uzayabilir.
              </p>
            )}

            {/* Satın alma — Şimdi Al + Sepete Ekle (adet sepette seçilir) */}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled={soldOut}
                onClick={buyNow}
                className="flex h-12 flex-1 items-center justify-center rounded-lg bg-indigo-600 px-8 text-base font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 "
              >
                {soldOut ? "Tükendi" : "Şimdi Al"}
              </button>
              <button
                type="button"
                disabled={soldOut}
                onClick={addToCart}
                className="flex h-12 flex-1 items-center justify-center rounded-lg border border-indigo-600 px-8 text-base font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 "
              >
                Sepete Ekle
              </button>
            </div>

            {soldOut && product.kind === "PHYSICAL" && (
              <BackInStockForm productId={product.id} />
            )}

            {/* Teslimat & satıcı — kutu yok, saç-teli ayraçlı, yalnız gerçek bilgi */}
            <div className="mt-8 space-y-3 border-t border-slate-100 pt-6 text-sm ">
              {/*
                Tedarikçiden temin edilen üründe AYNI GÜN sözü VERİLMEZ.

                `DeliveryPromiseBadge` sözü yalnız 16:00 cutoff'undan üretir;
                stoğu hiç bilmez. Bu, tedarikçi katmanından ÖNCE sorun
                değildi: rafta olmayan ürün zaten satın alınamıyordu ve rozet
                hiç görünmüyordu. Artık görünebiliyor ve "bugün kapında"
                diyor, oysa mal Yıldırım'dan getirilecek.

                Yıldırım'ın hazırlık/teslim süresi HENÜZ BİLİNMİYOR (rapor
                §4 açık konu 1) ve 1.000 TL minimum sipariş kuralı toplu alım
                gerektiriyor. Doğru süreyi bilmeden bir gün yazmak, yanlış
                sözü başka bir yanlış sözle değiştirmek olurdu; bu yüzden söz
                GİZLENİR ve yukarıdaki nötr tedarikçi notu tek başına kalır.
                Borç: TB-77.
              */}
              {product.kind === "PHYSICAL" && product.fulfillment !== "SUPPLIER" ? (
                <DeliveryPromiseBadge />
              ) : product.kind === "PHYSICAL" ? (
                <div className="flex items-start gap-2.5 text-slate-600 ">
                  <svg
                    className="mt-0.5 shrink-0 text-slate-400"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <rect x="1" y="3" width="15" height="13" rx="1.5" />
                    <path d="M16 8h4l3 3v5h-7z" />
                    <circle cx="5.5" cy="18.5" r="2" />
                    <circle cx="18.5" cy="18.5" r="2" />
                  </svg>
                  <span>
                    Tedarikçiden temin edilir; teslim tarihi sipariş sonrası
                    bildirilir.
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 text-slate-600 ">
                  <svg className="mt-0.5 shrink-0 text-slate-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <polyline points="13 2 13 9 20 9" />
                  </svg>
                  <span>
                    Ödeme onayından sonra{" "}
                    <span className="font-medium text-slate-900 ">anında indirme</span> ile dijital teslimat.
                  </span>
                </div>
              )}
              {showSeller && (
                <div className="flex items-center gap-2.5 text-slate-600 ">
                  <svg className="shrink-0 text-slate-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span>
                    Satıcı:{" "}
                    <Link
                      to={ROUTES.storeSeller(product.tutor_id!)}
                      className="font-medium text-indigo-600 hover:underline "
                    >
                      {product.tutor_name}
                    </Link>
                  </span>
                </div>
              )}
            </div>

            {/* Öne çıkan bilgiler (kompakt künye) */}
            {highlightRows.length > 0 && (
              <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 ">
                {highlightRows.map((r) => (
                  <div key={r.key} className="flex justify-between gap-3">
                    <dt className="text-slate-400 ">{r.label}</dt>
                    <dd className="text-right font-medium text-slate-700 ">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        {/* Sekmeler: Açıklama / Özellikler / Değerlendirmeler */}
        <div id="urun-sekmeler" className="mt-12 scroll-mt-24 border-b border-slate-200 ">
          <div className="flex flex-wrap gap-6">
            {tabDefs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 pb-3 text-sm font-medium transition-colors ${
                  activeTab === t.key
                    ? "border-indigo-600 text-slate-900 "
                    : "border-transparent text-slate-500 hover:text-slate-900 "
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-6">
          {activeTab === "about" && (
            <div className="space-y-8">
              {product.description && (
                <div className="whitespace-pre-line text-sm leading-relaxed text-slate-700 ">
                  {product.description}
                </div>
              )}
              {specRows.length > 0 && (
                <dl className="max-w-xl divide-y divide-slate-100 ">
                  {specRows.map((r) => (
                    <div key={r.key} className="flex justify-between gap-6 py-2.5 text-sm">
                      <dt className="text-slate-500 ">{r.label}</dt>
                      <dd className="text-right font-medium text-slate-800 ">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}

          {activeTab === "policy" && <PolicyPanel kind={product.kind} />}

          {activeTab === "reviews" && (
            <div>
              {distribution && distribution.count > 0 && (
                <div className="mb-5">
                  <RatingHistogram data={distribution} />
                </div>
              )}
              {alisverisAcik && <ReviewForm productId={product.id} />}
              <div className="mt-5 space-y-5">
                {reviews && reviews.length > 0 ? (
                  reviews.map((r) => (
                    <div key={r.id} className="border-b border-slate-100 pb-4 ">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800 ">
                          {r.client_name ?? "Müşteri"}
                        </span>
                        <StarRating value={r.rating} />
                      </div>
                      {r.comment_text && (
                        <p className="mt-1.5 text-sm text-slate-600 ">
                          {r.comment_text}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Henüz değerlendirme yok.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Benzer ürünler */}
        {related.length > 0 && (
          <div className="mt-12 border-t border-slate-100 pt-8 ">
            <h2 className="mb-6 text-lg font-semibold text-slate-900 ">
              Benzer ürünler
            </h2>
            <div className="hide-scrollbar flex snap-x gap-4 overflow-x-auto pb-4">
              {related.map((p) => (
                <div key={p.id} className="w-[160px] shrink-0 snap-start md:w-[200px]">
                  <ProductCard product={p} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Daha fazlasını keşfet — kategori çipleri */}
        {discoverChips.length > 0 && (
          <div className="mt-12 border-t border-slate-100 pt-8 ">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 ">
              Daha fazlasını keşfet
            </h2>
            <div className="flex flex-wrap gap-2">
              {discoverChips.map((c) => (
                <Link
                  key={c.id}
                  to={`${ROUTES.store}?category=${c.id}`}
                  className="rounded-full border border-slate-200 px-3.5 py-1.5 text-sm text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 "
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Görsel büyütme (lightbox) — navbar backdrop-blur'ü bozmasın diye body'ye portal */}
      {lightboxOpen && hero &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
            onClick={() => setLightboxOpen(false)}
          >
            <button
              type="button"
              aria-label="Kapat"
              onClick={() => setLightboxOpen(false)}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            {gallery.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Önceki"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveImg(gallery[(heroIndex - 1 + gallery.length) % gallery.length]);
                  }}
                  className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <button
                  type="button"
                  aria-label="Sonraki"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveImg(gallery[(heroIndex + 1) % gallery.length]);
                  }}
                  className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </>
            )}
            <img
              src={hero}
              alt={product.title}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] max-w-[90vw] object-contain"
            />
          </div>,
          document.body
        )}
    </StoreLayout>
  );
}

/** Kardeş varyant seçici. Eksen adları GRUPTAN gelir (option1/2_name); seçim
 *  kardeşin sayfasına Link ile gider. Tükenen kardeş tıklanabilir kalır ama
 *  "Tükendi" işaretlidir — o sayfada stok bildirimi formu var.
 */
function VariantPicker({
  variants,
  currentId,
}: {
  variants: ProductVariants;
  currentId: number;
}) {
  const baslik = variants.option2_name
    ? `${variants.option1_name} / ${variants.option2_name}`
    : variants.option1_name;
  return (
    <div className="mt-6">
      <p className="mb-2 text-sm font-medium text-slate-700 ">
        {baslik}
      </p>
      <div className="flex flex-wrap gap-2">
        {variants.members.map((m) => {
          const etiket = [m.option1_value, m.option2_value]
            .filter(Boolean)
            .join(" / ");
          const aktif = m.id === currentId;
          return (
            <Link
              key={m.id}
              to={ROUTES.storeProduct(m.slug)}
              aria-current={aktif ? "true" : undefined}
              className={`relative rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                aktif
                  ? "border-indigo-600 text-indigo-600 ring-1 ring-indigo-600 "
                  : "border-slate-200 text-slate-700 hover:border-slate-300 "
              } ${!m.in_stock ? "opacity-60" : ""}`}
            >
              {etiket || m.title}
              {!m.in_stock && (
                <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                  · Tükendi
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function PolicyPanel({ kind }: { kind: ProductKind }) {
  return (
    <div className="max-w-2xl space-y-4 text-sm leading-relaxed text-slate-600 ">
      {kind === "PHYSICAL" ? (
        <>
          <p>
            <span className="font-medium text-slate-900 ">Cayma hakkı:</span>{" "}
            Fiziksel ürünlerde teslim tarihinden itibaren 14 gün içinde, ürünü kullanılmamış ve
            yeniden satılabilir durumda iade ederek siparişinizi iptal edebilirsiniz.
          </p>
          <p>
            <span className="font-medium text-slate-900 ">İade süreci:</span>{" "}
            İade onaylandığında tutar, ödemenin yapıldığı karta iyzico üzerinden iade edilir
            (bankanıza bağlı olarak genellikle 7-14 iş günü).
          </p>
        </>
      ) : (
        <p>
          <span className="font-medium text-slate-900 ">Dijital ürün:</span>{" "}
          Ödeme onayından sonra anında erişime açılan dijital içeriklerde, içeriğe erişim
          sağlandıktan sonra cayma hakkı kullanılamaz (Mesafeli Sözleşmeler Yönetmeliği m.15/1-ğ).
        </p>
      )}
      <p className="text-slate-500 ">
        Ayrıntılar için{" "}
        <Link to={ROUTES.refundPolicy} className="font-medium text-indigo-600 hover:underline ">
          İptal ve İade Politikası
        </Link>{" "}
        ve{" "}
        <Link to={ROUTES.terms} className="font-medium text-indigo-600 hover:underline ">
          Kullanım Koşulları
        </Link>{" "}
        sayfalarını inceleyebilirsiniz.
      </p>
    </div>
  );
}

function BackInStockForm({ productId }: { productId: number }) {
  const user = useAuthStore((s) => s.user);
  const [email, setEmail] = useState(user?.email ?? "");
  const [done, setDone] = useState(false);
  const notify = useNotifyWhenInStock(productId);

  if (done) {
    return (
      <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ">
        Stoğa girince <span className="font-medium">{email}</span> adresine haber vereceğiz.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          toast.error("Geçerli bir e-posta gir");
          return;
        }
        notify.mutate(email, {
          onSuccess: () => setDone(true),
          onError: (err: unknown) => {
            const detail =
              (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
              "Kayıt başarısız";
            toast.error(detail);
          },
        });
      }}
      className="mt-4 rounded-xl border border-slate-200 p-4 "
    >
      <p className="mb-2 text-sm font-medium text-slate-700 ">
        Tükendi, gelince haber verelim mi?
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-posta adresin"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
        />
        <button
          type="submit"
          disabled={notify.isPending}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          Haber ver
        </button>
      </div>
    </form>
  );
}

function ReviewForm({ productId }: { productId: number }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const create = useCreateProductReview(productId);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          { rating, comment_text: comment || null },
          {
            onSuccess: () => {
              toast.success("Değerlendirmeniz eklendi");
              setComment("");
            },
            onError: (err: unknown) => {
              const detail =
                (err as { response?: { data?: { detail?: string } } })?.response
                  ?.data?.detail ?? "Değerlendirme eklenemedi";
              toast.error(detail);
            },
          }
        );
      }}
      className="mt-4 rounded-xl border border-slate-200 p-4 "
    >
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-600 ">Puanın:</span>
        <select
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
          className="rounded-lg border border-slate-200 px-2 py-1 text-sm "
        >
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} yıldız
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Yorumun (opsiyonel)"
        rows={2}
        className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
      />
      <button
        type="submit"
        disabled={create.isPending}
        className="mt-2 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        Gönder
      </button>
    </form>
  );
}
