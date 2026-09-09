import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { magazaAramaAdresi } from "@/lib/aramaUrl";
import { Seo } from "@/components/Seo";
import { JsonLd } from "@/components/JsonLd";
import { StarRating } from "@/components/StarRating";
import { RatingHistogram } from "@/components/store/RatingHistogram";
import { ProductCard } from "@/components/store/ProductCard";
import { HoverZoomImage } from "@/components/store/HoverZoomImage";
import { FullScreenSpinner } from "@/components/Spinner";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { buildSpecGroups, buildSpecRows } from "@/lib/productSpecs";
import { buildProductJsonLd } from "@/lib/productJsonLd";
import { shippingConfig, shippingFor } from "@/lib/shipping";
import { CAYMA_HAKKI_GUN } from "@/lib/storePolicy";
import {
  buildAxes,
  istenenCoz,
  karsilanmayanSecim,
  seciciGosterilsin,
} from "@/lib/variantAxes";
import { promiseText } from "@/lib/deliveryPromise";
import { PriceBlock } from "@/components/store/PriceBlock";
import { VariantSelector } from "@/components/store/VariantSelector";
import { StickyBuyBar } from "@/components/store/StickyBuyBar";
import { MiniCartDrawer } from "@/components/store/MiniCartDrawer";
import { useDeliveryInfo } from "@/hooks/useDelivery";
import { useModalA11y } from "@/hooks/useModalA11y";
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
import type { ProductCategory, ProductKind } from "@/types";
import { toast } from "@/store/toastStore";

// Düşük stok eşiği burada SABİT DEĞİL: sunucudan (`GET /store/config`)
// okunur. Tek kaynak `backend/core/stock_policy.py`; vitrinin kendi kopyasını
// taşıması, eşik değiştiğinde yönetim listesiyle vitrinin farklı aciliyet
// göstermesine yol açardı (audit P1-2 — eşik 3'e çekilse bile vitrin "Son 4
// ürün" demeye devam ediyordu).

type DetailTab = "about" | "reviews" | "policy";

/** Zengin açıklama tipografisi — blog gövdesinin mağaza ölçeğindeki karşılığı.
 *  Sunucu allowlist'i ne üretiyorsa yalnız onlar biçimlendirilir. */
const ACIKLAMA_SINIFI = [
  "text-sm leading-relaxed text-slate-700",
  "[&_p]:mt-3",
  "[&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900",
  "[&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-slate-900",
  "[&_h4]:mt-4 [&_h4]:font-semibold [&_h4]:text-slate-900",
  "[&_a]:font-medium [&_a]:text-marka-metin [&_a]:underline [&_a]:underline-offset-2",
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1",
  "[&_blockquote]:mt-4 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-4 [&_blockquote]:italic",
  "[&_hr]:my-6 [&_hr]:border-slate-200",
].join(" ");

/** Kategori linki — breadcrumb, keşif çipleri ve BreadcrumbList markup'ı AYNI
 *  kaynaktan üretsin diye tek yerde. Markup ile ekranın ayrışması Google'ın
 *  yapılandırılmış veri politikasının ihlali sayılır. */
