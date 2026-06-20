import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { useUiPrefsStore } from "@/store/uiPrefsStore";
import { useBookings } from "@/hooks/useBookings";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS, BookingStatus } from "@/types";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { firstNameOf, timeGreeting } from "@/lib/greeting";
import { Seo } from "@/components/Seo";
import { JsonLd } from "@/components/JsonLd";
import { SITE_NAME, siteUrl, absoluteUrl } from "@/lib/seo";
import { SubjectCarousel } from "@/components/SubjectCarousel";
import { TutorCard } from "@/components/TutorCard";
import { HScroll } from "@/components/HScroll";
import { DashboardHeader } from "@/components/DashboardHeader";
import { PublicNavbar } from "@/components/PublicNavbar";
import { EXAMS, type ExamCategory } from "@/lib/examTree";
import { LEGAL_NAV } from "@/lib/legalNav";

// Bir sınavın tüm (benzersiz) derslerini ?subject=A&subject=B… sorgusuna çevirir.
function examSubjectQuery(exam: ExamCategory): string {
  const qs = [...new Set(exam.columns.flatMap((c) => c.items).map((i) => i.q))];
  return qs.map((q) => `subject=${encodeURIComponent(q)}`).join("&");
}

/* ─── redirect if already authenticated ─────────────── */

export default function Landing() {
  // Landing artık hem anonim hem giriş'li kullanıcının ana keşif ekranıdır;
  // giriş'li kullanıcı yönlendirilmez, navbar oturuma göre uyarlanır.
  return (
    <div className="min-h-screen bg-white antialiased dark:bg-slate-900">
      <Seo
        canonicalPath="/"
        description="Adana'da TYT, AYT, LGS, KPSS ve daha fazlası için alanında uzman, onaylı eğitmenlerle online veya yüz yüze özel ders. Hedefine ulaş."
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
      <Navbar />
      <SearchHero />
      <RecentlyViewed />
      <SubjectRows />
      <Footer />
    </div>
  );
}

/* ─── recently viewed listings (under the category bar) ── */

function RecentlyViewed() {
  const show = useUiPrefsStore((s) => s.showRecentlyViewed);
  const items = useRecentlyViewed();
  if (!show || items.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-6 pt-6 pb-2">
      <h2 className="mb-5 text-left text-xl font-bold tracking-tight text-slate-900 dark:text-white">
        Son Görüntülenen İlanlar
      </h2>
      <HScroll className="gap-5 pb-2">
        {items.map((tutor) => (
          <div key={tutor.id} className="w-[230px] shrink-0 sm:w-[250px]">
            <TutorCard tutor={tutor} />
          </div>
        ))}
      </HScroll>
    </section>
  );
}

/* ─── announcement banner ────────────────────────────── */

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

/* ─── navbar ─────────────────────────────────────────── */

function Navbar() {
  const token = useAuthStore((s) => s.token);
  const { data: user } = useCurrentUser();
  const loggedIn = !!token && !!user;

  // Giriş'liyken panel ekranının üst barını (nav ikonları + bildirim zili +
  // hesap menüsü) aynen kullan; anonimken pazarlama navbar'ı (kayıt/giriş).
  if (loggedIn) {
    const navItems =
      user.role_id === ROLE_IDS.TUTOR
        ? TUTOR_NAV
        : user.role_id === ROLE_IDS.CLIENT
          ? STUDENT_NAV
          : undefined;
    return <DashboardHeader navItems={navItems} transparent />;
  }

  return <PublicNavbar />;
}

/* ─── snow effect ──────────────────────────────────────── */

