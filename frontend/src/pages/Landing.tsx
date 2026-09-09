import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  dersSorgusu,
  egitmenAramaAdresi,
} from "@/lib/aramaUrl";
import { ROLE_IDS, TeachingMode } from "@/types";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { Seo } from "@/components/Seo";
import { JsonLd } from "@/components/JsonLd";
import { SITE_NAME, siteUrl, absoluteUrl } from "@/lib/seo";
import { DashboardHeader } from "@/components/DashboardHeader";
import { PublicNavbar } from "@/components/PublicNavbar";
import { CategoryBar } from "@/components/CategoryBar";
import { SiteFooter } from "@/components/SiteFooter";
import { DersArama, CompactSearch } from "@/components/HeroSearch";
import type { DersSekli } from "@/components/AramaSecicileri";
import { FeaturedTutorRow, TutorRow } from "@/components/VitrinSeridi";
import { MobilAltSekmeler } from "@/components/MobilAltSekmeler";
import { MobilAramaSheet } from "@/components/MobilAramaSheet";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { type YerSecimi } from "@/lib/yerArama";

/* ─── ana sayfa ──────────────────────────────────────────
   Airbnb mantığı:
   • Üstte navbar = logo | kategori sekmeleri | hesap, ALTINDA büyük arama hapı.
   • Aşağı kaydırınca kategoriler gizlenir, arama ortaya KOMPAKT oturur, navbar
     kısalır. (scroll state)
   • Kategoriye tıklayınca yeni sayfaya GİTMEZ; içerik yerinde değişir.
   • İçerik = yatay listeler (Öne çıkan eğitmenler, Ortaokul Matematik, …). */

