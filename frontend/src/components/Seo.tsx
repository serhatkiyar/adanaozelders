import type { ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import {
  SITE_NAME,
  DEFAULT_DESCRIPTION,
  absoluteUrl,
  clampDescription,
} from "@/lib/seo";

interface SeoProps {
  /** Sayfa başlığı; `SITE_NAME` ile birleşir. Verilmezse marka başlığı. */
  title?: string;
  description?: string;
  /** Kanonik path (örn. "/egitmenler/ahmet-42"); verilmezse mevcut pathname. */
  canonicalPath?: string;
  /** OG/Twitter görseli (mutlak veya göreli). Varsayılan: /logo.png. */
  image?: string;
  type?: "website" | "profile" | "article" | "product";
  /** Arama motorlarından gizle (oturum-içi/özel sayfalar). */
  noindex?: boolean;
  /** Ek head düğümleri (örn. <JsonLd />). */
  children?: ReactNode;
}

// Merkezî meta/OG/Twitter/canonical yönetimi (react-helmet-async).
export function Seo({
  title,
  description,
  canonicalPath,
  image,
  type = "website",
  noindex,
  children,
}: SeoProps) {
  const fullTitle = title
    ? `${SITE_NAME} · ${title}`
    : `${SITE_NAME}, Uzman Eğitmenle Öğren`;
  const desc = clampDescription(description ?? DEFAULT_DESCRIPTION);
  const path =
    canonicalPath ??
    (typeof window !== "undefined" ? window.location.pathname : "/");
  const canonical = absoluteUrl(path);
  const ogImage = absoluteUrl(image ?? "/logo.png");

  // Not: `children` (örn. <JsonLd/>) Helmet'in DIŞINDA, kardeş olarak render
  // edilir. react-helmet-async <Helmet> çocuklarının ham head etiketleri
  // olmasını şart koşar; bileşen çocuk (kendi Helmet'ini render eden) hata
  // fırlatır. Birden çok Helmet'i provider zaten birleştirir.
  return (
    <>
      <Helmet>
        <title>{fullTitle}</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={canonical} />
        {noindex && <meta name="robots" content="noindex,nofollow" />}

        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={desc} />
        <meta property="og:type" content={type} />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:locale" content="tr_TR" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={fullTitle} />
        <meta name="twitter:description" content={desc} />
        <meta name="twitter:image" content={ogImage} />
      </Helmet>
      {children}
    </>
  );
}
