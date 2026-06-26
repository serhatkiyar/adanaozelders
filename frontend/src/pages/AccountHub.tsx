import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface AccountCard {
  to: string;
  title: string;
  desc: string;
  icon: ReactNode;
}

const ICON = "h-7 w-7";

const CARDS: AccountCard[] = [
  {
    to: ROUTES.orders,
    title: "Siparişlerim",
    desc: "Mağaza siparişlerini izle, iade veya iptal et.",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    to: ROUTES.bookings,
    title: "Rezervasyonlarım",
    desc: "Derslerin, biletlerin ve talep durumların.",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    to: ROUTES.favorites,
    title: "Favori eğitmenlerim",
    desc: "Kaydettiğin eğitmenler.",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
  },
  {
    to: ROUTES.storeFavorites,
    title: "Mağaza Favorilerim & Listelerim",
    desc: "Beğendiğin ürünler ve oluşturduğun listeler.",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    to: ROUTES.addresses,
    title: "Adreslerim",
    desc: "Teslimat adreslerini ekle, düzenle veya sil.",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    to: ROUTES.messages,
    title: "Mesajlar",
    desc: "Eğitmen ve satıcılarla yazışmaların.",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    to: ROUTES.notifications,
    title: "Bildirimler",
    desc: "Bildirim gelen kutun.",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    to: ROUTES.settings,
    title: "Hesap & Güvenlik",
    desc: "Kimlik, şifre, e-posta/telefon doğrulama, görünüm.",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    to: ROUTES.profileEdit,
    title: "Profil bilgilerim",
    desc: "Herkese açık profil, hakkımda ve eğitim.",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    to: ROUTES.terms,
    title: "Sözleşmeler ve Yardım",
    desc: "Kullanım koşulları, iade politikası ve KVKK.",
    icon: (
      <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </svg>
    ),
  },
];

export default function AccountHub() {
  const { data: user } = useCurrentUser();

  return (
    <DashboardShell title="Hesabım" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Hesabım</h1>
            {user && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{user.full_name}</p>}
          </div>
          {/* Hizmetler arası hızlı geçiş */}
          <div className="flex gap-2">
            <Link
              to={ROUTES.store}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-200 dark:hover:text-indigo-400"
            >
              Mağaza
            </Link>
            <Link
              to={ROUTES.tutors}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-200 dark:hover:text-indigo-400"
            >
              Eğitmen ara
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => (
            <Link
              key={c.to + c.title}
              to={c.to}
              className="group flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-500/5"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                {c.icon}
              </span>
              <span>
                <span className="block font-semibold text-slate-900 group-hover:text-indigo-700 dark:text-white dark:group-hover:text-indigo-300">
                  {c.title}
                </span>
                <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">{c.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