export default function Landing() {

  // Yeni arama modeli (29 Ağu): serbest metin yerine ders kategorisi + mekân.
  const [ders, setDers] = useState("");
  const [dersEtiket, setDersEtiket] = useState("");
  // Ders şekli TEK seçim; "" = fark etmez. Yer YALNIZ yüz yüzede sorulur,
  // bu yüzden ikisi ayrı state: biri diğerini ezemez.
  const [sekil, setSekil] = useState<DersSekli>("");
  const [yer, setYer] = useState<YerSecimi | null>(null);
  // Kütüphane sekmesinin KENDİ araması: ders şekli değil, ad + yer.
  const [scrolled, setScrolled] = useState(false);
  // Daralmışken kompakt aramaya tıklayınca geniş navbar'ı YERİNDE aç (sayfa
  // kaymaz). Tekrar kaydırınca kapanır.
  const [searchOpen, setSearchOpen] = useState(false);
  // Telefonda tam ekran arama yüzeyi açık mı (`MobilAramaSheet`).
  const [mobilAramaAcik, setMobilAramaAcik] = useState(false);
  const mobil = useMobil();
  const navigate = useNavigate();
  const setSurface = useSurfaceStore((s) => s.setSurface);

  // /hesabim bağlama duyarlı navbar: son yüzey = keşif.
  useEffect(() => {
    setSurface("discover");
  }, [setSurface]);

  /**
   * Airbnb scroll davranışı: birazcık kaydırınca daralt (ve açık aramayı kapat).
   *
   * TELEFONDA ÇALIŞMAZ ve bu bilinçlidir. İki sebep: (1) mobil üst bar zaten
   * kompakt — daraltacak bir şey yok; (2) yumuşak klavye açılınca sayfa kayar,
   * bu dinleyici de her kaymada `setSearchOpen(false)` çağırdığı için kullanıcı
   * yazmaya başlar başlamaz aramayı kendi üstüne kapatıyordu.
   *
   * Masaüstünde her scroll olayında setState yerine `requestAnimationFrame`
   * ile tek kare başına bir güncelleme yapılır.
   */
  useEffect(() => {
    if (mobil) {
      setScrolled(false);
      return;
    }
    let bekleyen = false;
    const onScroll = () => {
      if (bekleyen) return;
      bekleyen = true;
      requestAnimationFrame(() => {
        bekleyen = false;
        setScrolled(window.scrollY > 56);
        setSearchOpen(false);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mobil]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    /*
     * Adres artık `lib/aramaUrl`den gelir. Eskiden burada elle kuruluyordu ve
     * iki kusur taşıyordu: (a) yalnız SEÇİLMİŞ ders yazılıyordu, yani kutuya
     * "matematik" yazıp listeden seçmeden Ara'ya basan kullanıcı parametresiz
     * `/egitmenler` görüyordu; (b) "yer yalnız yüz yüzede" kuralı burada
     * vardı ama `useNavSearch`te yoktu. İkisi de şemaya taşındı.
     */
    navigate(
      egitmenAramaAdresi({
        ...dersSorgusu(ders, dersEtiket),
        sekil: sekil ? [sekil] : [],
        konum: { yer: yer?.tur === "mahalle" ? yer : null, ilce: yer ? [yer.ilce] : [] },
      })
    );
  };

  const expanded = !scrolled || searchOpen;
  const placeholder = "Ne öğrenmek istersin?";

  // key ile swap'te fade-in yeniden tetiklenir; sert geçiş yerine yumuşak.
  const center = (
    <div key={expanded ? "cats" : "compact"} className="animate-in fade-in duration-300">
      {/* Telefonda swap YOK: kompakt arama `mobilUst` yuvasında kalıcı olarak
          durur, bu yuva her zaman kategori çiplerini taşır. */}
      {expanded || mobil ? (
        <CategoryBar active="egitmenler" />
      ) : (
        <CompactSearch
          active="egitmenler"
          placeholder={placeholder}
          q={dersEtiket}
          district={sekil === TeachingMode.IN_PERSON && yer ? [yer.ilce] : []}
          remote={sekil === TeachingMode.ONLINE}
          onOpen={() => setSearchOpen(true)}
        />
      )}
    </div>
  );

  // Büyük arama her zaman mount; navbar daralınca header onu max-height ile
  // yumuşakça katlar (sert zıplama yerine). Wrapper kendi ortalasını yapar
  // (bottom slot artık justify-center içermiyor — her sayfa kendi hizalar).
  // Arama hapı SEKMEYE bakar (30 Ağu): eğitmenlerde ders+mekân, kütüphanelerde
  // ad/semt yazısı + ilçe (uzaktan seçeneği yok — fiziksel mekân).
  //
  // 7 Eyl 2026: iki hap TASARIM OLARAK ikizlendi (kullanıcı kararı). Önce
  // kütüphane sekmesi `BigSearch` basıyordu — pin + açılır ilçe menüsü +
  // serbest metin; sekme değişince çubuğun kendisi değişiyordu. Artık ikisi de
  // aynı kabuk, aynı sıralama, aynı eşit bölmeler; fark yalnız sağ bölmenin
  // seçicisinde. Nöbetçi: `__guards__/aramaHapiIkizligi.test.ts`.
  const hap = (
    <DersArama
      ders={ders}
      dersEtiket={dersEtiket}
      onDersChange={(qDeger, etiket) => {
        setDers(qDeger);
        setDersEtiket(etiket);
      }}
      sekil={sekil}
      setSekil={setSekil}
      yer={yer}
      setYer={setYer}
      onSubmit={submit}
    />
  );

  /* Masaüstünün ikinci navbar satırı. Telefonda BU YUVA HİÇ DOLDURULMAZ:
     aynı hapın iki kopyası mount edilseydi `htmlFor` kimlikleri belgede
     ikilenir, etiket-girdi bağı belirsizleşirdi. Mobilde hap yalnız tam ekran
     arama açıkken, tek kopya olarak yaşar. */
  const bottom = mobil ? undefined : (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">{hap}</div>
  );

  const mobilUst = mobil ? (
    <CompactSearch
      active="egitmenler"
      // Telefonda hap sekmeye göre değişen bir metin taşımaz: kategori zaten
      // hemen altındaki çip şeridinde seçili, hapın işi davet etmek.
      placeholder="Aramaya başlayın"
      q={dersEtiket}
      district={sekil === TeachingMode.IN_PERSON && yer ? [yer.ilce] : []}
      remote={sekil === TeachingMode.ONLINE}
      onOpen={() => setMobilAramaAcik(true)}
    />
  ) : undefined;

  return (
    <div className="min-h-screen bg-white antialiased ">
      <Seo
        canonicalPath="/"
        description="Adana'da TYT, AYT, LGS, KPSS ve daha fazlası için alanında uzman, onaylı eğitmenlerle online veya yüz yüze özel ders. Kütüphaneler ve denemeler tek yerde."
      >
        <JsonLd
          data={[
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              name: SITE_NAME,
              url: siteUrl(),
              logo: absoluteUrl("/logo.png"),
            },
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: SITE_NAME,
              url: siteUrl(),
              potentialAction: {
                "@type": "SearchAction",
                target: `${siteUrl()}/egitmenler?q={search_term_string}`,
                "query-input": "required name=search_term_string",
              },
            },
          ]}
        />
      </Seo>
      <Navbar
        center={center}
        bottom={bottom}
        mobilUst={mobilUst}
        mobilSade
        expanded={expanded}
      />
      {/* Mağaza çapraz tanıtım banner'ı KALDIRILDI (kullanıcı kararı, 29 Ağu):
          "kocaman hero" özel ders sayfasında yer kaplıyordu; mağazaya geçiş
          navbar'daki Mağaza linkinden yapılır. */}
      <CategoryContent />
      <SiteFooter />
      <MobilAramaSheet
        open={mobilAramaAcik}
        onClose={() => setMobilAramaAcik(false)}
      >
        {hap}
      </MobilAramaSheet>
      <MobilAltSekmeler />
    </div>
  );
}

/* ─── navbar ─────────────────────────────────────────────
   Kategoriler/kompakt arama center'a, büyük arama bottom'a geçirilir. */

function Navbar({
  center,
  bottom,
  mobilUst,
  mobilSade = false,
  expanded,
}: {
  center: ReactNode;
  bottom?: ReactNode;
  mobilUst?: ReactNode;
  mobilSade?: boolean;
  expanded: boolean;
}) {
  const token = useAuthStore((s) => s.token);
  const { data: user } = useCurrentUser();
  const loggedIn = !!token && !!user;

  if (loggedIn) {
    const navItems =
      user.role_id === ROLE_IDS.TUTOR
        ? TUTOR_NAV
        : user.role_id === ROLE_IDS.CLIENT
          ? UYE_NAV
          : undefined;
    return (
      <DashboardHeader
        navItems={navItems}
        transparent
        center={center}
        bottom={bottom}
        mobilUst={mobilUst}
        mobilSade={mobilSade}
        expanded={expanded}
      />
    );
  }

  return (
    <PublicNavbar
      center={center}
      bottom={bottom}
      mobilUst={mobilUst}
      mobilSade={mobilSade}
      expanded={expanded}
    />
  );
}

/* ─── sekmeye göre değişen içerik = yatay listeler ──────── */

function CategoryContent() {
  return (
    <main className="space-y-8 pb-8 pt-4 md:space-y-12 md:pb-24 md:pt-8">
      {/* ── EĞİTMENLER: TEK kuşak ──────────────────────────────────────────
          Burada eskiden "TYT'ye hazırlık" / "YKS Hazırlık" / "AYT'ye
          hazırlık" / "Ortaokul Matematik" / "LGS Matematik" diye SABİT
          yazılmış kuşaklar vardı. İkisi gerçek bir daraltma yapıyordu
          (`subject` sert filtredir), üçü YAPMIYORDU: `exam` backend'de sert
          filtre değil, yalnız SIRALAMA BOOST'udur, üç kuşak da aynı eğitmen
          listesini gösteriyordu (ölçüm: 7 eğitmenin üçünde de aynısı).
          Kategori vaat edip kategori uygulamayan başlık, kullanıcıya "sahte
          veri" gibi görünür; şikâyetin sebebi buydu.

          Sadeleştirme: tek dürüst başlık. Kuşak boşsa `TutorRow` zaten
          kendini gizler. Kategori kırılımı, arz gerçekten kategori başına
          anlamlı sayıya ulaştığında ve VERİDEN türetilebildiğinde geri
          gelmelidir, sabit liste olarak değil.
          Nöbetçi: `__guards__/egitmenKusaklari.test.tsx`. */}
      {/* Ücretli öne çıkarma şeridi — eğitmen kuşağının ÜSTÜNDE ve ondan
          bağımsız bir uçtan gelir. Organik kuşağın sırasını değiştirmez;
          "Reklam" ibaresi yönetmelik gereği zorunludur ve blok yalnız
          yürürlükte bir paket varsa çizilir. Ana sayfa filtresiz olduğu için
          burada eşleşme daraltması yoktur, arama sayfasındaki blok ise
          aramanın filtrelerine tabidir. */}
      {/* TEK VİTRİN (9 Eyl 2026). Ana sayfa artık kategori sekmesine göre
          içerik değiştirmiyor: sekmeler gerçek gezinme oldu, kütüphane
          şeritleri `/kutuphaneler` sayfasına taşındı. Bayrak kontrolleri de
          onlarla birlikte gitti — `/kutuphaneler` rotası zaten bayrakla
          kapılı, ikinci kontrol ölü koddu. */}
      <FeaturedTutorRow />
      <TutorRow heading="Eğitmenler" params={{ limit: 12, offset: 0 }} />
    </main>
  );
}

/**
 * Vitrin kartının genişliği — konteynere BAĞLI, sabit piksel DEĞİL.
 *
 * Kartlar `w-[210px]` sabitken satırın sağ kenarı konteynerle hizalanmıyordu:
 * içerik genişliği 1216-48 = 1168px, beş kart ise 5x210 + 4x20 = 1130px
 * tutuyordu ve kalan 38px son kartı sağ kenardan içeride bırakıyordu. Kaydırma
 * okları konteynerin sağ ucunda durduğu için fark gözle görülür haldeydi.
 *
 * Konteyner ölçüsünü (`max-w-[1216px]`) küçültmek çözüm DEĞİL: aynı ölçü
 * `SiteFooter`da da kullanılıyor, yani hizasızlık sayfanın başka yerine kayardı.
 * Bunun yerine kart genişliği kalan alandan hesaplanıyor; boşluk `gap-5` (20px)
 * olduğundan çıkarılan değer (kart sayısı - 1) x 20.
 *
 * Kart sayısı ekran genişliğiyle artar ve her eşikte kart ~220px civarında
 * kalır; sabit piksel kullanılsaydı ya dar ekranda taşar ya geniş ekranda
 * boşluk bırakırdı.
 */