function Snow() {
  const particles = useMemo(() => Array.from({ length: 40 }).map(() => ({
    left: `${Math.random() * 100}%`,
    size: `${Math.random() * 5 + 3}px`,
    duration: `${Math.random() * 10 + 10}s`,
    delay: `-${Math.random() * 20}s`,
  })), []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-indigo-500/60 animate-snow-custom dark:bg-indigo-300/40"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animationDuration: p.duration,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  );
}

/* ─── personalized hero (logged-in) ──────────────────── */

function PersonalHero({
  firstName,
  isClient,
}: {
  firstName: string;
  isClient: boolean;
}) {
  // Yalnız giriş'liyken mount olur → useBookings güvenle çalışır (authed).
  const { data: bookings } = useBookings({ limit: 100 });
  const list = bookings ?? [];
  const upcoming = list.filter((b) => b.status === BookingStatus.ACCEPTED).length;
  const pending = list.filter((b) => b.status === BookingStatus.PENDING).length;

  const linkCls =
    "font-semibold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300";

  let subtitle: React.ReactNode = "Bugün hangi konuda ders almak istersin?";
  if (isClient && upcoming > 0) {
    subtitle = (
      <>
        Yaklaşan {upcoming > 1 ? `${upcoming} dersin` : "bir dersin"} var.{" "}
        <Link to={ROUTES.calendar} className={linkCls}>
          Takvime git →
        </Link>
      </>
    );
  } else if (isClient && pending > 0) {
    subtitle = (
      <>
        Bekleyen {pending > 1 ? `${pending} ders talebin` : "bir ders talebin"} var.{" "}
        <Link to={ROUTES.bookings} className={linkCls}>
          Görüntüle →
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-slate-900 dark:text-white sm:text-6xl sm:leading-tight">
        {timeGreeting()},{" "}
        <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
          {firstName}
        </span>
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-lg text-slate-500 dark:text-slate-400">
        {subtitle}
      </p>
    </>
  );
}

/* ─── search hero ────────────────────────────────────── */

function SearchHero() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const { data: user } = useCurrentUser();
  const firstName = firstNameOf(user?.full_name);
  const personalized = !!token && !!firstName;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`${ROUTES.tutors}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  };

  return (
    <section className="relative overflow-hidden bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(139,92,246,0.10),transparent)] pt-24 pb-12 sm:pt-32 sm:pb-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-indigo-100/40 blur-3xl"
      />
      <Snow />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-10 h-96 w-96 rounded-full bg-violet-100/40 blur-3xl"
      />

      {/* Increased max-w to 5xl so the carousel can be wider */}
      <div className="relative mx-auto max-w-5xl px-6 text-center">
        {personalized ? (
          <PersonalHero
            firstName={firstName}
            isClient={user?.role_id === ROLE_IDS.CLIENT}
          />
        ) : (
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-slate-900 dark:text-white sm:text-6xl sm:leading-tight">
            Uzman Eğitmenle Öğren,{" "}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              Hedefine Ulaş.
            </span>
          </h1>
        )}

        {/* Search bar is constrained to max-w-3xl, centered */}
        <form onSubmit={submit} className="mx-auto mt-12 flex h-14 max-w-3xl overflow-hidden rounded-full shadow-lg shadow-indigo-100 ring-1 ring-slate-200 dark:shadow-none dark:ring-slate-700">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Konu, sınav veya eğitmen ara… (ör. TYT Matematik)"
            className="flex-1 bg-white px-6 text-base sm:text-lg text-slate-900 outline-none placeholder:text-slate-400 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
          />
          <button
            type="submit"
            aria-label="Ara"
            className="flex w-20 sm:w-24 shrink-0 items-center justify-center bg-gradient-to-r from-indigo-600 to-violet-600 text-white transition hover:from-indigo-700 hover:to-violet-700 active:scale-95"
          >
            <svg className="h-6 w-6 -translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
            </svg>
          </button>
        </form>

        {/* Categories directly under search bar, fills max-w-5xl naturally */}
        <div className="mt-8">
          <SubjectCarousel />
        </div>
      </div>
    </section>
  );
}

/* ─── subject rows ───────────────────────────────────── */

const ROW_STYLES = [
  { bg: "bg-indigo-950",   text: "text-indigo-200",  title: "text-white",        btn: "bg-indigo-500 hover:bg-indigo-400",    card: "bg-indigo-900 ring-indigo-800"   },
  { bg: "bg-violet-50",    text: "text-violet-700",  title: "text-violet-900",   btn: "bg-violet-600 hover:bg-violet-700",   card: "bg-white ring-violet-100"        },
  { bg: "bg-slate-900",    text: "text-slate-300",   title: "text-white",        btn: "bg-slate-600 hover:bg-slate-500",     card: "bg-slate-800 ring-slate-700"     },
  { bg: "bg-emerald-50",   text: "text-emerald-700", title: "text-emerald-900",  btn: "bg-emerald-600 hover:bg-emerald-700", card: "bg-white ring-emerald-100"       },
  { bg: "bg-amber-950",    text: "text-amber-200",   title: "text-white",        btn: "bg-amber-500 hover:bg-amber-400",     card: "bg-amber-900 ring-amber-800"     },
  { bg: "bg-sky-50",       text: "text-sky-700",     title: "text-sky-900",      btn: "bg-sky-600 hover:bg-sky-700",         card: "bg-white ring-sky-100"           },
];

const EXAM_DESCS: Record<string, string> = {
  TYT:  "Üniversite sınavının birinci aşaması. Temel matematik, Türkçe ve fen bilimleri sorularını kapsar.",
  AYT:  "Alan Yeterlilik Testi. Tercih ettiğin bölüme göre sayısal, eşit ağırlık ya da sözel alanında sınava gir.",
  KPSS: "Kamu Personeli Seçme Sınavı. Devlet memurluğuna giden yolda lisans, önlisans ve ortaöğretim düzeyinde yapılır.",
  LGS:  "Liselere Geçiş Sınavı. 8. sınıf öğrencilerinin tercih ettiği liseye yerleşmesini belirler.",
  YDT:  "Yabancı Dil Testi. Yabancı dil puanıyla öğrenci alan üniversite programları için gereklidir.",
  DGS:  "Dikey Geçiş Sınavı. Önlisans mezunlarının lisans programına geçişini sağlar.",
  ALES: "Akademik Personel ve Lisansüstü Eğitimi Giriş Sınavı. Yüksek lisans ve doktora için zorunludur.",
  YDS:  "Yabancı Dil Bilgisi Seviye Tespit Sınavı. Akademik ve profesyonel kariyer için gerekli dil belgesi.",
  ÖABT: "Öğretmenlik Alan Bilgisi Testi. KPSS kapsamında öğretmenlik başvuruları için yapılır.",
  MSÜ:  "Milli Savunma Üniversitesi Sınavı. Harp okulu ve astsubay MYO'larına giriş için gereklidir.",
};

function SubjectRows() {
  const navigate = useNavigate();
  const shown = EXAMS.slice(0, 6);

  return (
    <div>
      {/* Wave Transition (only before the first row) */}
      <div className="-mb-1 w-full overflow-hidden rotate-180">
        <svg className="w-[125%] -ml-[12.5%] text-indigo-950" height="120" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,0 L100,0 C35,150 35,0 0,100z" fill="currentColor"></path>
        </svg>
      </div>

      {shown.map((exam, idx) => {
        const s = ROW_STYLES[idx % ROW_STYLES.length];
        const allItems = exam.columns.flatMap((c) => c.items);
        return (
          <section key={exam.label} className={`${s.bg} py-16`}>
            <div className="mx-auto max-w-6xl px-6">
              <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">

                {/* Left */}
                <div>
                  <h2 className={`text-8xl font-black leading-none ${s.title}`}>
                    {exam.label}
                  </h2>
                  <p className={`mt-5 text-lg leading-relaxed ${s.text}`}>
                    {EXAM_DESCS[exam.label] ?? "Alanında uzman eğitmenlerle çalış, hedefine ulaş."}
                  </p>
                  <button
                    onClick={() =>
                      navigate(
                        `${ROUTES.tutors}?${examSubjectQuery(exam)}&exam=${encodeURIComponent(exam.label)}`
                      )
                    }
                    className={`mt-8 rounded-xl px-7 py-3 text-sm font-bold text-white shadow transition active:scale-95 ${s.btn}`}
                  >
                    Eğitmen Bul →
                  </button>
                </div>

                {/* Right — subject card */}
                <div className={`rounded-2xl p-6 ring-1 ${s.card}`}>
                  <p className={`mb-4 text-xs font-semibold uppercase tracking-widest ${s.text}`}>
                    Çalışılan Konular
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {allItems.map((it) => (
                      <button
                        key={it.label}
                        onClick={() =>
                          navigate(
                            `${ROUTES.tutors}?subject=${encodeURIComponent(it.q)}&exam=${encodeURIComponent(exam.label)}`
                          )
                        }
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition hover:opacity-80 ${s.card} ${s.text}`}
                      >
                        {it.label}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ─── footer ─────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-white py-10 dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <Link to="/" className="flex items-center gap-2 transition hover:opacity-90">
          <img src="/logo.png" alt="Adana Özel Ders Logo" className="h-8 sm:h-10 w-auto object-contain grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition" />
        </Link>
        <div className="text-center text-sm text-slate-500 dark:text-slate-400 sm:text-right">
          <p>© {new Date().getFullYear()} Adana Özel Ders. Tüm hakları saklıdır.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-4 sm:justify-end">
            <Link to="?modal=login" className="transition hover:text-slate-900 dark:hover:text-white">Giriş Yap</Link>
            <Link to="?modal=register" className="transition hover:text-slate-900 dark:hover:text-white">Kayıt Ol</Link>
          </div>
        </div>
      </div>
      {/* Yasal sayfalar — lansman/iyzico gereği footer'dan her zaman erişilebilir */}
      <nav className="mx-auto mt-8 flex max-w-6xl flex-wrap justify-center gap-x-5 gap-y-2 border-t border-slate-100 px-6 pt-6 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        {LEGAL_NAV.map((item) => (
          <Link
            key={item.id}
            to={item.path}
            className="transition hover:text-slate-700 dark:hover:text-slate-300"
          >
            {item.title}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
