import { Link } from "react-router-dom";

import { PublicShell } from "@/components/PublicShell";
import { Seo } from "@/components/Seo";
import { ROUTES } from "@/lib/routes";

/**
 * Donmuş bölümlerin rota karşılığı.
 *
 * Doğrudan URL yazan (ya da eski bir bağlantıyı takip eden) kullanıcı gerçek
 * sayfayı görmemeli — ama 404 da görmemeli: bölüm yok değil, HENÜZ yok.
 * Aradaki farkı söylemek kullanıcıya "yanlış adres yazdım" dedirtmez.
 *
 * Bayrak açıldığında bu ekran devreden çıkar (bkz. `lib/ozellikBayraklari.ts`).
 */
export default function Yakinda() {
  return (
    <PublicShell>
      <Seo
        title="Yakında"
        description="Bu bölüm üzerinde çalışıyoruz. Çok yakında burada olacak."
        // Donmuş bölüm arama motorlarına verilmez: bugün içeriği yok.
        noindex
      />
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            className="h-7 w-7"
          >
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 7.5V12l3 1.75" />
          </svg>
        </span>

        <h1 className="mt-6 text-2xl font-semibold text-slate-900 ">
          Yakında
        </h1>
        <p className="mt-3 text-slate-500 ">
          Bu bölüm üzerinde çalışıyoruz. Hazır olduğunda burada olacak.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to={ROUTES.tutors}
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 "
          >
            Öğretmenlere göz at
          </Link>
          <Link
            to={ROUTES.home}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 "
          >
            Ana sayfa
          </Link>
        </div>
      </div>
    </PublicShell>
  );
}
