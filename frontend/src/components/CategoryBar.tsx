import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";

/**
 * Airbnb tarzı üst-seviye kategori çubuğu: küçük 3D ikon + altında etiket,
 * aktif olanın altı kalın çizgili ve etiketi koyu. Landing'de arama çubuğunun
 * altında, ders karuselinin üstünde durur.
 */

export type CategoryKey =
  | "hepsi"
  | "egitmenler"
  | "kutuphaneler"
  | "denemeler";

type Category = {
  key: CategoryKey;
  label: string;
  icon: string;
  to: string;
};

const CATEGORIES: Category[] = [
  { key: "hepsi", label: "Hepsi", icon: "/icons/categories/hepsi.png", to: ROUTES.home },
  { key: "egitmenler", label: "Eğitmenler", icon: "/icons/categories/egitmenler.png", to: ROUTES.tutors },
  { key: "kutuphaneler", label: "Kütüphaneler", icon: "/icons/categories/kutuphaneler.png", to: ROUTES.libraries },
  // Deneme oturumları kütüphane profillerinde yer alır.
  { key: "denemeler", label: "Denemeler", icon: "/icons/categories/denemeler.png", to: ROUTES.libraries },
];


/** Tek bir kategorinin meta'sı (ikon/label) — kompakt arama çubuğu için. */
export function categoryMeta(key: CategoryKey): Category {
  return CATEGORIES.find((c) => c.key === key)!;
}

/**
 * `onSelect` verilirse kategoriler sekme gibi davranır (yeni sayfaya gitmez,
 * üstteki state'i değiştirir — Airbnb davranışı). Verilmezse klasik link.
 */
export function CategoryBar({
  active,
  onSelect,
}: {
  active?: CategoryKey;
  onSelect?: (key: CategoryKey) => void;
}) {
  return (
    <div className="w-full">
      <div
        className="flex items-end justify-center gap-8 overflow-x-auto px-2 sm:gap-12"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {CATEGORIES.map((c) => {
          const isActive = active === c.key;
          const cls = `group flex shrink-0 flex-col items-center gap-1.5 border-b-2 pb-2 pt-0 transition-colors duration-200 ${
            isActive
              ? "border-slate-900 dark:border-white"
              : "border-transparent hover:border-slate-200 dark:hover:border-slate-700"
          }`;
          const inner = (
            <>
              <img
                src={c.icon}
                alt=""
                aria-hidden
                className={`h-12 w-12 object-contain transition-all duration-200 group-hover:scale-105 ${
                  isActive ? "opacity-100" : "opacity-70 group-hover:opacity-100"
                }`}
              />
              <span
                className={`whitespace-nowrap text-[13px] transition-colors duration-200 ${
                  isActive
                    ? "font-semibold text-slate-900 dark:text-white"
                    : "font-medium text-slate-500 group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-white"
                }`}
              >
                {c.label}
              </span>
            </>
          );
          return onSelect ? (
            <button
              key={c.key}
              type="button"
              onClick={() => onSelect(c.key)}
              aria-current={isActive ? "page" : undefined}
              className={cls}
            >
              {inner}
            </button>
          ) : (
            <Link
              key={c.key}
              to={c.to}
              aria-current={isActive ? "page" : undefined}
              className={cls}
            >
              {inner}
            </Link>
          );
        })}

      </div>
    </div>
  );
}
