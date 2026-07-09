import { type ReactNode, useEffect } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { SITE_NAME } from "@/lib/seo";
import { useCartStore } from "@/store/cartStore";
import { AuthModal } from "@/components/AuthModal";
import { StoreCategoryBar } from "@/components/store/StoreCategoryBar";
import { StoreAccountMenu } from "@/components/store/StoreAccountMenu";
import { StoreSearch } from "@/components/store/StoreSearch";

// Boxed gövde; banner/şerit full-bleed. İçerik genişliği ~1400px (1464 − 64 kenar boşluğu).
const CONTAINER = "mx-auto max-w-[1464px] px-4 md:px-8";

export function StoreLayout({
  title = "Mağaza",
  showCategoryBar = true,
  minimalHeader = false,
  children,
}: {
  title?: string;
  /** Kategori şeridi yalnız katalog/vitrin yüzeylerinde anlamlı; detay/sepet vb. kapatır. */
  showCategoryBar?: boolean;
  /** Ödeme huni sayfası: yalnız logo + "Güvenli ödeme" (arama/aksiyon/kategori yok). */
  minimalHeader?: boolean;
  children: ReactNode;
}) {
  const cartCount = useCartStore((s) => s.totalCount());

  // Sekme başlığını sayfaya göre ayarla (caller'lar `title` geçirir).
  useEffect(() => {
    document.title = `${title} · ${SITE_NAME}`;
  }, [title]);

  if (minimalHeader) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50 font-sans dark:bg-slate-950">
        <header className="w-full border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className={`${CONTAINER} flex h-[76px] items-center justify-between`}>
            <Link to="/" aria-label="Adana Özel Ders ana sayfa" className="flex items-center transition hover:opacity-90">
              <img src="/logo.png" alt="Adana Özel Ders" className="h-8 w-auto object-contain md:h-9" />
            </Link>
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Güvenli ödeme
            </span>
          </div>
        </header>
        <main className="w-full flex-1 pb-12">{children}</main>
        <AuthModal />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans dark:bg-slate-950">
      {/* Header: logo + (ortalı) arama + aksiyonlar */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className={`${CONTAINER} flex flex-col gap-3 py-3 md:grid md:h-[76px] md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-8 md:py-0`}>
          {/* Logo lockup: master logo (→ ana site) + ayraç + dükkan ikonu (→ mağaza ana) */}
          <div className="flex shrink-0 items-center gap-3">
            <Link to="/" aria-label="Adana Özel Ders ana sayfa" className="flex items-center transition hover:opacity-90">
              <img src="/logo.png" alt="Adana Özel Ders" className="h-8 w-auto object-contain md:h-9" />
            </Link>
            <span aria-hidden className="h-6 w-px bg-slate-200 md:h-7 dark:bg-slate-700" />
            <Link
              to={ROUTES.store}
              aria-label="Mağaza"
              title="Mağaza"
              className="text-slate-500 transition-colors hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.614 2.993 2.993 0 0 0 2.25 1.016 2.993 2.993 0 0 0 2.25-1.016 2.993 2.993 0 0 0 2.25 1.016 2.993 2.993 0 0 0 2.25-1.016 3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72m-13.5 0V5.25" />
              </svg>
            </Link>
          </div>

          {/* Arama + canlı öneriler (typeahead) */}
          <div className="w-full md:px-4">
            <StoreSearch />
          </div>

          {/* Aksiyonlar — yatay [ikon · isim] */}
          <nav className="flex shrink-0 items-center gap-5 text-slate-600 md:gap-6 dark:text-slate-300">
            <StoreAccountMenu />

            <ActionItem to={ROUTES.storeFavorites} label="Listelerim">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </ActionItem>

            <ActionItem to={ROUTES.storeCart} label="Sepetim" count={cartCount}>
              <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </ActionItem>
          </nav>
        </div>
      </header>

      {/* Kategori şeridi (gerçek kategoriler + hover mega menu) */}
      {showCategoryBar && <StoreCategoryBar />}

      {/* İçerik */}
      <main className="w-full flex-1 pb-12">{children}</main>

      {/* Footer */}
      <footer className="mt-auto w-full border-t border-slate-200 bg-white py-8 dark:border-slate-800 dark:bg-slate-900">
        <div className={`${CONTAINER} flex flex-col items-center justify-between gap-6 sm:flex-row`}>
          <Link to="/" className="shrink-0">
            <img
              src="/logo.png"
              alt="Adana Özel Ders"
              className="h-8 w-auto object-contain opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0 sm:h-9 dark:opacity-60"
            />
          </Link>
          <div className="text-center text-sm text-slate-500 sm:text-right dark:text-slate-400">
            <p>© {new Date().getFullYear()} Adana Özel Ders. Tüm hakları saklıdır.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 sm:justify-end">
              <Link to={ROUTES.privacy} className="transition-colors hover:text-slate-900 dark:hover:text-white">
                Gizlilik Şartları
              </Link>
              <Link to={ROUTES.terms} className="transition-colors hover:text-slate-900 dark:hover:text-white">
                Kullanıcı Sözleşmesi
              </Link>
            </div>
          </div>
        </div>
      </footer>

      <AuthModal />
    </div>
  );
}

/** Header aksiyonu — yatay [ikon · isim] (+ opsiyonel sayı rozeti). */
function ActionItem({
  to,
  label,
  count,
  children,
}: {
  to: string;
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-2 transition-colors hover:text-indigo-600 dark:hover:text-indigo-400"
    >
      <span className="relative">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          {children}
        </svg>
        {count != null && count > 0 && (
          <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </span>
      <span className="hidden text-sm font-medium sm:inline">{label}</span>
    </Link>
  );
}
