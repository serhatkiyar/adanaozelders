import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { roleHome } from "@/lib/roles";
import { FullScreenSpinner } from "@/components/Spinner";
import { EXAMS, type ExamCategory } from "@/lib/examTree";

// Bir sınavın tüm (benzersiz) derslerini ?subject=A&subject=B… sorgusuna çevirir.
function examSubjectQuery(exam: ExamCategory): string {
  const qs = [...new Set(exam.columns.flatMap((c) => c.items).map((i) => i.q))];
  return qs.map((q) => `subject=${encodeURIComponent(q)}`).join("&");
}

/* ─── redirect if already authenticated ─────────────── */

export default function Landing() {
  const token = useAuthStore((s) => s.token);
  const { data: user, isLoading } = useCurrentUser();

  useEffect(() => {
    document.title = "Ceyhan Özel Ders — Uzman Eğitmenle Öğren, Hedefine Ulaş.";
  }, []);

  if (token && isLoading) return <FullScreenSpinner />;
  if (token && user) return <Navigate to={roleHome(user.role_id)} replace />;

  return (
    <div className="min-h-screen bg-white antialiased dark:bg-slate-900">
      <Navbar />
      <ExamNav />
      <SearchHero />
      <SubjectRows />
      <Footer />
    </div>
  );
}

/* ─── announcement banner ────────────────────────────── */

export function AnnouncementBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="relative bg-indigo-600 px-4 py-2.5 text-center text-xs font-semibold text-white sm:text-sm">
      <span>
        🎓 YKS 2025 hazırlığına başla — uzman eğitmenlerle ilk dersin{" "}
        <Link to="/student" className="underline underline-offset-2 hover:text-indigo-100">
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
  return (
    <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
      <div className="flex w-full items-center justify-between px-6 py-4">
        <Link
          to="/"
          className="text-lg font-bold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Ceyhan Özel Ders
        </Link>
        <Link
          to="/login"
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 active:scale-95"
        >
          Giriş Yap
        </Link>
      </div>
    </header>
  );
}

/* ─── exam nav ───────────────────────────────────────── */

function ExamNav() {
  const [open, setOpen] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open === null) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (subject: string) => {
    setOpen(null);
    navigate(`/kesfet?subject=${encodeURIComponent(subject)}`);
  };

  return (
    <div
      ref={rootRef}
      className="relative bg-gradient-to-r from-indigo-700 to-violet-700"
      onMouseLeave={() => setOpen(null)}
    >
      <div className="flex w-full items-center">
        {EXAMS.map((exam, idx) => (
          <div key={exam.label} className="relative">
            <button
              type="button"
              onMouseEnter={() => setOpen(idx)}
              onClick={() => setOpen((o) => (o === idx ? null : idx))}
              className={`px-4 py-3 text-base font-bold transition ${
                open === idx
                  ? "bg-white/20 text-white"
                  : "text-white/85 hover:bg-white/10 hover:text-white"
              }`}
            >
              {exam.label}
            </button>

            {open === idx && (
              <div className={`absolute top-full z-30 mt-1 w-max rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-slate-200 ${idx >= EXAMS.length - 3 ? "right-0" : "left-0"}`}>
                <div className="flex gap-6">
                  {EXAMS[idx].columns.map((col, ci) => (
                    <div key={col.title ?? ci} className="min-w-[130px]">
                      {col.title && (
                        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {col.title}
                        </p>
                      )}
                      <div className="flex flex-col gap-0.5">
                        {col.items.map((it) => (
                          <button
                            key={it.label}
                            type="button"
                            onClick={() => pick(it.q)}
                            className="rounded-lg px-2 py-1.5 text-left text-sm text-slate-600 transition hover:bg-indigo-50 hover:text-indigo-700"
                          >
                            {it.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── search hero ────────────────────────────────────── */

function SearchHero() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/kesfet${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  };

  return (
    <section className="relative overflow-hidden bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(139,92,246,0.10),transparent)] py-24 sm:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-indigo-100/40 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-10 h-96 w-96 rounded-full bg-violet-100/40 blur-3xl"
      />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-slate-900 dark:text-white sm:text-6xl sm:leading-tight">
          Uzman Eğitmenle Öğren,{" "}
          <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
            Hedefine Ulaş.
          </span>
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-500 dark:text-slate-400 sm:text-lg">
          Sınav, ders ya da kişisel gelişim — alanında uzman öğretmenini bul,
          ilk dersi dakikalar içinde planla.
        </p>

        {/* Search bar */}
        <form onSubmit={submit} className="mt-10 flex h-14 overflow-hidden rounded-2xl shadow-lg shadow-indigo-100 ring-1 ring-slate-200 dark:shadow-none dark:ring-slate-700">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Konu, sınav veya eğitmen ara… (ör. TYT Matematik)"
            className="flex-1 bg-white px-5 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
          />
          <button
            type="submit"
            aria-label="Ara"
            className="flex w-14 shrink-0 items-center justify-center bg-gradient-to-r from-indigo-600 to-violet-600 text-white transition hover:from-indigo-700 hover:to-violet-700 active:scale-95"
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
            </svg>
          </button>
        </form>

        {/* Trust row */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-medium text-slate-400 dark:text-slate-500">
          {["Onaylı Eğitmenler", "Anlık Rezervasyon", "Güvenli Ödeme", "7/24 Destek"].map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              {t}
            </span>
          ))}
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
                    onClick={() => navigate(`/kesfet?${examSubjectQuery(exam)}`)}
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
                        onClick={() => navigate(`/kesfet?subject=${encodeURIComponent(it.q)}`)}
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
        <Link to="/" className="text-base font-bold text-indigo-600 dark:text-indigo-400">
          Ceyhan Özel Ders
        </Link>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          © {new Date().getFullYear()} Ceyhan Özel Ders. Tüm hakları saklıdır.
        </p>
        <div className="flex gap-4 text-xs font-medium text-slate-500 dark:text-slate-400">
          <Link to="/login" className="transition hover:text-slate-900 dark:hover:text-white">Giriş Yap</Link>
          <Link to="/register" className="transition hover:text-slate-900 dark:hover:text-white">Kayıt Ol</Link>
        </div>
      </div>
    </footer>
  );
}
