import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";

// Küratörlü görünüm preset'leri (CMS Faz 2) — editör canvas'ıyla ortak harita.
import {
  ZENGIN_METIN_SINIFI,
  bannerBoySinifi,
  bolumSinifi,
  gorunumOku,
  hizaSinifi,
  kolonSinifi,
} from "./gorunumSiniflari";

import { recordStorePageEvent } from "@/api/storeMerchandising";
import { HScroll } from "@/components/HScroll";
import { ProductCard } from "@/components/store/ProductCard";
import { PlainButton } from "@/components/ui/PlainButton";
import { getRecentlyViewedProducts } from "@/lib/recentlyViewedProducts";
import { ROUTES } from "@/lib/routes";
import type { LandingPage, LandingPageBlock } from "@/types";

// `w-full` ZORUNLU, süs değil: bu kap bir KOLON FLEX öğesi olarak render
// ediliyor ve çapraz eksende `mx-auto` (auto kenar boşluğu) flex `stretch`
// davranışını İPTAL eder. Stretch gidince kap içeriğine göre boyutlanır ve
// yatay kaydırmalı kart şeridinin max-content genişliğine (≈1360 px) büyür;
// telefonda sayfa 970 px taşar (ölçüldü: 360/390/414 px). Nöbetçi:
// `frontend/scripts/vitrin_mobil_kapisi.mjs`.
const CONTAINER = "mx-auto w-full max-w-[1464px] px-4 md:px-8";
const LandingEventTrackingContext = createContext(true);
type MediaItem = {
  image_url: string;
  mobile_image_url?: string | null;
  alt_text?: string;
  decorative?: boolean;
  link_url?: string | null;
  label?: string;
  fit?: "cover" | "contain";
  focal_x?: number;
  focal_y?: number;
};

type RenderEntry =
  | { kind: "block"; block: LandingPageBlock }
  | { kind: "compact-image-row"; blocks: LandingPageBlock[] };

function isStandaloneImageCard(block: LandingPageBlock): boolean {
  const cards = (block.config.cards as MediaItem[] | undefined) ?? [];
  return (
    block.block_type === "IMAGE_CARD_GRID" &&
    cards.filter((card) => card.image_url).length === 1
  );
}

export function groupLandingBlocksForRender(
  blocks: LandingPageBlock[],
): RenderEntry[] {
  const entries: RenderEntry[] = [];
  for (let index = 0; index < blocks.length; ) {
    const block = blocks[index];
    if (!isStandaloneImageCard(block)) {
      entries.push({ kind: "block", block });
      index += 1;
      continue;
    }
    const row: LandingPageBlock[] = [];
    while (index < blocks.length && isStandaloneImageCard(blocks[index])) {
      row.push(blocks[index]);
      index += 1;
    }
    if (row.length === 1) entries.push({ kind: "block", block: row[0] });
    else entries.push({ kind: "compact-image-row", blocks: row });
  }
  return entries;
}

export function StoreLandingBlocks({
  page,
  embedded = false,
  trackEvents = true,
}: {
  page: LandingPage;
  embedded?: boolean;
  trackEvents?: boolean;
}) {
  const isHome = page.page_type === "HOME";
  const hasHero = page.revision.blocks.some((block) => block.block_type === "HERO_CAROUSEL" && block.is_active);
  useEffect(() => {
    if (!trackEvents) return;
    void recordStorePageEvent(page.revision.id, {
      event_type: "PAGE_VIEW",
    }).catch(() => undefined);
  }, [page.revision.id, trackEvents]);

  return (
    <LandingEventTrackingContext.Provider value={trackEvents}>
      <div className={embedded ? "" : "pb-14"}>
      {page.state === "ENDED" && (
        <div className="border-y border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-950 ">
          Bu kampanya sona erdi. Sayfadaki güncel ürünleri ve kategorileri
          incelemeye devam edebilirsiniz.
        </div>
      )}
      <div className="flex flex-col gap-10 md:gap-14">
        {groupLandingBlocksForRender(page.revision.blocks).map(
          (entry, index) =>
            entry.kind === "compact-image-row" ? (
              <CompactImageRow
                key={entry.blocks.map((block) => block.block_key).join("-")}
                blocks={entry.blocks}
                revisionId={page.revision.id}
                homeOverlay={isHome && hasHero}
              />
            ) : (
              <Block
                key={entry.block.block_key}
                block={entry.block}
                revisionId={page.revision.id}
                priority={index === 0}
                isHome={isHome}
              />
            ),
        )}
      </div>
      </div>
    </LandingEventTrackingContext.Provider>
  );
}

