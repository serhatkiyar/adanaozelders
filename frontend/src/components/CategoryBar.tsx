import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { DENEMELER_ACIK, KUTUPHANELER_ACIK } from "@/lib/ozellikBayraklari";

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
  /** Bölüm donduruldu: görünür kalır ama tıklanamaz (bkz. ozellikBayraklari). */
  donuk?: boolean;
};

const CATEGORIES: Category[] = [
  { key: "hepsi", label: "Hepsi", icon: "/icons/categories/hepsi.webp", to: ROUTES.home },
  { key: "egitmenler", label: "Eğitmenler", icon: "/icons/categories/egitmenler.webp", to: ROUTES.tutors },
  { key: "kutuphaneler", label: "Kütüphaneler", icon: "/icons/categories/kutuphaneler.webp", to: ROUTES.libraries, donuk: !KUTUPHANELER_ACIK },
  // Deneme oturumları kütüphane profillerinde yer alır.
  { key: "denemeler", label: "Denemeler", icon: "/icons/categories/denemeler.webp", to: ROUTES.libraries, donuk: !DENEMELER_ACIK },
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
              ? "border-slate-900 "
              : "border-transparent hover:border-slate-200 "
          }`;
          const inner = (
            <>
              {/* 96px WebP (48px'te 2x retina). Kaynaklar 1024px PNG'ydi:
                  beş ikon 4,21 MB tutuyordu ve ana sayfada anında indiriliyordu.
                  width/height layout kaymasını (CLS) önler. */}
              <img
                src={c.icon}
                alt=""
                aria-hidden
                width={48}
                height={48}
                decoding="async"
                className={`h-12 w-12 object-contain transition-all duration-200 group-hover:scale-105 ${
                  isActive ? "opacity-100" : "opacity-70 group-hover:opacity-100"
                }`}
              />
              <span
                className={`whitespace-nowrap text-[13px] transition-colors duration-200 ${
                  isActive
                    ? "font-semibold text-slate-900 "
                    : "font-medium text-slate-500 group-hover:text-slate-900 "
                }`}
              >
                {c.label}
              </span>
            </>
          );
          // Donmuş kategori: ne <Link> ne <button>. Anchor'ı `href`siz
          // bırakmak fare kullanıcısı için hiçbir şeyi değiştirmezdi; öğe
          // baştan etkileşimsiz bir <span> olarak basılır.
          if (c.donuk) {
            return (
              <span
                key={c.key}
                aria-disabled="true"
                tabIndex={-1}
                className={`${cls} cursor-default opacity-60`}
              >
                {inner}
              </span>
            );
          }

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
