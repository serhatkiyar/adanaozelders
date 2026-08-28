import { Link } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";

/**
 * LCP ipucu. Ölçümde banner altı kombinasyonun ALTISINDA da LCP öğesi çıktı;
 * görsel keşif sırasında düşük öncelikli sayılıyordu.
 *
 * Neden spread ile ve küçük harfle: `react-dom` 18.3 `fetchPriority`yi
 * TANIMIYOR (attribute tablosunda yok). camelCase yazılırsa React "bunu
 * küçük harfle yaz" uyarısı basar; küçük harfli ad bilinmeyen attribute
 * olarak sessizce DOM'a geçer. `@types/react` küçük harfli adı tiplemediği
 * için spread edilmiş bir kayıt olarak veriliyor.
 */
const LCP_ONCELIK = { fetchpriority: "high" } as Record<string, string>;

/**
 * Çapraz tanıtım şeridi: özel ders ↔ mağaza arasında köprü kuran tek banner.
 *
 * Metin görsele GÖMÜLÜ DEĞİLDİR — HTML olarak üstte durur (i18n/erişilebilirlik
 * + ekran okuyucunun görseli iki kez okumaması için `alt=""`).
 *
 * ## Okunabilirlik örtüsü (scrim) — ÖLÇÜMLE seçilir, tahminle değil
 *
 * `scrimClassName` verilirse görselin ÜSTÜNE tam kaplayan ayrı bir katman
 * çizilir (`data-hero-scrim`); verilmezse hiç örtü yoktur. Örtü metnin kendi
 * arka planı DEĞİLDİR — böylece yönlü gradyan gibi metin kutusundan geniş
 * biçimler kurulabilir ve metnin çevresinde "siyah hap" oluşmaz.
 *
 * Hangi banner'ın örtüye ihtiyacı olduğu `scripts/ip_c1_kontrast.mjs` ile
 * gerçek Chrome'da ölçülür (kompozit piksel, en kötü nokta). Ölçüm sonuçları
 * ve karar gerekçesi `docs/ip-c1/` altındadır.
 *
 * `align="left"` metni sola yaslar; yönlü gradyanla birlikte kullanılır
 * (gradyanın en koyu ucu metnin tarafındadır).
 */
export function CrossPromoBanner({
  imageSrc,
  heading,
  headingClassName = "",
  headingStyle,
  scrimClassName = "",
  align = "center",
  to,
  ariaLabel,
}: {
  imageSrc: string;
  heading: ReactNode;
  headingClassName?: string;
  headingStyle?: CSSProperties;
  scrimClassName?: string;
  align?: "center" | "left";
  to: string;
  ariaLabel: string;
}) {
  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      className="group relative block h-20 w-full overflow-hidden rounded-2xl sm:h-24 md:h-28 lg:h-auto lg:aspect-[2280/220] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white "
    >
      <img
        src={imageSrc}
        alt=""
        decoding="async"
        {...LCP_ONCELIK}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
      />
      {scrimClassName ? (
        <span data-hero-scrim aria-hidden="true" className={`absolute inset-0 ${scrimClassName}`} />
      ) : null}
      <span
        className={`absolute inset-0 flex items-center ${
          align === "left" ? "justify-start px-6 sm:px-8 md:px-10" : "justify-center px-4"
        }`}
      >
        <span
          data-hero-text
          className={`text-lg font-extrabold tracking-tight sm:text-xl md:text-2xl ${headingClassName}`}
          style={headingStyle}
        >
          {heading}
        </span>
      </span>
    </Link>
  );
}
