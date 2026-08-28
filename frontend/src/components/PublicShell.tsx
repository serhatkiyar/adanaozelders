import { type ReactNode } from "react";
import { PublicNavbar } from "@/components/PublicNavbar";
import { SiteFooter } from "@/components/SiteFooter";

// Not: sayfa başlığı/meta artık merkezî `<Seo />` (react-helmet-async) ile
// yönetilir; shell document.title'a dokunmaz (çift yönetim/flicker önlenir).
//
// `<AuthModal />` BURADA YOKTUR ve eklenmemelidir (TB-71): `App.tsx` onu
// `<Routes>`un DIŞINDA, yani her rotada bir kez render eder. Kabuğa ikinci
// bir kopya koymak aynı `?modal=login` parametresini iki örneğe okutur;
// ikisi birlikte açılır ve kaydırma kilidi LIFO dışı kapanmada sayfada
// kalırdı.
export function PublicShell({
  children,
  center,
  bottom,
}: {
  children: ReactNode;
  /** Navbar ortasına yerleşen içerik (ör. arama pill'i). */
  center?: ReactNode;
  /** Navbar'ın alt satırına yerleşen içerik (ör. filtre çubuğu). */
  bottom?: ReactNode;
}) {
  return (
    // flex kolon: içerik kısa olsa da SiteFooter'ın `mt-auto`'su onu sayfanın
    // altına iter (yasal sayfalar kısa olabiliyor).
    <div className="flex min-h-screen flex-col bg-slate-50 ">
      <PublicNavbar center={center} bottom={bottom} expanded />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