function Block({
  block,
  revisionId,
  priority,
  isHome,
}: {
  block: LandingPageBlock;
  revisionId: number;
  priority: boolean;
  isHome: boolean;
}) {
  const icerik =
    block.block_type === "HERO_CAROUSEL" ? (
      <Hero block={block} revisionId={revisionId} priority={priority} isHome={isHome} />
    ) : block.block_type === "PRODUCT_RAIL" ? (
      <ProductRail block={block} revisionId={revisionId} />
    ) : block.block_type === "IMAGE_CARD_GRID" ? (
      <ImageGrid block={block} revisionId={revisionId} />
    ) : block.block_type === "CATEGORY_GRID" ? (
      <CategoryGrid block={block} revisionId={revisionId} />
    ) : block.block_type === "BANNER" ? (
      <Banner block={block} revisionId={revisionId} />
    ) : block.block_type === "RICH_TEXT" ? (
      <RichText block={block} revisionId={revisionId} />
    ) : block.block_type === "CARD_ROW" ? (
      <CardRow block={block} revisionId={revisionId} />
    ) : (
      <RecentlyViewed block={block} revisionId={revisionId} />
    );
  // Küratörlü görünüm: zemin/boşluk sarmalayıcısı. Ayar yokken sınıf boş —
  // eski kayıtlar piksel piksel bugünkü gibi kalır.
  const sarici = bolumSinifi(gorunumOku(block.config));
  return sarici ? <div className={sarici}>{icerik}</div> : icerik;
}

function Hero({
  block,
  revisionId,
  priority,
  isHome,
}: {
  block: LandingPageBlock;
  revisionId: number;
  priority: boolean;
  isHome: boolean;
}) {
  const slides = (
    (block.config.slides as MediaItem[] | undefined) ?? []
  ).filter((slide) => slide.image_url);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const next = useCallback(
    () => setActive((current) => (current + 1) % Math.max(slides.length, 1)),
    [slides.length],
  );
  useEffect(() => {
    if (
      paused ||
      slides.length < 2 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = window.setInterval(
      next,
      Number(block.config.autoplay_ms) || 6500,
    );
    return () => window.clearInterval(timer);
  }, [block.config.autoplay_ms, next, paused, slides.length]);
  if (!slides.length) return null;
  // Amazon deseni: `fade_bottom` açıkken hero alta doğru sayfa zeminine
  // karışır (gradient fade) — bindirmeli kart satırı üstüne oturur.
  const fade = Boolean(block.config.fade_bottom);
  return (
    <section
      aria-roledescription="carousel"
      aria-label={block.title || "Kampanya görselleri"}
      className="relative overflow-hidden"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div className={isHome ? "relative h-[430px] sm:h-[470px] lg:h-[540px]" : "relative h-[320px] sm:h-[440px] lg:h-[560px]"}>
        {slides.map((slide, index) => (
          <div
            key={`${slide.image_url}-${index}`}
            aria-hidden={index !== active}
            ref={(element) => {
              if (index !== active) element?.setAttribute("inert", "");
              else element?.removeAttribute("inert");
            }}
            className={`absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none ${index === active ? "opacity-100" : "pointer-events-none opacity-0"}`}
          >
            <TrackedLink
              to={slide.link_url}
              revisionId={revisionId}
              block={block}
              className="absolute inset-0"
            >
              <picture>
                {slide.mobile_image_url && (
                  <source
                    media="(max-width: 767px)"
                    srcSet={slide.mobile_image_url}
                  />
                )}
                <img
                  src={slide.image_url}
                  alt={slide.decorative ? "" : (slide.alt_text ?? "")}
                  loading={priority && index === 0 ? "eager" : "lazy"}
                  fetchPriority={priority && index === 0 ? "high" : "auto"}
                  // Eski `StoreHeroCarousel` bunu veriyordu; vitrin tek nesle
                  // inerken kaybolmasın (LCP görselinin kod çözümü ana iş
                  // parçacığını bloklamamalı).
                  decoding="async"
                  className={`h-full w-full ${slide.fit === "contain" ? "object-contain" : "object-cover"}`}
                  style={{
                    objectPosition: `${slide.focal_x ?? 50}% ${slide.focal_y ?? 50}%`,
                  }}
                />
              </picture>
            </TrackedLink>
          </div>
        ))}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-b from-transparent to-slate-50 ${isHome ? "h-[48%] via-slate-50/45 " : "h-2/5"}`}
        />
        {slides.length > 1 && (
          <>
            <CarouselButton
              label="Önceki görsel"
              side="left"
              onClick={() =>
                setActive((active - 1 + slides.length) % slides.length)
              }
            />
            <CarouselButton
              label="Sonraki görsel"
              side="right"
              onClick={next}
            />
            <div className={`absolute left-1/2 z-20 flex -translate-x-1/2 gap-2 rounded-full bg-white/80 px-3 py-2 backdrop-blur ${isHome ? "top-4" : "bottom-8"}`}>
              {slides.map((_, index) => (
                <PlainButton
                  key={index}
                  type="button"
                  aria-label={`${index + 1}. görsel`}
                  aria-current={index === active}
                  onClick={() => setActive(index)}
                  className={`h-2 rounded-full transition-all ${index === active ? "w-7 bg-slate-950 " : "w-2 bg-slate-400"}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {fade && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent to-slate-50"
        />
      )}
    </section>
  );
}

