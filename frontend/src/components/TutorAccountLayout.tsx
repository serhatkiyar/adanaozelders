import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { TUTOR_NAV } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";

type TutorAccountTab = "about" | "listing" | "promotion";

const ITEMS: {
  key: TutorAccountTab;
  label: string;
  to: string;
  icon: ReactNode;
}[] = [
  {
    key: "about",
    label: "Hakkımda",
    to: ROUTES.profile,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
      </svg>
    ),
  },
  {
    key: "listing",
    label: "İlan ayarları",
    to: ROUTES.tutorListing,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
      </svg>
    ),
  },
  {
    key: "promotion",
    label: "Öne çıkar",
    to: ROUTES.tutorPromotion,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
];

/**
 * Eğitmenin "hesabım" yüzeyi: Airbnb tarzı sol menü + dikey ayraç + sağda
 * seçili bölüm. Hakkımda (profil) ve İlan ayarları (ilan) aynı kabukta; menü
 * öğeleri ilgili route'lara Link'tir, böylece kenar çubuğundaki "İlan ayarları"
 * girişi de çalışır.
 */
export function TutorAccountLayout({
  active,
  title,
  children,
}: {
  active: TutorAccountTab;
  title: string;
  children: ReactNode;
}) {
  return (
    <DashboardShell title={title} navItems={TUTOR_NAV}>
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-3 pb-16 pt-2 md:flex-row md:gap-0 md:px-6 md:pt-6">
        <aside className="md:w-72 md:shrink-0 md:border-r md:border-slate-200 md:pr-8 ">
          <h2 className="mb-7 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Hesabım
          </h2>
          <nav className="flex gap-2 md:flex-col">
            {ITEMS.map((item) => {
              const isActive = item.key === active;
              return (
                <Link
                  key={item.key}
                  to={item.to}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    isActive
                      ? "flex flex-1 items-center gap-4 rounded-2xl bg-slate-100 px-4 py-3.5 text-base font-semibold text-slate-900 shadow-sm md:flex-none"
                      : "flex flex-1 items-center gap-4 rounded-2xl px-4 py-3.5 text-base font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 md:flex-none"
                  }
                >
                  <span
                    className={
                      isActive
                        ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-800 shadow-sm ring-1 ring-slate-200 "
                        : "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 "
                    }
                  >
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 md:pl-10">{children}</div>
      </div>
    </DashboardShell>
  );
}
