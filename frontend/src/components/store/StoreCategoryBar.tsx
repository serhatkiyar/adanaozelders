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
 * kenardan kenara), iç içerik boxed (max-w-[1464px]). Sakin/indigo aksan.
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

  const openKids = openId != null ? childrenByParent.get(openId) ?? [] : [];

  // Aktiflik yalnız metin rengiyle anlatılır (alt çizgi/indigo şerit YOK —
  // kullanıcı kararı, 29 Ağu); şerit alçak tutulur (py-2).
  const linkBase = "whitespace-nowrap py-2 text-sm font-medium transition-colors";

  return (
    <nav
      aria-label="Mağaza gezinmesi"
      className="relative z-20 w-full border-b border-slate-200 bg-white "
      onMouseLeave={() => setOpenId(null)}
    >
      {/* Vitrin hero'suyla AYNI sınır (1500px): geniş ekranda "Tümü" ikonunun sol
          kenarı hero'nun sol kenarına yaslanır (padding sıfırlanır); dar ekranda
          hero kenara dayandığı için küçük bir iç boşluk kalır. */}
      <div className="mx-auto max-w-[1500px] px-4 min-[1500px]:px-0">
        <div
          className="flex items-stretch gap-4 overflow-x-auto sm:gap-5"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {/* Kategoriler — catch-all (tüm ürünler) */}
          <Link
            to={ROUTES.store}
            onMouseEnter={() => setOpenId(null)}
            className={`${linkBase} flex items-center gap-1.5 ${
              !activeCategory
                ? "text-slate-900 "
                : "text-slate-500 hover:text-slate-900 "
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
            Tümü
          </Link>

          <Link
            to={ROUTES.home}
            onMouseEnter={() => setOpenId(null)}
            // Logo lacivertiyle (#1a365d) dolgulu buton — şeritteki tek renkli aksiyon.
            className="shrink-0 self-center whitespace-nowrap rounded-full bg-[#1a365d] px-3.5 py-1 text-sm font-medium text-white transition-colors hover:bg-[#24477c]"
          >
            Özel Ders Al
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
                    ? "text-slate-900 "
                    : "text-slate-500 hover:text-slate-900 "
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
        <div className="absolute inset-x-0 top-full z-40 border-b border-slate-100 bg-white shadow-[0_12px_32px_rgba(0,0,0,0.06)] ">
          <div className="mx-auto max-w-[1500px] px-4 py-6 min-[1500px]:px-0">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {openKids.map((kid) => (
                <Link
                  key={kid.id}
                  to={`${ROUTES.store}?category=${kid.id}`}
                  onClick={() => setOpenId(null)}
                  className="rounded-lg px-2 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-marka "
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