function CarouselButton({
  label,
  side,
  onClick,
}: {
  label: string;
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <PlainButton
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`absolute top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-2xl shadow-lg transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${side === "left" ? "left-4" : "right-4"}`}
    >
      {side === "left" ? "‹" : "›"}
    </PlainButton>
  );
}

function Heading({
  block,
  revisionId,
}: {
  block: LandingPageBlock;
  revisionId: number;
}) {
  if (!block.title && !block.description && !block.link_url) return null;
  const orta = hizaSinifi(gorunumOku(block.config));
  return (
    <div className={`mb-5 flex flex-col justify-between gap-3 ${orta ? "items-center text-center sm:flex-col sm:items-center" : "items-start sm:flex-row sm:items-end"} sm:gap-5`}>
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-950 md:text-2xl ">
          {block.title}
        </h2>
        {block.description && (
          <p className="mt-1 max-w-2xl text-sm text-slate-500 ">
            {block.description}
          </p>
        )}
      </div>
      {block.link_url && (
        <TrackedLink
          to={block.link_url}
          revisionId={revisionId}
          block={block}
          className="shrink-0 text-sm font-semibold text-indigo-600 "
        >
          {block.link_label || "Keşfet"} →
        </TrackedLink>
      )}
    </div>
  );
}

function ProductRail({
  block,
  revisionId,
}: {
  block: LandingPageBlock;
  revisionId: number;
}) {
  const trackEvents = useContext(LandingEventTrackingContext);
  if (!block.products.length) return null;
  return (
    <section className={CONTAINER}>
      <Heading block={block} revisionId={revisionId} />
      <HScroll className="snap-x gap-4 pb-4 md:gap-6">
        {block.products.map((product) => (
          <div
            key={product.id}
            onClick={() =>
              trackEvents &&
              void recordStorePageEvent(revisionId, {
                event_type: "PRODUCT_CLICK",
                block_key: block.block_key,
                product_id: product.id,
              }).catch(() => undefined)
            }
            className="w-[160px] shrink-0 snap-start md:w-[210px]"
          >
            <ProductCard product={product} showPurchaseAction={false} />
          </div>
        ))}
      </HScroll>
    </section>
  );
}

