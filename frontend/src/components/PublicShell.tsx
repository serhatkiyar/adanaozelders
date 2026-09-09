import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { MobilAltSekmeler } from "@/components/MobilAltSekmeler";
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
  /* Yapışkan üst boşluk — `DashboardShell` ile AYNI sözleşme. Yapışkan yan
   * kartlar (ör. eğitmen ilanı) üst boşluklarını sabit bir sayı yerine bu
   * değişkenden alır; ölçülmemiş bir varsayım yerine gerçek başlık yüksekliği
   * kullanılır. Ayrıntı ve kusur öyküsü: `DashboardShell`. */
  const yiginRef = useRef<HTMLDivElement>(null);
  const [yapiskanUst, setYapiskanUst] = useState(0);
  useLayoutEffect(() => {
    const el = yiginRef.current;
    if (!el) return;
    const olc = () => setYapiskanUst(Math.round(el.getBoundingClientRect().height));
    olc();
    const gozlemci = new ResizeObserver(olc);
    gozlemci.observe(el);
    window.addEventListener("resize", olc);
    return () => {
      gozlemci.disconnect();
      window.removeEventListener("resize", olc);
    };
  }, []);

  return (
    // flex kolon: içerik kısa olsa da SiteFooter'ın `mt-auto`'su onu sayfanın
    // altına iter (yasal sayfalar kısa olabiliyor).
    <div
      className="flex min-h-screen flex-col bg-slate-50 "
      style={{ "--yapiskan-ust": `${yapiskanUst}px` } as CSSProperties}
    >
      <div ref={yiginRef} className="sticky top-0 z-40">
        <PublicNavbar center={center} bottom={bottom} expanded />
      </div>
      <main className="flex-1 p-4 sm:p-6">{children}</main>
      <SiteFooter />
      {/* Alt sekme çubuğu TÜM mobil sayfalarda durur (kullanıcı kararı,
          9 Eyl 2026). Sayfaların tasarımına dokunmaz; kendi spacer'ını
          çizdiği için içerik çubuğun altında kalmaz. */}
      <MobilAltSekmeler />
    </div>
  );
}
