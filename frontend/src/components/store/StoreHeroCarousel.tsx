import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useStoreHeroSlides } from "@/hooks/useStoreHero";
import { useStoreShowcase } from "@/hooks/useStoreShowcase";
import { ROUTES } from "@/lib/routes";

const LCP_PRIORITY = { fetchpriority: "high" } as Record<string, string>;

export function StoreHeroCarousel() {
  const { data: slides = [], isLoading: slidesLoading } = useStoreHeroSlides();
  const { data: showcaseFeed, isLoading: showcaseLoading } = useStoreShowcase();
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const show = useCallback((index: number) => {
    if (slides.length) setActiveIndex((index + slides.length) % slides.length);
  }, [slides.length]);

  const previous = useCallback(() => {
    if (slides.length) {
      setActiveIndex((current) => (current - 1 + slides.length) % slides.length);
    }
  }, [slides.length]);

  const next = useCallback(() => {
    if (slides.length) setActiveIndex((current) => (current + 1) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (activeIndex >= slides.length) setActiveIndex(0);
  }, [activeIndex, slides.length]);

  useEffect(() => {
    if (paused || reduceMotion || slides.length < 2) return;
    const timer = window.setInterval(next, 6500);
    return () => window.clearInterval(timer);
  }, [next, paused, reduceMotion, slides.length]);

  const showcaseCards = useMemo(() => {
    return (showcaseFeed?.cards ?? []).map((card) => ({
      key: `managed-${card.id}`,
      title: card.title,
      description: card.description,
      to: card.link_url,
      linkLabel: card.link_label,
      contentMode: card.content_mode,
      products: card.products,
      customTiles: card.custom_tiles,
    }));
  }, [showcaseFeed]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Mağaza kampanyaları"
      className="relative overflow-hidden"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <h1 className="sr-only">Mağaza</h1>
      {(slidesLoading || slides.length > 0) && (
      <div className="relative h-[430px] overflow-hidden sm:h-[470px] lg:h-[540px]">
        {slidesLoading && slides.length === 0 ? (
          <div className="absolute inset-0 animate-pulse bg-slate-200 dark:bg-slate-800" />
        ) : slides.map((slide, index) => (
          <article
            key={slide.id}
            aria-roledescription="slide"
            aria-label={`${index + 1} / ${slides.length}`}
            aria-hidden={index !== activeIndex}
            {...(index !== activeIndex ? { inert: "" } : {})}
            className={`absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none ${
              index === activeIndex ? "z-10 opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <SlideImage slide={slide} priority={index === 0} />
          </article>
        ))}

        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 z-20 h-[48%] bg-gradient-to-b from-transparent via-slate-50/45 to-slate-50 dark:via-slate-950/50 dark:to-slate-950"
        />

        {slides.length > 1 && (
          <>
            <CarouselButton direction="previous" onClick={previous} />
            <CarouselButton direction="next" onClick={next} />
          </>
        )}

        {slides.length > 1 && (
        <div className="absolute left-1/2 top-4 z-30 flex -translate-x-1/2 gap-2 rounded-full bg-white/75 px-3 py-2 shadow-sm backdrop-blur-md dark:bg-slate-950/70">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`${index + 1}. kampanyayı göster`}
              aria-current={index === activeIndex}
              onClick={() => show(index)}
              className="group flex h-6 w-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span className={`h-2 rounded-full transition-all motion-reduce:transition-none ${
                index === activeIndex
                  ? "w-7 bg-slate-900 dark:bg-white"
                  : "w-2 bg-slate-400/60 group-hover:bg-slate-600 dark:bg-slate-500 dark:group-hover:bg-slate-300"
              }`} />
            </button>
          ))}
        </div>
        )}
      </div>
      )}

      {(showcaseLoading || showcaseCards.length > 0) && <div className={`relative z-30 mx-auto max-w-[1464px] px-4 md:px-8 ${
        slidesLoading || slides.length > 0 ? "-mt-24 sm:-mt-28 md:-mt-36" : "pt-6"
      }`}>
        {showcaseLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5" aria-label="Kategoriler yükleniyor">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-56 animate-pulse rounded-2xl bg-white shadow-lg dark:bg-slate-900" />
            ))}
          </div>
        ) : (
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-4">
            {showcaseCards.map((card) => (
              <article
                key={card.key}
                className="flex w-[82vw] max-w-[340px] shrink-0 snap-start flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_18px_45px_-24px_rgba(15,23,42,0.5)] md:w-auto md:max-w-none dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="mb-3">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white sm:text-lg">{card.title}</h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{card.description}</p>
                </div>

                {card.contentMode === "CUSTOM" ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                    {card.customTiles.map((tile, index) => (
                      <ShowcaseCardLink
                        key={`${tile.image_url}-${index}`}
                        to={tile.link_url}
                        ariaLabel={tile.alt_text || tile.label || `${card.title} görseli ${index + 1}`}
                        className={`min-w-0 focus-visible:rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                          card.customTiles.length === 1 ? "col-span-2" : ""
                        }`}
                      >
                        <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
                          <img
                            src={tile.image_url}
                            alt={tile.alt_text}
                            loading="lazy"
                            className="h-full w-full object-contain"
                          />
                        </span>
                        {tile.label && <span className="mt-1.5 line-clamp-2 min-h-8 text-xs font-medium text-slate-700 dark:text-slate-300">{tile.label}</span>}
                      </ShowcaseCardLink>
                    ))}
                  </div>
                ) : card.products.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {card.products.map((product) => (
                        <ShowcaseCardLink
                          key={product.id}
                          to={ROUTES.storeProduct(product.slug)}
                          ariaLabel={product.title}
                          className={`flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-slate-50 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-800 ${
                            card.products.length === 1 ? "col-span-2" : ""
                          }`}
                        >
                          {product.cover_url ? (
                            <img
                              src={product.cover_url}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-contain mix-blend-multiply dark:mix-blend-normal"
                            />
                          ) : (
                            <ProductPlaceholder />
                          )}
                        </ShowcaseCardLink>
                      ))}
                  </div>
                ) : <div className="aspect-[4/3] rounded-xl bg-slate-100 dark:bg-slate-800" />}

                <ShowcaseCardLink to={card.to} className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200">
                  {card.linkLabel} <span aria-hidden="true">→</span>
                </ShowcaseCardLink>
              </article>
            ))}
          </div>
        )}
      </div>}
    </section>
  );
}

function ShowcaseCardLink({ to, className, children, ariaLabel }: { to: string; className: string; children: ReactNode; ariaLabel?: string }) {
  if (to.startsWith("/")) return <Link to={to} className={className} aria-label={ariaLabel}>{children}</Link>;
  return <a href={to} className={className} aria-label={ariaLabel} rel="noopener noreferrer">{children}</a>;
}

function SlideImage({
  slide,
  priority,
}: {
  slide: { image_url: string; mobile_image_url: string | null; alt_text: string; link_url: string | null };
  priority: boolean;
}) {
  const picture = (
    <picture>
      {slide.mobile_image_url && <source media="(max-width: 767px)" srcSet={slide.mobile_image_url} />}
      <img
        src={slide.image_url}
        alt={slide.alt_text}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        {...(priority ? LCP_PRIORITY : {})}
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
    </picture>
  );

  if (!slide.link_url) return picture;
  if (slide.link_url.startsWith("/")) {
    return <Link to={slide.link_url} className="absolute inset-0">{picture}</Link>;
  }
  return (
    <a href={slide.link_url} className="absolute inset-0" rel="noopener noreferrer">
      {picture}
    </a>
  );
}

function CarouselButton({
  direction,
  onClick,
}: {
  direction: "previous" | "next";
  onClick: () => void;
}) {
  const previous = direction === "previous";
  return (
    <button
      type="button"
      aria-label={previous ? "Önceki kampanya" : "Sonraki kampanya"}
      onClick={onClick}
      className={`absolute top-[42%] z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-slate-900 shadow-lg backdrop-blur-md transition hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-950/80 dark:text-white dark:hover:bg-slate-900 ${
        previous ? "left-3 sm:left-6" : "right-3 sm:right-6"
      }`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={previous ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
      </svg>
    </button>
  );
}

function ProductPlaceholder() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
    </svg>
  );
}