function ImageGrid({
  block,
  revisionId,
}: {
  block: LandingPageBlock;
  revisionId: number;
}) {
  const cards = (block.config.cards as MediaItem[] | undefined) ?? [];
  if (!cards.length) return null;
  return (
    <section
      className={`${CONTAINER} ${block.config.overlay ? "relative z-30 -mt-28 md:-mt-40" : ""}`}
    >
      <Heading block={block} revisionId={revisionId} />
      <div
        className={`grid gap-4 md:gap-6 ${
          cards.length === 1
            ? "max-w-sm"
            : cards.length === 2
              ? "md:grid-cols-2"
              : gorunumOku(block.config).kolon
                ? kolonSinifi(gorunumOku(block.config))
                : "grid-cols-2 lg:grid-cols-4"
        }`}
      >
        {cards.map((card, index) => (
          <TrackedLink
            key={`${card.image_url}-${index}`}
            to={card.link_url}
            revisionId={revisionId}
            block={block}
            className="group min-w-0 border-t border-slate-200 pt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 "
          >
            <div className="aspect-square overflow-hidden bg-slate-50 ">
              <img
                src={card.image_url}
                alt={card.decorative ? "" : (card.alt_text ?? "")}
                loading="lazy"
                className={`h-full w-full ${card.fit === "cover" ? "object-cover" : "object-contain"}`}
                style={{
                  objectPosition: `${card.focal_x ?? 50}% ${card.focal_y ?? 50}%`,
                }}
              />
            </div>
            {card.label && (
              <p className="mt-2 text-sm font-medium text-slate-800 group-hover:text-indigo-600 ">
                {card.label}
              </p>
            )}
          </TrackedLink>
        ))}
      </div>
    </section>
  );
}

function CompactImageRow({
  blocks,
  revisionId,
  homeOverlay,
}: {
  blocks: LandingPageBlock[];
  revisionId: number;
  homeOverlay: boolean;
}) {
  // ORTAK ÇAĞRI: canlı ana sayfada dört kartın dördünde de aynı metin ve aynı
  // hedef vardı ("Okula Dönüş Alışverişi →" ×4). Aynı çağrıyı dört kez basmak
  // bilgi taşımaz, gürültü üretir. Metin SİLİNMEZ — satır başına bir kez
  // basılır; bu projede "yönetici alanı doldurdu, vitrin sessizce basmadı"
  // hatası bir kez yaşandı (B-2) ve o sınıfa geri dönülmez.
  //
  // Tekilleştirme yalnız metin VE hedef aynıysa yapılır: aynı metin farklı
  // yerlere gidiyorsa tek bağlantı hangi karta gideceğini söyleyemez.
  const ilk = blocks[0];
  const ilkHedef =
    ((ilk?.config.cards as MediaItem[] | undefined)?.[0]?.link_url ?? null) ||
    ilk?.link_url ||
    null;
  const ortakEtiket =
    ilk?.link_label &&
    ilkHedef &&
    blocks.every((block) => {
      const hedef =
        ((block.config.cards as MediaItem[] | undefined)?.[0]?.link_url ?? null) ||
        block.link_url ||
        null;
      return block.link_label === ilk.link_label && hedef === ilkHedef;
    })
      ? ilk.link_label
      : null;

  return (
    <section className={`${CONTAINER} ${homeOverlay ? "relative z-30 -mt-48 sm:-mt-52" : ""}`}>
      {ortakEtiket && (
        <div className="mb-4 flex justify-end">
          <TrackedLink
            to={ilkHedef}
            revisionId={revisionId}
            block={ilk}
            className="text-sm font-semibold text-indigo-600 hover:underline "
          >
            {ortakEtiket} <span aria-hidden="true">→</span>
          </TrackedLink>
        </div>
      )}
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-2 md:overflow-visible md:gap-6 lg:grid-cols-4">
        {blocks.map((block) => {
          const card = ((block.config.cards as MediaItem[] | undefined) ?? [])[0];
          if (!card?.image_url) return null;
          return (
            <TrackedLink
              key={block.block_key}
              to={card.link_url ?? block.link_url}
              revisionId={revisionId}
              block={block}
              /* SAKİN DÜZEN: kart çerçevesi + gölge + içteki ikinci kutu
                 kaldırıldı. Kartı ayıran şey KUTU değil BOŞLUK; görselin
                 kendisi zaten bir sınır çiziyor. */
              className="group flex w-[82vw] max-w-[340px] shrink-0 snap-start flex-col rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:w-auto md:max-w-none"
            >
              <div className="aspect-square overflow-hidden rounded-xl bg-slate-100 ">
                <img
                  src={card.image_url}
                  alt={card.decorative ? "" : (card.alt_text ?? "")}
                  loading="lazy"
                  decoding="async"
                  className={`h-full w-full transition duration-300 group-hover:scale-[1.035] ${card.fit === "cover" ? "object-cover" : "object-contain"}`}
                  style={{
                    objectPosition: `${card.focal_x ?? 50}% ${card.focal_y ?? 50}%`,
                  }}
                />
              </div>
              {/* Başlık görselin ALTINDA: ürün ızgaralarındaki ritmin aynısı,
                  okuma sırası görsel → ad. */}
              <h2 className="mt-3 text-base font-semibold text-slate-900 group-hover:text-indigo-700 md:text-[17px] ">
                {block.title || card.label || "Keşfet"}
              </h2>
              {block.description && (
                <p className="mt-1 line-clamp-2 text-sm text-slate-500 ">
                  {block.description}
                </p>
              )}
              {!ortakEtiket && block.link_label && (
                <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 ">
                  {block.link_label} <span aria-hidden="true">→</span>
                </span>
              )}
            </TrackedLink>
          );
        })}
      </div>
    </section>
  );
}

