import { Link } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";

/**
 * Çapraz tanıtım şeridi: özel ders ↔ mağaza arasında köprü kuran tek banner.
 *
 * Metin görsele GÖMÜLÜ DEĞİLDİR — HTML olarak üstte durur (i18n/erişilebilirlik
 * + ekran okuyucunun görseli iki kez okumaması için `alt=""`). Görselin kendi
 * boş orta alanı zemin görevi görür; okunabilirlik ölçüme göre `scrimClassName`
 * ile ayarlanır (bkz. çağıran sayfalardaki ölçüm notları).
 */
export function CrossPromoBanner({
  imageSrc,
  heading,
  headingClassName = "",
  headingStyle,
  scrimClassName = "",
  to,
  ariaLabel,
}: {
  imageSrc: string;
  heading: ReactNode;
  headingClassName?: string;
  headingStyle?: CSSProperties;
  scrimClassName?: string;
  to: string;
  ariaLabel: string;
}) {
  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      className="group relative block h-20 w-full overflow-hidden rounded-2xl sm:h-24 md:h-28 lg:h-auto lg:aspect-[2280/220] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900"
    >
      <img
        src={imageSrc}
        alt=""
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
      />
      <span className="absolute inset-0 flex items-center justify-center px-4">
        <span
          data-hero-text
          className={`rounded-lg px-4 py-1.5 text-lg font-extrabold tracking-tight sm:text-xl md:text-2xl ${scrimClassName} ${headingClassName}`}
          style={headingStyle}
        >
          {heading}
        </span>
      </span>
    </Link>
  );
}
