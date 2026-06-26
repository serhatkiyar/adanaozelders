import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { useCategories } from "@/hooks/useStore";
import type { ProductCategory } from "@/types";

/**
 * Mağaza üst kategori şeridi (category navigation bar).
 * İlk öğe "Tümü" (catch-all) → /magaza; sonra backend'den gelen üst kategoriler
 * (`parent_id == null`) → /magaza?category=<id>. Çocuğu olan kategoriye hover'da
 * mega menu açılır (alt kategoriler, gerçek veriden). Şerit full-bleed (arka plan
 * kenardan kenara), iç içerik boxed (max-w-screen-2xl). Sakin/indigo aksan.
 *
 * Not: mega menu paneli, yatay kaydırıcının (overflow-x-auto) DIŞINDA — kardeşi
 * olarak render edilir; aksi halde kaydırma kabı paneli dikeyde kırpar.
 */
export function StoreCategoryBar() {
  const { data: categories } = useCategories();
  const [searchParams] = useSearchParams();
  const activeCategory = searchParams.get("category");
  const [openId, setOpenId] = useState<number | null>(null);

  const topCategories = useMemo(
    () => (categories ?? []).filter((c) => !c.parent_id),
    [categories]
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<number, ProductCategory[]>();
    for (const c of categories ?? []) {
      if (c.parent_id) {
        const arr = map.get(c.parent_id) ?? [];
        arr.push(c);
        map.set(c.parent_id, arr);
      }
    }
    return map;
  }, [categories]);

  if (topCategories.length === 0) return null;

  const openKids = openId != null ? childrenByParent.get(openId) ?? [] : [];

  const linkBase =
    "whitespace-nowrap border-b-2 py-3 text-sm font-medium transition-colors";

  return (
    <nav
      className="sticky top-0 z-30 w-full border-b border-slate-100 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90"
      onMouseLeave={() => setOpenId(null)}
    >
      <div className="mx-auto max-w-screen-2xl px-4 md:px-8">
        <div
          className="flex items-stretch gap-6 overflow-x-auto sm:gap-8"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {/* Kategoriler — catch-all (tüm ürünler) */}
          <Link
            to={ROUTES.store}
            onMouseEnter={() => setOpenId(null)}
            className={`${linkBase} flex items-center gap-1.5 ${
              !activeCategory
                ? "border-indigo-600 text-slate-900 dark:border-indigo-400 dark:text-white"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
            Kategoriler
          </Link>

          {topCategories.map((c) => {
            const isActive = activeCategory === String(c.id);
            return (
              <Link
                key={c.id}
                to={`${ROUTES.store}?category=${c.id}`}
                onMouseEnter={() => setOpenId(c.id)}
                className={`${linkBase} ${
                  isActive
                    ? "border-indigo-600 text-slate-900 dark:border-indigo-400 dark:text-white"
                    : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                {c.name}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Mega menu — kaydırıcının dışında, nav'a göre konumlanır (full-bleed) */}
      {openKids.length > 0 && (
        <div className="absolute inset-x-0 top-full z-40 border-b border-slate-100 bg-white shadow-[0_12px_32px_rgba(0,0,0,0.06)] dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto max-w-screen-2xl px-4 py-6 md:px-8">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {openKids.map((kid) => (
                <Link
                  key={kid.id}
                  to={`${ROUTES.store}?category=${kid.id}`}
                  onClick={() => setOpenId(null)}
                  className="rounded-lg px-2 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
                >
                  {kid.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