function CategoryGrid({
  block,
  revisionId,
}: {
  block: LandingPageBlock;
  revisionId: number;
}) {
  if (!block.categories.length) return null;
  return (
    <section className={CONTAINER}>
      <Heading block={block} revisionId={revisionId} />
      <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
        {block.categories.map((category) => (
          <TrackedLink
            key={category.id}
            to={`${ROUTES.store}?category=${category.id}`}
            revisionId={revisionId}
            block={block}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-indigo-300 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 "
          >
            {category.name}
            <span className="text-xs font-normal text-slate-500 ">
              {category.product_count ?? 0} ürün
            </span>
          </TrackedLink>
        ))}
      </div>
    </section>
  );
}

function Banner({
  block,
  revisionId,
}: {
  block: LandingPageBlock;
  revisionId: number;
}) {
  const media = block.config as MediaItem;
  if (!media.image_url) return null;
  return (
    <section className={CONTAINER}>
      <TrackedLink
        to={media.link_url ?? block.link_url}
        revisionId={revisionId}
        block={block}
        className="block overflow-hidden rounded-2xl"
      >
        <img
          src={media.image_url}
          alt={media.decorative ? "" : (media.alt_text ?? "")}
          loading="lazy"
          className={`${bannerBoySinifi(gorunumOku(block.config))} w-full ${media.fit === "contain" ? "object-contain" : "object-cover"}`}
        />
      </TrackedLink>
    </section>
  );
}


type CardRowKart = {
  title?: string;
  link_label?: string;
  link_url?: string | null;
  items?: MediaItem[];
};

/**
 * Amazon tarzı kart satırı (CARD_ROW): beyaz kartlar, kart başına 1-4 görsel
 * (4'lü = "quad card" 2x2 dizilir), altta CTA linki. `overlay` açıkken satır
 * hero'nun gradient fade'i üzerine biner (IMAGE_CARD_GRID ile aynı bindirme).
 */
