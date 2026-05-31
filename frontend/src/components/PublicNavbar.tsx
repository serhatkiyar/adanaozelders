import { Link } from "react-router-dom";

// Anonim (oturumsuz) yüzeyin ortak üst barı — landing'de beğenilen navbar.
// Hem Landing hem PublicShell (public arama/profil) kullanır; böylece sitenin
// tüm oturumsuz sayfalarında aynı büyük logolu sticky navbar görünür.
export function PublicNavbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
      <div className="flex w-full items-center justify-between px-6 py-4">
        <Link
          to="/"
          className="flex items-center gap-2 transition hover:opacity-90 group"
        >
          <img
            src="/logo.png"
            alt="Adana Özel Ders"
            className="h-40 sm:h-48 w-auto object-contain max-w-none -my-16 sm:-my-20 -ml-6 sm:-ml-10"
          />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to="?modal=register&role=tutor"
            className="btn-neon-hover rounded-full px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:text-indigo-700 active:scale-95 dark:text-slate-200 dark:hover:text-indigo-300"
          >
            Eğitmen Ol
          </Link>
          <Link
            to="?modal=login"
            className="btn-neon-hover rounded-full px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:text-indigo-700 active:scale-95 dark:text-slate-200 dark:hover:text-indigo-300"
          >
            Giriş Yap
          </Link>
        </div>
      </div>
    </header>
  );
}
