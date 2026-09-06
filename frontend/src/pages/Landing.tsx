import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS, TeachingMode } from "@/types";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { Seo } from "@/components/Seo";
import { JsonLd } from "@/components/JsonLd";
import { SITE_NAME, siteUrl, absoluteUrl } from "@/lib/seo";
import { TutorCard } from "@/components/TutorCard";
import { LibraryCard } from "@/components/LibraryCard";
import { HScroll } from "@/components/HScroll";
import { DashboardHeader } from "@/components/DashboardHeader";
import { PublicNavbar } from "@/components/PublicNavbar";
import { CategoryBar, type CategoryKey } from "@/components/CategoryBar";
import { DENEMELER_ACIK, KUTUPHANELER_ACIK } from "@/lib/ozellikBayraklari";
import { SiteFooter } from "@/components/SiteFooter";
import { BigSearch, DersArama, CompactSearch } from "@/components/HeroSearch";
import type { MekanDegeri } from "@/components/MekanSelect";
import { useFeaturedTutors, useTutorSearch } from "@/hooks/useTutorSearch";
import { useLibrarySearch } from "@/hooks/useLibraries";
import type { TutorSearchParams } from "@/api/tutors";
import type { LibrarySearchParams } from "@/api/libraries";

/* ─── ana sayfa ──────────────────────────────────────────
   Airbnb mantığı:
   • Üstte navbar = logo | kategori sekmeleri | hesap, ALTINDA büyük arama hapı.
   • Aşağı kaydırınca kategoriler gizlenir, arama ortaya KOMPAKT oturur, navbar
     kısalır. (scroll state)
   • Kategoriye tıklayınca yeni sayfaya GİTMEZ; içerik yerinde değişir.
   • İçerik = yatay listeler (Öne çıkan eğitmenler, Ortaokul Matematik, …). */

const HERO_PLACEHOLDER: Record<CategoryKey, string> = {
  egitmenler: "Ders, eğitmen ya da konu ara…",
  kutuphaneler: "Kütüphane adı veya semt ara…",
  denemeler: "TYT, AYT, deneme oturumu ara…",
};