function CardRow({
  block,
  revisionId,
}: {
  block: LandingPageBlock;
  revisionId: number;
}) {
  const cards = ((block.config.cards as CardRowKart[] | undefined) ?? []).filter(
    (card) => (card.items ?? []).some((item) => item.image_url),
  );
  if (!cards.length) return null;
  const kolon =
    cards.length === 1 ? "md:grid-cols-1 md:max-w-sm" : cards.length === 2 ? "md:grid-cols-2" : cards.length === 3 ? "md:grid-cols-3" : "sm:grid-cols-2 md:grid-cols-4";
  return (
    <section
      className={`${CONTAINER} ${block.config.overlay ? "relative z-30 -mt-28 md:-mt-40" : ""}`}
    >
      <div className={`grid items-stretch gap-5 ${kolon}`}>
        {cards.map((card, cardIndex) => {
          const items = (card.items ?? []).filter((item) => item.image_url).slice(0, 4);
          const tekil = items.length === 1;
          return (
            <div
              key={cardIndex}
              className="flex flex-col bg-white p-5 pb-4 shadow-[0_2px_5px_rgba(15,17,17,0.08)]"
            >
              <h2 className="text-[21px] font-bold leading-[27px] text-[#0F1111]">
                {card.title}
              </h2>
              <div
                className={`mt-3 grid flex-1 content-start ${tekil ? "" : "grid-cols-2 gap-x-3 gap-y-3.5"}`}
              >
                {items.map((item, itemIndex) => (
                  <TrackedLink
                    key={itemIndex}
                    to={item.link_url ?? card.link_url ?? block.link_url}
                    revisionId={revisionId}
                    block={block}
                    className="group block"
                  >
                    <div className={`overflow-hidden bg-white ${tekil ? "aspect-[1/1.05]" : "aspect-square"}`}>
                      <img
                        src={item.image_url}
                        alt={item.decorative ? "" : (item.alt_text ?? "")}
                        loading="lazy"
                        className={`h-full w-full ${item.fit === "cover" ? "object-cover" : "object-contain"}`}
                      />
                    </div>
                    {item.label && (
                      <p className="mt-1 truncate text-[13px] leading-[17px] text-[#0F1111]">
                        {item.label}
                      </p>
                    )}
                  </TrackedLink>
                ))}
              </div>
              {card.link_label && (
                <TrackedLink
                  to={card.link_url ?? block.link_url}
                  revisionId={revisionId}
                  block={block}
                  className="mt-4 block text-[13px] leading-[19px] text-[#007185] hover:text-[#C7511F] hover:underline"
                >
                  {card.link_label}
                </TrackedLink>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RichText({
  block,
  revisionId,
}: {
  block: LandingPageBlock;
  revisionId: number;
}) {
  const contentHtml = String(block.config.content_html ?? "");
  const content = String(block.config.content ?? "");
  if (!contentHtml && !content) return null;
  return (
    <section className={`${CONTAINER} max-w-4xl`}>
      <Heading block={block} revisionId={revisionId} />
      {contentHtml ? (
        // SUNUCUDA sanitize edilmiş HTML (services/blog_service.sanitize_html
        // — _sanitize_rich_text yazma boğazı); inline text-align stili korunur.
        <div
          className={ZENGIN_METIN_SINIFI}
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      ) : (
        <div className="whitespace-pre-wrap text-base leading-7 text-slate-700 ">
          {content}
        </div>
      )}
    </section>
  );
}

function RecentlyViewed({
  block,
  revisionId,
}: {
  block: LandingPageBlock;
  revisionId: number;
}) {
  const trackEvents = useContext(LandingEventTrackingContext);
  const products = getRecentlyViewedProducts();
  if (!products.length) return null;
  return (
    <section className={CONTAINER}>
      <Heading block={block} revisionId={revisionId} />
      <HScroll className="snap-x gap-4 pb-4 md:gap-6">
        {products.map((product) => (
          <div
            key={product.id}
            onClick={() =>
              trackEvents &&
              void recordStorePageEvent(revisionId, {
                event_type: "PRODUCT_CLICK",
                block_key: block.block_key,
                product_id: product.id,
              }).catch(() => undefined)
            }
            className="w-[160px] shrink-0 snap-start md:w-[210px]"
          >
            <ProductCard product={product} showPurchaseAction={false} />
          </div>
        ))}
      </HScroll>
    </section>
  );
}

function TrackedLink({
  to,
  revisionId,
  block,
  className,
  children,
}: {
  to?: string | null;
  revisionId: number;
  block: LandingPageBlock;
  className?: string;
  children: ReactNode;
}) {
  const trackEvents = useContext(LandingEventTrackingContext);
  const click = () =>
    trackEvents &&
    revisionId > 0 &&
    void recordStorePageEvent(revisionId, {
      event_type: "BLOCK_CLICK",
      block_key: block.block_key,
    }).catch(() => undefined);
  if (!to) return <div className={className}>{children}</div>;
  if (to.startsWith("/"))
    return (
      <Link to={to} className={className} onClick={click}>
        {children}
      </Link>
    );
  return (
    <a
      href={to}
      className={className}
      onClick={click}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
