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
import { BigSearch, CompactSearch } from "@/components/HeroSearch";
import { CrossPromoBanner } from "@/components/CrossPromoBanner";
import CROSS_PROMO from "@/config/crossPromo.json";
import { useTutorSearch } from "@/hooks/useTutorSearch";
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
  hepsi: "Ders, eğitmen, kütüphane ara…",
  egitmenler: "Ders, eğitmen ya da konu ara…",
  kutuphaneler: "Kütüphane adı veya semt ara…",
  denemeler: "TYT, AYT, deneme oturumu ara…",
};

export default function Landing() {
  const [active, setActive] = useState<CategoryKey>("hepsi");
  const [q, setQ] = useState("");
  const [district, setDistrict] = useState<string[]>([]);
  const [remote, setRemote] = useState(false);
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

  // Kütüphane/deneme aramasında "Uzaktan Eğitim" anlamsız (fiziksel mekan).
  const showRemoteOption = active !== "kutuphaneler" && active !== "denemeler";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const base =
      active === "kutuphaneler" || active === "denemeler"
        ? ROUTES.libraries
        : ROUTES.tutors;
    const sp = new URLSearchParams();
    district.forEach((d) => sp.append("district", d));
    if (showRemoteOption && remote) sp.set("mode", TeachingMode.ONLINE);
    if (q.trim()) sp.set("q", q.trim());
    const qs = sp.toString();
    navigate(`${base}${qs ? `?${qs}` : ""}`);
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
          q={q}
          district={district}
          remote={showRemoteOption && remote}
          onOpen={() => setSearchOpen(true)}
        />
      )}
    </div>
  );

  // Büyük arama her zaman mount; navbar daralınca header onu max-height ile
  // yumuşakça katlar (sert zıplama yerine). Wrapper kendi ortalasını yapar
  // (bottom slot artık justify-center içermiyor — her sayfa kendi hizalar).
  const bottom = (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">
      <BigSearch
        q={q}
        setQ={setQ}
        district={district}
        setDistrict={setDistrict}
        remote={remote}
        setRemote={setRemote}
        showRemoteOption={showRemoteOption}
        onSubmit={submit}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-white antialiased dark:bg-slate-900">
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
      <div className="mx-auto max-w-[1216px] px-6 pt-8">
        {/* Örtü ölçümle seçildi (docs/ip-c1/):
            • Örtüsüz turuncu metin — ortada yeşil zeminde 1.51, sola yaslıyken
              defter/kâğıt dekorunun üstünde 1.01. Örtü GEREKLİ.
            • Uniform alfa taraması, metin SOLDAYKEN: en düşük güvenli değer
              0.70. Bir kademe üstü → 0.80.
            • Orta yerdeki siyah "hap" yerine yönlü gradyan: en koyu uç metnin
              tarafında, karşı taraf saydam. 0.80 metnin bittiği yere kadar
              (%26) korunur, sonra %62'de tamamen söner — sağdaki dekor
              (kalem/silgi/cetvel) kirlenmeden kalsın diye. */}
        <CrossPromoBanner
          imageSrc={CROSS_PROMO.landingToStore.imageSrc}
          heading="Mağaza"
          headingStyle={{ color: "#F6AD55" }}
          align="left"
          scrimClassName="bg-gradient-to-r from-black/80 from-0% via-black/80 via-26% to-transparent to-62%"
          to={ROUTES.store}
          ariaLabel={CROSS_PROMO.landingToStore.ariaLabel}
        />
      </div>
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
          filtre değil, yalnız SIRALAMA BOOST'udur — üç kuşak da aynı eğitmen
          listesini gösteriyordu (ölçüm: 7 eğitmenin üçünde de aynısı).
          Kategori vaat edip kategori uygulamayan başlık, kullanıcıya "sahte
          veri" gibi görünür; şikâyetin sebebi buydu.

          Sadeleştirme: tek dürüst başlık. Kuşak boşsa `TutorRow` zaten
          kendini gizler. Kategori kırılımı, arz gerçekten kategori başına
          anlamlı sayıya ulaştığında ve VERİDEN türetilebildiğinde geri
          gelmelidir — sabit liste olarak değil.
          Nöbetçi: `__guards__/egitmenKusaklari.test.tsx`. */}
      {(active === "hepsi" || active === "egitmenler") && (
        <TutorRow heading="Eğitmenler" params={{ limit: 12, offset: 0 }} />
      )}

      {/* Kütüphane kuşakları yalnız bölüm AÇIKKEN çizilir: donmuş bölüme
          giden kart, "Yakında" ekranına tıklatırdı. */}
      {KUTUPHANELER_ACIK && active === "hepsi" && (
        <LibraryRow
          heading="Kütüphaneler & etüt merkezleri"
          params={{ limit: 12, offset: 0 }}
        />
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
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
        {heading}
      </h2>
      <Link
        to={href}
        className="shrink-0 text-sm font-semibold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-300"
      >
        Tümü →
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
          className="h-60 w-[175px] shrink-0 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
        />
      ))}
    </div>
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
            <div key={lib.id} className="w-[235px] shrink-0 sm:w-[255px]">
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
    <div className="relative bg-indigo-600 px-4 py-2.5 text-center text-xs font-semibold text-white sm:text-sm">
      <span>
        🎓 YKS 2025 hazırlığına başla - uzman eğitmenlerle ilk dersin{" "}
        <Link to={ROUTES.tutors} className="underline underline-offset-2 hover:text-indigo-100">
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
