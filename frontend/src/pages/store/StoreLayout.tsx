import { type ReactNode, useEffect } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { SITE_NAME } from "@/lib/seo";
import { useCartStore } from "@/store/cartStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { StoreCategoryBar } from "@/components/store/StoreCategoryBar";
import { StoreAccountMenu } from "@/components/store/StoreAccountMenu";
import { StoreSearch } from "@/components/store/StoreSearch";
import { SiteFooter } from "@/components/SiteFooter";

// `<AuthModal />` BU DOSYADA YOKTUR ve eklenmemelidir (TB-71): `App.tsx` onu
// her rotada bir kez render eder. İkinci bir kopya aynı `?modal=login`
// parametresini okuyup birlikte açılır; iki kaydırma kilidi LIFO dışı
// kapandığında `body.style.overflow` `hidden` kalır ve mağaza sayfası
// yenilenene dek kaydırılamaz (gerçek Chrome'da 3/3 turda ölçüldü).
//
// Header, ana site navbar'ıyla aynı max-width'i kullanır (max-w-screen-2xl) — geniş
// ekranlarda logo sol kenarı ana site logosuyla hizalı kalsın diye.
const HEADER_CONTAINER = "mx-auto max-w-screen-2xl px-4 md:px-8";

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
  const setSurface = useSurfaceStore((s) => s.setSurface);

  // Sekme başlığını sayfaya göre ayarla (caller'lar `title` geçirir).
  useEffect(() => {
    document.title = `${title} · ${SITE_NAME}`;
  }, [title]);

  // /hesabim bağlama duyarlı navbar: son yüzey = mağaza.
  useEffect(() => {
    setSurface("store");
  }, [setSurface]);

  if (minimalHeader) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50 font-sans ">
        <header className="w-full border-b border-slate-200 bg-white ">
          <div className={`${HEADER_CONTAINER} flex h-[76px] items-center justify-between`}>
            <Link to="/" aria-label="Adana Özel Ders ana sayfa" className="flex items-center transition hover:opacity-90">
              <img src="/logo.svg" alt="Adana Özel Ders" className="h-8 w-auto object-contain md:h-9" />
            </Link>
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 ">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Güvenli ödeme
            </span>
          </div>
        </header>
        <main className="w-full flex-1 pb-12">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans ">
      {/* Header: logo + (ortalı) arama + aksiyonlar */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white ">
        <div className={`${HEADER_CONTAINER} flex flex-col gap-3 py-4 md:grid md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-8`}>
          {/* Logo: mağaza logosu → mağaza ana sayfası */}
          <div className="flex shrink-0 items-center">
            <Link to={ROUTES.store} aria-label="Mağaza ana sayfa" className="flex items-center transition hover:opacity-90">
              <img src="/magaza-logo.svg" alt="Mağaza" className="h-8 w-auto object-contain md:h-9" />
            </Link>
          </div>

          {/* Arama + canlı öneriler (typeahead) */}
          <div className="w-full md:px-4">
            <StoreSearch />
          </div>

          {/* Aksiyonlar — yatay [ikon · isim] */}
          <nav className="flex shrink-0 items-center gap-5 text-slate-600 md:gap-6 ">
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

      {/* Footer — ortak bileşen (bkz. components/SiteFooter.tsx). Mağazanın
          eski footer'ındaki "Gizlilik Şartları" ve "Kullanıcı Sözleşmesi"
          linkleri aynı hedeflere legalNav başlıklarıyla taşındı. */}
      <SiteFooter />
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
      className="group flex items-center gap-2 transition-colors hover:text-[#F09A38] "
    >
      <span className="relative">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          {children}
        </svg>
        {count != null && count > 0 && (
          <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-marka px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </span>
      <span className="hidden text-sm font-medium sm:inline">{label}</span>
    </Link>
  );
}