export default function Landing() {
  const [active, setActive] = useState<CategoryKey>("egitmenler");
  // Yeni arama modeli (29 Ağu): serbest metin yerine ders kategorisi + mekân.
  const [ders, setDers] = useState("");
  const [dersEtiket, setDersEtiket] = useState("");
  const [mekan, setMekan] = useState<MekanDegeri>({ online: false, yuzyuze: false, district: [] });
  // Kütüphane sekmesinin KENDİ araması: ders/mekân değil, ad-semt + ilçe.
  const [kutQ, setKutQ] = useState("");
  const [kutDistrict, setKutDistrict] = useState<string[]>([]);
  const [scrolled, setScrolled] = useState(false);
  // Daralmışken kompakt aramaya tıklayınca geniş navbar'ı YERİNDE aç (sayfa
  // kaymaz). Tekrar kaydırınca kapanır.
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();
  const setSurface = useSurfaceStore((s) => s.setSurface);

  // /hesabim bağlama duyarlı navbar: son yüzey = keşif.
  useEffect(() => {
    setSurface("discover");
  }, [setSurface]);

  // Airbnb scroll davranışı: birazcık kaydırınca daralt (ve açık aramayı kapat).
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 56);
      setSearchOpen(false);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const kutSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams();
    if (kutQ.trim()) sp.set("q", kutQ.trim());
    kutDistrict.forEach((d) => sp.append("district", d));
    const qs = sp.toString();
    navigate(`${ROUTES.libraries}${qs ? `?${qs}` : ""}`);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams();
    if (ders) sp.append("subject", ders);
    // İki mekân da (veya hiçbiri) seçiliyse filtre uygulanmaz — tek arama
    // her iki mekânı birden kapsar (kullanıcı tasarımı).
    if (mekan.online && !mekan.yuzyuze) sp.set("mode", TeachingMode.ONLINE);
    if (mekan.yuzyuze && !mekan.online) sp.set("mode", TeachingMode.IN_PERSON);
    if (mekan.yuzyuze) mekan.district.forEach((d) => sp.append("district", d));
    const qs = sp.toString();
    navigate(`${ROUTES.tutors}${qs ? `?${qs}` : ""}`);
  };

  const expanded = !scrolled || searchOpen;
  const placeholder = HERO_PLACEHOLDER[active];

  // key ile swap'te fade-in yeniden tetiklenir; sert geçiş yerine yumuşak.
  const center = (
    <div key={expanded ? "cats" : "compact"} className="animate-in fade-in duration-300">
      {expanded ? (
        <CategoryBar active={active} onSelect={setActive} />
      ) : (
        <CompactSearch
          active={active}
          placeholder={placeholder}
          q={active === "kutuphaneler" ? kutQ : dersEtiket}
          district={active === "kutuphaneler" ? kutDistrict : mekan.yuzyuze ? mekan.district : []}
          remote={active !== "kutuphaneler" && mekan.online && !mekan.yuzyuze}
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
  const bottom = (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">
      {active === "kutuphaneler" ? (
        <BigSearch
          q={kutQ}
          setQ={setKutQ}
          district={kutDistrict}
          setDistrict={setKutDistrict}
          showRemoteOption={false}
          onSubmit={kutSubmit}
          placeholder={HERO_PLACEHOLDER.kutuphaneler}
        />
      ) : (
        <DersArama
          ders={ders}
          dersEtiket={dersEtiket}
          onDersChange={(qDeger, etiket) => {
            setDers(qDeger);
            setDersEtiket(etiket);
          }}
          mekan={mekan}
          setMekan={setMekan}
          onSubmit={submit}
        />
      )}
    </div>
  );

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
      <Navbar center={center} bottom={bottom} expanded={expanded} />
      {/* Mağaza çapraz tanıtım banner'ı KALDIRILDI (kullanıcı kararı, 29 Ağu):
          "kocaman hero" özel ders sayfasında yer kaplıyordu; mağazaya geçiş
          navbar'daki Mağaza linkinden yapılır. */}
      <CategoryContent active={active} />
      <SiteFooter />
    </div>
  );
}

/* ─── navbar ─────────────────────────────────────────────
   Kategoriler/kompakt arama center'a, büyük arama bottom'a geçirilir. */

function Navbar({
  center,
  bottom,
  expanded,
}: {
  center: ReactNode;
  bottom?: ReactNode;
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
          ? STUDENT_NAV
          : undefined;
    return (
      <DashboardHeader
        navItems={navItems}
        transparent
        center={center}
        bottom={bottom}
        expanded={expanded}
      />
    );
  }

  return <PublicNavbar center={center} bottom={bottom} expanded={expanded} />;
}

/* ─── sekmeye göre değişen içerik = yatay listeler ──────── */

function CategoryContent({ active }: { active: CategoryKey }) {
  return (
    <main className="space-y-12 pb-24 pt-8">
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
      {active === "egitmenler" && <FeaturedTutorRow />}

      {active === "egitmenler" && (
        <TutorRow heading="Eğitmenler" params={{ limit: 12, offset: 0 }} />
      )}

      {KUTUPHANELER_ACIK && active === "kutuphaneler" && (
        <>
          <LibraryRow
            heading="Çukurova Kütüphaneleri"
            params={{ limit: 20, offset: 0, district: ["Çukurova"] }}
          />
          <LibraryRow
            heading="Seyhan Kütüphaneleri"
            params={{ limit: 20, offset: 0, district: ["Seyhan"] }}
          />
          <LibraryRow
            heading="Yüreğir Kütüphaneleri"
            params={{ limit: 20, offset: 0, district: ["Yüreğir"] }}
          />
          <LibraryRow
            heading="Sarıçam Kütüphaneleri"
            params={{ limit: 20, offset: 0, district: ["Sarıçam"] }}
          />
        </>
      )}

      {DENEMELER_ACIK && active === "denemeler" && (
        <LibraryRow
          heading="Deneme oturumu olan kütüphaneler"
          params={{ limit: 20, offset: 0 }}
        />
      )}
    </main>
  );
}

function RowHeader({ heading, href }: { heading: string; href: string }) {
  // Airbnb deseni (29 Ağu): sağdaki "Tümü →" metni yerine başlığın hemen
  // yanında gri dairesel ok butonu — tamamına o götürür.
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <h2 className="text-xl font-bold tracking-tight text-slate-900 ">
        {heading}
      </h2>
      <Link
        to={href}
        aria-label={`${heading}, tümünü gör`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" />
        </svg>
      </Link>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex gap-5 overflow-hidden">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="h-60 w-[175px] shrink-0 animate-pulse rounded-2xl bg-slate-100 "
        />
      ))}
    </div>
  );
}

