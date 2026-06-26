import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";
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
import { BigSearch, CompactSearch } from "@/components/HeroSearch";
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
  const [scrolled, setScrolled] = useState(false);
  // Daralmışken kompakt aramaya tıklayınca geniş navbar'ı YERİNDE aç (sayfa
  // kaymaz). Tekrar kaydırınca kapanır.
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();

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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const base =
      active === "kutuphaneler" || active === "denemeler"
        ? ROUTES.libraries
        : ROUTES.tutors;
    const sp = new URLSearchParams();
    district.forEach((d) => sp.append("district", d));
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
      <CategoryContent active={active} />
      <Footer />
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
      {active === "hepsi" && (
        <>
          <TutorRow
            heading="Ortaokul Matematik"
            params={{ limit: 12, offset: 0, subject: ["Matematik"], exam: "LGS" }}
          />
          <TutorRow
            heading="TYT'ye hazırlık"
            params={{ limit: 12, offset: 0, exam: "TYT" }}
          />
          <LibraryRow
            heading="Kütüphaneler & etüt merkezleri"
            params={{ limit: 12, offset: 0 }}
          />
        </>
      )}

      {active === "egitmenler" && (
        <>
          <TutorRow
            heading="YKS Hazırlık"
            params={{ limit: 12, offset: 0, exam: "YKS" }}
          />
          {/* "LGS Matematik": subject SERT filtre olduğu için gerçek ders adı
              ("Matematik") ile süzülür; exam ("LGS") yalnız sıralamayı öne çeker. */}
          <TutorRow
            heading="LGS Matematik"
            params={{ limit: 12, offset: 0, subject: ["Matematik"], exam: "LGS" }}
          />
          {/* İlkokul: taksonomiye eklenen ilkokula özgü derslerle (Okuma-Yazma,
              Hayat Bilgisi) süzülür; eğitmen bu dersleri ilan ettikçe dolar. */}
          <TutorRow
            heading="İlkokul Okuma-Yazma ve Tüm Dersler"
            params={{ limit: 12, offset: 0, subject: ["Okuma-Yazma", "Hayat Bilgisi"] }}
          />
        </>
      )}

      {active === "kutuphaneler" && (
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

      {active === "denemeler" && (
        <>
          <LibraryRow
            heading="Deneme oturumu olan kütüphaneler"
            params={{ limit: 20, offset: 0 }}
          />
          <TutorRow
            heading="TYT'ye hazırlık"
            params={{ limit: 12, offset: 0, exam: "TYT" }}
          />
          <TutorRow
            heading="AYT'ye hazırlık"
            params={{ limit: 12, offset: 0, exam: "AYT" }}
          />
        </>
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
    <section className="mx-auto max-w-6xl px-6">
      <RowHeader heading={heading} href={href} />
      {isLoading ? (
        <RowSkeleton />
      ) : (
        <HScroll className="gap-5 pb-2">
          {data!.map((tutor) => (
            <div key={tutor.id} className="w-[175px] shrink-0 sm:w-[190px]">
              <TutorCard tutor={tutor} showBookmark={false} />
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
    <section className="mx-auto max-w-6xl px-6">
      <RowHeader heading={heading} href={href} />
      {isLoading ? (
        <RowSkeleton />
      ) : (
        <HScroll className="gap-5 pb-2">
          {data!.map((lib) => (
            <div key={lib.id} className="w-[215px] shrink-0 sm:w-[235px]">
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

/* ─── footer ─────────────────────────────────────────────── */

function Footer() {
  const token = useAuthStore((s) => s.token);
  const { data: user } = useCurrentUser();
  const loggedIn = !!token && !!user;

  const linkCls = "transition hover:text-slate-900 dark:hover:text-white";

  return (
    <footer className="border-t border-slate-100 bg-white py-10 dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <Link to="/" className="flex items-center gap-2 transition hover:opacity-90">
          <img src="/logo.png" alt="Adana Özel Ders Logo" className="h-8 sm:h-10 w-auto object-contain grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition" />
        </Link>
        <div className="text-center text-sm text-slate-500 dark:text-slate-400 sm:text-right">
          <p>© {new Date().getFullYear()} Adana Özel Ders. Tüm hakları saklıdır.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 sm:justify-end">
            {/* Yasal: tek giriş noktası — diğer 4 belge bu sayfaların kenar menüsünden. */}
            <Link to={ROUTES.privacy} className={linkCls}>Gizlilik</Link>
            <Link to={ROUTES.terms} className={linkCls}>Şartlar</Link>
            {!loggedIn && (
              <>
                <Link to="?modal=login" className={linkCls}>Giriş Yap</Link>
                <Link to="?modal=register" className={linkCls}>Kayıt Ol</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
