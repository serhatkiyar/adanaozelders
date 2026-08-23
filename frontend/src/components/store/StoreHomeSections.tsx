import { Link } from "react-router-dom";

import { HScroll } from "@/components/HScroll";
import { ProductCard } from "@/components/store/ProductCard";
import { getRecentlyViewedProducts } from "@/lib/recentlyViewedProducts";
import type { StoreHomeSectionPublic } from "@/types";

export function StoreHomeSections({ sections }: { sections: StoreHomeSectionPublic[] }) {
  return (
    <>
      {sections.map((section) => {
        if (section.section_type === "PRODUCT_RAIL") {
          return <ProductSection key={section.id} section={section} />;
        }
        if (section.section_type === "IMAGE_GRID") {
          return <ImageSection key={section.id} section={section} />;
        }
        return <RecentlyViewedSection key={section.id} section={section} />;
      })}
    </>
  );
}

function RecentlyViewedSection({ section }: { section: StoreHomeSectionPublic }) {
  const products = getRecentlyViewedProducts();
  if (products.length === 0) return null;
  return (
    <section aria-labelledby={`store-home-${section.id}`}>
      <div id={`store-home-${section.id}`}>
        <SectionHeading section={section} />
      </div>
      <HScroll className="snap-x gap-4 pb-4 md:gap-6">
        {products.map((product) => (
          <div key={product.id} className="w-[160px] shrink-0 snap-start md:w-[200px]">
            <ProductCard product={product} showPurchaseAction={false} />
          </div>
        ))}
      </HScroll>
    </section>
  );
}

function SectionHeading({ section }: { section: StoreHomeSectionPublic }) {
  return (
    <div className="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-950 md:text-2xl dark:text-white">
          {section.title}
        </h2>
        {section.description && (
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            {section.description}
          </p>
        )}
      </div>
      {section.link_url && (
        <StoreLink
          to={section.link_url}
          className="shrink-0 text-sm font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          {section.link_label} <span aria-hidden="true">→</span>
        </StoreLink>
      )}
    </div>
  );
}

function ProductSection({ section }: { section: StoreHomeSectionPublic }) {
  if (section.products.length === 0) return null;
  return (
    <section aria-labelledby={`store-home-${section.id}`}>
      <div id={`store-home-${section.id}`}>
        <SectionHeading section={section} />
      </div>
      <HScroll className="snap-x gap-4 pb-4 md:gap-6">
        {section.products.map((product) => (
          <div key={product.id} className="w-[160px] shrink-0 snap-start md:w-[200px]">
            <ProductCard product={product} showPurchaseAction={false} />
          </div>
        ))}
      </HScroll>
    </section>
  );
}

function ImageSection({ section }: { section: StoreHomeSectionPublic }) {
  const count = section.image_tiles.length;
  const gridClass = count === 1
    ? "max-w-xl grid-cols-1"
    : count === 2
      ? "max-w-5xl grid-cols-1 sm:grid-cols-2"
      : "grid-cols-2 lg:grid-cols-4";

  return (
    <section aria-labelledby={`store-home-${section.id}`}>
      <div id={`store-home-${section.id}`}>
        <SectionHeading section={section} />
      </div>
      <div className={`grid gap-4 md:gap-6 ${gridClass}`}>
        {section.image_tiles.map((tile, index) => (
          <StoreLink
            key={`${tile.image_url}-${index}`}
            to={tile.link_url}
            className="group block min-w-0"
          >
            <div className="aspect-square overflow-hidden bg-slate-50 dark:bg-slate-900">
              <img
                src={tile.image_url}
                alt={tile.alt_text}
                loading="lazy"
                className="h-full w-full object-contain"
              />
            </div>
            {tile.label && (
              <p className="mt-2 text-sm font-medium text-slate-800 group-hover:text-indigo-600 dark:text-slate-200 dark:group-hover:text-indigo-400">
                {tile.label}
              </p>
            )}
          </StoreLink>
        ))}
      </div>
    </section>
  );
}

function StoreLink({ to, className, children }: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  return to.startsWith("/") ? (
    <Link to={to} className={className}>{children}</Link>
  ) : (
    <a href={to} className={className} target="_blank" rel="noreferrer">{children}</a>
  );
}