function FeaturedTutorRow() {
  const { data } = useFeaturedTutors({});
  const tutors = data ?? [];
  if (tutors.length === 0) return null;

  return (
    <section aria-label="Reklam" className="mx-auto max-w-[1216px] px-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500">
          Reklam
        </h2>
        <Link
          to={ROUTES.rankingCriteria}
          className="text-xs text-slate-400 underline-offset-2 transition hover:text-slate-600 hover:underline"
        >
          Sıralama nasıl belirleniyor?
        </Link>
      </div>
      <HScroll className="gap-5 pb-2">
        {tutors.map((tutor) => (
          <div key={tutor.id} className="w-[190px] shrink-0 sm:w-[210px]">
            <TutorCard tutor={tutor} featured />
          </div>
        ))}
      </HScroll>
      <div className="mt-8 h-px w-full bg-slate-200" />
    </section>
  );
}

function TutorRow({
  heading,
  params,
}: {
  heading: string;
  params: TutorSearchParams;
}) {
  const { data, isLoading } = useTutorSearch(params);

  // Boş satırı hiç gösterme (örn. o branşta eğitmen yoksa).
  if (!isLoading && (!data || data.length === 0)) return null;

  const sp = new URLSearchParams();
  params.subject?.forEach((s) => sp.append("subject", s));
  if (params.exam) sp.set("exam", params.exam);
  const href = `${ROUTES.tutors}${sp.toString() ? `?${sp}` : ""}`;

  return (
    <section className="mx-auto max-w-[1216px] px-6">
      <RowHeader heading={heading} href={href} />
      {isLoading ? (
        <RowSkeleton />
      ) : (
        <HScroll className="gap-5 pb-2">
          {data!.map((tutor) => (
            <div key={tutor.id} className="w-[190px] shrink-0 sm:w-[210px]">
              <TutorCard tutor={tutor} />
            </div>
          ))}
        </HScroll>
      )}
    </section>
  );
}

function LibraryRow({
  heading,
  params,
}: {
  heading: string;
  params: LibrarySearchParams;
}) {
  const { data, isLoading } = useLibrarySearch(params);

  if (!isLoading && (!data || data.length === 0)) return null;

  const sp = new URLSearchParams();
  params.district?.forEach((d) => sp.append("district", d));
  const href = `${ROUTES.libraries}${sp.toString() ? `?${sp}` : ""}`;

  return (
    <section className="mx-auto max-w-[1216px] px-6">
      <RowHeader heading={heading} href={href} />
      {isLoading ? (
        <RowSkeleton />
      ) : (
        <HScroll className="gap-5 pb-2">
          {data!.map((lib) => (
            <div key={lib.id} className="w-[190px] shrink-0 sm:w-[210px]">
              <LibraryCard library={lib} />
            </div>
          ))}
        </HScroll>
      )}
    </section>
  );
}

/* ─── announcement banner (başka yerden de kullanılabilir) ── */

export function AnnouncementBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="relative bg-marka px-4 py-2.5 text-center text-xs font-semibold text-marka-fg sm:text-sm">
      <span>
        🎓 YKS 2025 hazırlığına başla - uzman eğitmenlerle ilk dersin{" "}
        <Link to={ROUTES.tutors} className="underline underline-offset-2 hover:text-marka-fg">
          hemen randevu al →
        </Link>
      </span>
      <button
        onClick={() => setVisible(false)}
        aria-label="Kapat"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-white/70 transition hover:text-white"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/* Footer artık ortak `components/SiteFooter.tsx` — mağaza ve PublicShell ile
   aynı bileşen (linkler + iyzico ödeme rozeti tek yerden yönetilir). */
