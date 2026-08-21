import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";

// Anonim (oturumsuz) yüzeyin ortak üst barı — landing'de beğenilen navbar.
// Hem Landing hem PublicShell (public arama/profil) kullanır; böylece sitenin
// tüm oturumsuz sayfalarında aynı büyük logolu sticky navbar görünür.
// `center`: navbar'ın ortasına yerleşen içerik (Landing'de kategori sekmeleri).
// `bottom`: navbar'ın altına yerleşen ikinci satır (Landing'de arama çubuğu).
export function PublicNavbar({
  center,
  bottom,
  expanded = true,
}: {
  center?: ReactNode;
  bottom?: ReactNode;
  /** false iken alt arama satırı yumuşakça katlanır (Landing scroll daralması). */
  expanded?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mx-auto max-w-screen-2xl px-4 md:px-8">
        <div className="flex w-full items-start justify-between gap-4 pt-5 pb-2">
          <div className="flex-1 flex justify-start">
            <Link
              to="/"
              aria-label="Adana Özel Ders ana sayfa"
              className="flex shrink-0 items-center gap-2 transition hover:opacity-90 group"
            >
              {/* Küçük ekranda yazısız (yalnız simge) logo — kategori şeridine yer açar.
                  Eşik `md:` DEĞİL `xl:`: kelime logosu 257.7 px genişliğinde doğuyor ve
                  768-1279 arasında orta sütundaki kategori şeridinin ÜSTÜNE biniyordu
                  (ölçüm: 768'de 146.1 px, 1024'te hâlâ 88.6 px kesişim — yani `lg:`
                  eşiği de çakışmanın içine düşüyor). Kesişimin sıfır olduğu ilk üst
                  nokta 1280'dir.

                  Bu eşik KALICI BİR TASARIM KARARIDIR, kozmetik bir tercih değil:
                  navbar'ın üç sütunlu flex modeli (flex-1 · shrink-0 · flex-1)
                  değişirse eşik yeniden ÖLÇÜLMELİDİR — varsayılmaz. Ölçüm aracı
                  hazır: `node scripts/marka_logo_turu.mjs` (11 genişlik; kabul
                  ölçütü her genişlikte kesişim 0 ve yatay taşma 0).
                  Ayrıntı: docs/magaza-merge-dogrulama-raporu.md */}
              <img src="/logo-compact.svg" alt="" aria-hidden className="h-8 w-auto object-contain xl:hidden" />
              <img
                src="/logo.svg"
                alt=""
                aria-hidden
                className="hidden xl:block xl:h-9 w-auto object-contain"
              />
            </Link>
          </div>
          {center && (
            <div className="hidden shrink-0 justify-center md:flex">
              {center}
            </div>
          )}
          <div className="flex-1 flex shrink-0 items-center justify-end gap-2">
            <Link
              to={ROUTES.tutors}
              className="hidden rounded-full px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:text-indigo-700 active:scale-95 lg:block dark:text-slate-200 dark:hover:text-indigo-300"
            >
              Eğitmenler
            </Link>
            <Link
              to={ROUTES.store}
              className="hidden rounded-full px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:text-indigo-700 active:scale-95 lg:block dark:text-slate-200 dark:hover:text-indigo-300"
            >
              Mağaza
            </Link>
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
      </div>
      {center && (
        <div className="flex justify-center overflow-x-auto px-4 pb-3 md:hidden" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          {center}
        </div>
      )}
      {bottom && (
        <div
          className={`overflow-hidden transition-all duration-300 ease-out ${
            expanded ? "max-h-24 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          {bottom}
        </div>
      )}
    </header>
  );
}
