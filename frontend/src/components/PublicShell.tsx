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
  mobilUst,
  mobilSade = false,
  altBilgiGizli = false,
  mobilDetayEkrani = false,
}: {
  children: ReactNode;
  /** Navbar ortasına yerleşen içerik (ör. arama pill'i). */
  center?: ReactNode;
  /** Navbar'ın alt satırına yerleşen içerik (ör. filtre çubuğu). */
  bottom?: ReactNode;
  /** Telefonda (yalnız `<md`) en üstte duran içerik — bkz. `PublicNavbar`. */
  mobilUst?: ReactNode;
  /**
   * Telefonda logo ve giriş/kayıt düğmelerini üst bardan kaldırır
   * (bkz. `PublicNavbar`daki aynı adlı prop).
   *
   * Varsayılan `false` BİLİNÇLİDİR: bu kabuğu kullanan sayfaların çoğunda üst
   * barda arama yoktur ve bayrak açılsaydı telefonda bomboş bir şerit
   * kalırdı. Yalnız kendi başına ayakta duran, gezinmesini alt sekme
   * çubuğuna bırakan yüzeyler açar.
   */
  mobilSade?: boolean;
  /**
   * Sayfanın altındaki `SiteFooter`ı çizme.
   *
   * Varsayılan `false`: footer sitenin her public sayfasında durur ve yasal
   * bağlantıları oradan taşınır. İstisna, KISA BOŞ DURUM ekranlarıdır —
   * orada footer içeriğin hemen dibinde bitiyor ve sayfanın asıl mesajıyla
   * (tek bir eylem) yarışıyor. Yasal bağlantılar kaybolmaz: aynı ekrandan
   * bir dokunuşla ulaşılan her sayfada footer duruyor.
   */
  altBilgiGizli?: boolean;
  /**
   * MOBİL DETAY EKRANI — telefonda sayfa kendi kabuğunu yönetir.
   *
   * `<md` bandında ÜÇ şeyi birlikte yapar: üst barı çizmez, alt sekme
   * çubuğunu çizmez, `main` padding'ini sıfırlar. Üçü tek bayrakta çünkü üçü
   * de aynı kararın parçası; ayrı bayraklar olsaydı "üst bar yok ama padding
   * var" gibi hiç tasarlanmamış kombinasyonlar mümkün olurdu.
   *
   * Açan yüzey, sayfadan ÇIKIŞI kendi taşımak zorundadır (gezinmenin ikisi de
   * kalkıyor). Bugünkü tek açan: eğitmen profili — fotoğrafın üstündeki yüzen
   * geri düğmesi. Nöbetçi: `__guards__/egitmenProfiliMobil.test.tsx`.
   */
  mobilDetayEkrani?: boolean;
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
      /* `--sabit-serit`: sayfa seviyesinde sabit bir CTA şeridi varsa
         (`DersTalepSeridi`) sayfanın son içeriği onun altında kalmasın. Şerit
         çizilmediğinde değişken tanımsızdır ve bırakılan boşluk 0'dır.
         Boşluğun BURADA olması şart: `main`in içine konan bir yer tutucu
         `SiteFooter`ın ÜSTÜNDE kalıyordu — ölçüldü, 10 Eyl 2026. */
      style={
        {
          "--yapiskan-ust": `${yapiskanUst}px`,
          paddingBottom: "var(--sabit-serit, 0px)",
        } as CSSProperties
      }
    >
      <div
        ref={yiginRef}
        className={`sticky top-0 z-40 ${mobilDetayEkrani ? "hidden md:block" : ""}`}
      >
        <PublicNavbar center={center} bottom={bottom} mobilUst={mobilUst} mobilSade={mobilSade} expanded />
      </div>
      <main className={mobilDetayEkrani ? "flex-1 p-0 md:p-6" : "flex-1 p-4 sm:p-6"}>
        {children}
      </main>
      {!altBilgiGizli && <SiteFooter />}
      {/* Alt sekme çubuğu mobil sayfaların VARSAYILANIDIR (kullanıcı kararı,
          9 Eyl 2026): sayfaların tasarımına dokunmaz ve kendi spacer'ını
          çizdiği için içerik çubuğun altında kalmaz.

          Tek istisna `mobilDetayEkrani` (kullanıcı kararı, 10 Eyl 2026): tek
          bir ilana odaklanan detay ekranında hem üst bar hem çubuk kalkar,
          ekranı içerik doldurur. Orada çıkışı sayfanın kendi geri düğmesi
          taşır — bkz. propun açıklaması. */}
      {!mobilDetayEkrani && <MobilAltSekmeler />}
    </div>
  );
}