const categoryChipHref = (categoryId: number) =>
  magazaAramaAdresi({ kategori: categoryId });

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: product, isLoading, isError } = useProduct(slug);
  const { data: storeConfig } = useStoreConfig();
  const lowStockThreshold = storeConfig?.low_stock_threshold;
  const { data: reviews } = useProductReviews(product?.id);
  const { data: distribution } = useProductRatingDistribution(product?.id);
  const { data: categories } = useCategories();
  const { data: deliveryInfo } = useDeliveryInfo();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const add = useCartStore((s) => s.add);
  const toggleFav = useFavoritesStore((s) => s.toggle);
  const favItems = useFavoritesStore((s) => s.items);
  const user = useAuthStore((s) => s.user);
  const [activeImg, setActiveImg] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("about");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Lightbox erişilebilirliği ortak kancadan: odak tuzağı, Esc (pencere
  // yığınına saygılı), kaydırma kilidi ve kapanınca odağın tetikleyiciye
  // dönmesi. Bunların hiçbiri elle yazılmış hâlinde yoktu.
  const lightboxPanelRef = useRef<HTMLDivElement>(null);
  // Mobil sabit çubuk yalnız ASIL düğme ekrandan çıkınca görünür.
  const sepetDugmesiRef = useRef<HTMLButtonElement>(null);
  const [miniSepetAcik, setMiniSepetAcik] = useState(false);
  useModalA11y({
    open: lightboxOpen,
    onClose: () => setLightboxOpen(false),
    panelRef: lightboxPanelRef,
  });

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

  // Lightbox'ta ←/→ ile galeride gezinme.
  //
  // Esc BURADA ELE ALINMAZ: kapatmayı `useModalA11y` üstlenir. O kanca açık
  // pencereleri bir yığında tutar ve klavye olayını yalnız EN ÜSTTEKİ pencere
  // işler; kendi Esc dinleyicimizi eklemek iç içe pencerelerde iki kapanışa
  // yol açardı.
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!product) return;
      const g = [
        ...(product.cover_url ? [product.cover_url] : []),
        ...product.images.map((i) => i.url),
      ];
      // (aynı sıra `galleryUrls` ile; burada erken-dönüş öncesi hesaplanıyor)
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

  // Galeri öğesi ARTIK kendi alt metnini taşır: sekiz görselin sekizi de
  // "ürün başlığı" diye okunduğunda ekran okuyucu kullanıcısı aralarında ayrım
  // yapamıyordu. Alt metin boşsa başlığa düşülür — sözlük dolmadan da bozulmaz.
  const gallery = [
    ...(product.cover_url
      ? [{ url: product.cover_url, alt: product.title }]
      : []),
    ...product.images.map((i) => ({
      url: i.url,
      alt: i.alt_text?.trim() || product.title,
    })),
  ];
  const galleryUrls = gallery.map((g) => g.url);
  const hero = activeImg ?? galleryUrls[0] ?? null;
  const heroIndex = Math.max(0, galleryUrls.indexOf(hero ?? ""));
  const heroAlt =
    gallery.find((g) => g.url === hero)?.alt ?? product.title;
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
    // Toast yerine çekmece: "sepete eklendi" tek başına hangi varyantın
    // gittiğini söylemez ve üç yoldan (devam / sepet / ödeme) hiçbirini açmaz.
    // Ekran okuyucu için duyuru çekmecenin kendi `role="dialog"` adıyla gelir.
    setMiniSepetAcik(true);
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

  // ── Varyant eksenleri ──
  //
  // Seçici tek üyeli grupta hiç çizilmez: tek şıklı bir "seçim" karar değildir.
  const eksenler = seciciGosterilsin(product.variants)
    ? buildAxes(product.variants!, product.id)
    : null;
  // Karşılanamayan seçim bağlantıdan gelir (`?istenen=Ebat:M`) — varış sayfası
  // ne kaybedildiğini bilmeden açıklayamazdı.
  const kayipMesaji = eksenler
    ? karsilanmayanSecim(eksenler, istenenCoz(searchParams.get("istenen")))
    : null;

  // ── Teslimat sözü ──
  //
  // Söz YALNIZ kendi stoğumuzdaki fiziksel üründe verilir. Tedarikçiden temin
  // edilen üründe hazırlık süresi bilinmiyor (TB-77) ve "yarın kapında" demek
  // tutulamayacak bir söz olurdu; o dalda aşağıdaki nötr not tek başına kalır.
  const teslimatMetni =
    product.kind === "PHYSICAL" &&
    product.fulfillment !== "SUPPLIER" &&
    deliveryInfo
      ? promiseText(deliveryInfo)
      : null;

  // Sabit çubukta hangi varyantın sepete gideceği görünsün.
  const varyantOzeti =
    [product.option1_value, product.option2_value].filter(Boolean).join(" · ") ||
    null;

  const specRows = buildSpecRows(product);
  // Tam künye tablosu: gruplu + yönetilen nitelikler dahil. Nitelikler bugüne
  // dek yönetimden GİRİLEBİLİYOR ama vitrine hiç çıkmıyordu.
  const specGroups = buildSpecGroups(product, product.attributes ?? []);
  // Alış kutusu yakınında öne çıkan birkaç künye (yazar/yayınevi başlıkta zaten var).
  const highlightRows = specRows
    .filter((r) => r.key !== "author" && r.key !== "publisher")
    .slice(0, 4);

  // Sekmeler — "Ürün Açıklaması" (serbest metin + künye birlikte) yalnız içerik varsa görünür.
  const hasAbout = !!product.description || specGroups.length > 0;
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

  // schema.org: künye doluysa Product + Book çoklu-tip. Markup saf modülden
  // üretilir (`lib/productJsonLd.ts`) — orada test edilebiliyor ve sayfada
  // görünen değerlerle aynı kaynaktan besleniyor.
  const jsonLd = buildProductJsonLd({
    product,
    gallery: galleryUrls,
    categoryTrail,
    canonicalPath: ROUTES.storeProduct(product.slug),
    storePath: ROUTES.store,
    categoryHref: categoryChipHref,
    isBook: specRows.length > 0,
    // Markup'taki kargo tutarı EKRANDAKİYLE aynı kaynaktan; dijitalde gönderi
    // olmadığı için null geçilir.
    shippingRate:
      product.kind === "PHYSICAL"
        ? shippingFor(Number(product.price), shippingConfig(storeConfig))
        : null,
  });

  return (
    <StoreLayout title={product.title}>
      <Seo
        title={`${product.title}, Mağaza`}
        description={product.description ?? undefined}
        type="product"
        image={product.cover_url ?? undefined}
      >
        <JsonLd data={jsonLd} />
      </Seo>

      <div className="mx-auto max-w-[76rem] px-4 py-6 md:px-0">
        {/* Breadcrumb — kategori zinciri */}
        <nav className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500 ">
          <Link to={ROUTES.store} className="hover:text-marka-metin ">
            Mağaza
          </Link>
          {categoryTrail.map((c) => (
            <span key={c.id} className="flex items-center gap-1.5">
              <span className="text-slate-300 ">/</span>
              <Link to={categoryChipHref(c.id)} className="hover:text-marka-metin ">
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
            {/* Mobil galeri: tam genişlik, parmakla kaydırmalı şerit + konum
                sayacı. Masaüstündeki küçük resim şeridi mobilde yer israfıydı
                ve hero'yu değiştirmenin TEK yolu ona dokunmaktı — kullanıcılar
                galeriyi büyük oranda kaçırıyordu. */}
            {hero && (
              <div className="md:hidden">
                <ul className="flex snap-x snap-mandatory gap-2 overflow-x-auto">
                  {gallery.map((g, i) => (
                    <li
                      key={g.url}
                      className="w-full shrink-0 snap-center"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveImg(g.url);
                          setLightboxOpen(true);
                        }}
                        aria-label={`${g.alt}: büyüt`}
                        className="block aspect-square w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-6"
                      >
                        <img
                          src={g.url}
                          alt={g.alt}
                          // İlk görsel mobilde LCP ögesidir: tembel YÜKLENMEZ.
                          {...(i === 0
                            ? { fetchpriority: "high" }
                            : { loading: "lazy" as const })}
                          decoding="async"
                          className="h-full w-full object-contain mix-blend-multiply"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
                {gallery.length > 1 && (
                  <p className="mt-2 text-center text-xs text-slate-400">
                    {gallery.length} görsel · kaydırarak gezin
                  </p>
                )}
              </div>
            )}

            {hero ? (
              <div className="hidden md:block">
              <HoverZoomImage src={hero} alt={heroAlt} onOpen={() => setLightboxOpen(true)}>
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
                        ? "text-marka-metin "
                        : "text-slate-400 hover:text-marka-metin "
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
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-marka-metin "
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
              </div>
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-2xl border border-slate-200 text-slate-300 ">
                Görsel yok
              </div>
            )}
            {gallery.length > 1 && (
              <div className="hidden gap-2 overflow-x-auto pb-1 md:flex">
                {gallery.map((g, i) => (
                  <button
                    key={g.url}
                    type="button"
                    onClick={() => setActiveImg(g.url)}
                    aria-label={`${i + 1}. görsel: ${g.alt}`}
                    aria-current={hero === g.url ? "true" : undefined}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-white p-1 transition-colors ${
                      hero === g.url ? "border-marka-mid ring-1 ring-marka-focus" : "border-slate-200 hover:border-slate-300 "
                    }`}
                  >
                    <img
                      src={g.url}
                      alt=""
                      width={64}
                      height={64}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain mix-blend-multiply"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bilgi + fiyat + sepet.
              Masaüstünde bu kolon SABİTLENİR: galeri kaydırılırken satın alma
              kararı ekranda kalır. `self-start` olmadan kolon grid hücresinin
              tam yüksekliğine uzar ve `sticky` hiç tutmaz. */}
          <div className="flex flex-col md:sticky md:top-24 md:self-start">
            {showSeller && (
              <span className="text-sm text-slate-400 ">{product.tutor_name}</span>
            )}
            {product.brand && (
              <p className="text-sm font-medium text-slate-600">{product.brand}</p>
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
                  className="text-sm text-slate-500 hover:text-marka-metin hover:underline "
                >
                  {product.rating_count} değerlendirme
                </button>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-400">Henüz değerlendirme yok</div>
            )}

            {/* Varyant seçici — eksen bazlı ızgara. Seçim kardeşin SAYFASINA
                gider (her varyantın kendi slug'ı ve kanonik URL'i var);
                görseller zaten ürün başınadır. Mantık `lib/variantAxes`te. */}
            {eksenler && <VariantSelector axes={eksenler} />}

            {/* Karşılanamayan seçim SESSİZ geçilmez: kullanıcı "M" ebadındayken
                "Mavi"ye geçtiyse ve mavi M üretilmiyorsa ne olduğunu okur. */}
            {kayipMesaji && (
              <p role="status" className="mt-2 text-sm text-amber-700">
                {kayipMesaji}
              </p>
            )}

            <PriceBlock
              product={product}
              config={storeConfig}
              lowStock={lowStock}
              deliveryText={teslimatMetni}
            />

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
                className="flex h-12 flex-1 items-center justify-center rounded-lg bg-marka px-8 text-base font-semibold text-marka-fg transition-colors hover:bg-marka-hover disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 "
              >
                {soldOut ? "Tükendi" : "Şimdi Al"}
              </button>
              <button
                ref={sepetDugmesiRef}
                type="button"
                disabled={soldOut}
                onClick={addToCart}
                className="flex h-12 flex-1 items-center justify-center rounded-lg border border-marka px-8 text-base font-semibold text-marka-soft-fg transition-colors hover:bg-marka-soft disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 "
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

                Söz yalnız 16:00 cutoff'undan üretilir ve stoğu hiç bilmez. Bu,
                tedarikçi katmanından ÖNCE sorun değildi: rafta olmayan ürün
                zaten satın alınamıyordu ve söz hiç görünmüyordu. Artık
                görünebiliyor ve "bugün kapında" diyor, oysa mal Yıldırım'dan
                getirilecek.

                Yıldırım'ın hazırlık/teslim süresi HENÜZ BİLİNMİYOR (rapor
                §4 açık konu 1) ve 1.000 TL minimum sipariş kuralı toplu alım
                gerektiriyor. Doğru süreyi bilmeden bir gün yazmak, yanlış
                sözü başka bir yanlış sözle değiştirmek olurdu; bu yüzden söz
                GİZLENİR ve aşağıdaki nötr tedarikçi notu tek başına kalır.
                Borç: TB-77.

                KENDİ STOĞUMUZDAKİ fiziksel ürünün teslim TARİHİ artık fiyat
                bloğunda (`PriceBlock`) yazıyor; burada ikinci bir teslimat
                satırı çizmek aynı bilgiyi iki kez söylemek olurdu.
              */}
              {product.kind === "PHYSICAL" ? (
                product.fulfillment === "SUPPLIER" ? (
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
                ) : null
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
                      className="font-medium text-marka-metin hover:underline "
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
                    ? "border-marka text-slate-900 "
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
              {/* Açıklama zengin metin OLABİLİR (TipTap).
                  `dangerouslySetInnerHTML` yalnız SUNUCUDA temizlenmiş içerikle
                  kullanılır: `store_service._temiz_aciklama` her yazma yolunda
                  `core/html_sanitize` allowlist'inden geçirir ve bunun kapsamı
                  `test_urun_aciklama_sanitize.py` ile nöbetlidir.

                  Etiket taşımayan (eski, düz metin) açıklamalar HTML olarak
                  basılırsa satır sonları kaybolurdu; o yüzden düz metin dalı
                  `whitespace-pre-line` ile korunuyor. Göç gerekmiyor. */}
              {product.description &&
                (/<[a-z][\s\S]*>/i.test(product.description) ? (
                  <div
                    className={ACIKLAMA_SINIFI}
                    dangerouslySetInnerHTML={{ __html: product.description }}
                  />
                ) : (
                  <div className="whitespace-pre-line text-sm leading-relaxed text-slate-700 ">
                    {product.description}
                  </div>
                ))}
              {/* Künye TEK KOLON kalır: iki kolonlu bir özellik tablosu
                  kullanıcılar tarafından ürün KARŞILAŞTIRMASI sanılıyor ve
                  veri yanlış okunuyor. Gruplar taramayı, zebra satırlar
                  etiketten değere yatay izi kolaylaştırıyor. */}
              {specGroups.length > 0 && (
                <div className="max-w-xl space-y-6">
                  {specGroups.map((grup) => (
                    <section key={grup.key}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {grup.title}
                      </h3>
                      <dl className="mt-2">
                        {grup.rows.map((r) => (
                          <div
                            key={r.key}
                            className="flex justify-between gap-6 rounded px-2 py-2 text-sm odd:bg-slate-50"
                          >
                            <dt className="text-slate-500">{r.label}</dt>
                            <dd className="text-right font-medium text-slate-800">
                              {r.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
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
                  to={categoryChipHref(c.id)}
                  className="rounded-full border border-slate-200 px-3.5 py-1.5 text-sm text-slate-600 transition-colors hover:border-marka-mid hover:text-marka-metin "
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <MiniCartDrawer
        open={miniSepetAcik}
        onClose={() => setMiniSepetAcik(false)}
        product={product}
        variantOzeti={varyantOzeti}
        shipping={shippingConfig(storeConfig)}
      />

      <StickyBuyBar
        price={product.price}
        label={soldOut ? "Tükendi" : "Sepete Ekle"}
        disabled={soldOut}
        variantOzeti={varyantOzeti}
        onAdd={addToCart}
        anchorRef={sepetDugmesiRef}
      />

      {/* Görsel büyütme (lightbox) — navbar backdrop-blur'ü bozmasın diye body'ye portal */}
      {lightboxOpen && hero &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
            onClick={() => setLightboxOpen(false)}
          >
            <div
              ref={lightboxPanelRef}
              role="dialog"
              aria-modal="true"
              aria-label={`${product.title}: görsel önizleme`}
              className="relative flex h-full w-full items-center justify-center"
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
                    setActiveImg(galleryUrls[(heroIndex - 1 + galleryUrls.length) % galleryUrls.length]);
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
                    setActiveImg(galleryUrls[(heroIndex + 1) % galleryUrls.length]);
                  }}
                  className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </>
            )}
            <img
              src={hero}
              alt={heroAlt}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] max-w-[90vw] touch-pinch-zoom object-contain"
            />
            </div>
          </div>,
          document.body
        )}
    </StoreLayout>
  );
}

function PolicyPanel({ kind }: { kind: ProductKind }) {
  return (
    <div className="max-w-2xl space-y-4 text-sm leading-relaxed text-slate-600 ">
      {kind === "PHYSICAL" ? (
        <>
          <p>
            <span className="font-medium text-slate-900 ">Cayma hakkı:</span>{" "}
            Fiziksel ürünlerde teslim tarihinden itibaren {CAYMA_HAKKI_GUN} gün içinde, ürünü kullanılmamış ve
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
        <Link to={ROUTES.refundPolicy} className="font-medium text-marka-metin hover:underline ">
          İptal ve İade Politikası
        </Link>{" "}
        ve{" "}
        <Link to={ROUTES.terms} className="font-medium text-marka-metin hover:underline ">
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
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
        />
        <button
          type="submit"
          disabled={notify.isPending}
          className="shrink-0 rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition-colors hover:bg-marka-hover disabled:opacity-50"
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
        className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
      />
      <button
        type="submit"
        disabled={create.isPending}
        className="mt-2 rounded-lg bg-marka px-4 py-1.5 text-sm font-medium text-marka-fg transition-colors hover:bg-marka-hover disabled:opacity-50"
      >
        Gönder
      </button>
    </form>
  );
}
