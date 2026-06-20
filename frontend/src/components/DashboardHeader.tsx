import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { NotificationsBell } from "@/components/NotificationsBell";
import { NavbarWidget } from "@/components/NavbarWidget";
import { PersonalizeModal } from "@/components/PersonalizeModal";
import { Icon } from "@/components/AppIcon";
import { useAuthStore } from "@/store/authStore";
import { useNavPrefsStore } from "@/store/navPrefsStore";
import { useLogout } from "@/hooks/useLogout";
import { useMessagesUnreadCount } from "@/hooks/useMessages";
import { roleHome } from "@/lib/roles";
import { resolveSurface } from "@/lib/navPrefs";
import { ROUTES } from "@/lib/routes";
import type { NavItem } from "@/lib/nav";

const navIconClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg p-2 transition ${
    isActive
      ? "bg-indigo-600 text-white"
      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;

const menuItemClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-indigo-50 text-indigo-700 dark:bg-slate-700 dark:text-white"
      : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
  }`;

interface DashboardHeaderProps {
  navItems?: NavItem[];
  /** true iken header şeffaf/sticky (landing üzerinde); değilse panel düz beyaz. */
  transparent?: boolean;
}

// Oturum içi üst bar: logo + rol bazlı nav ikonları + bildirim zili + hesap
// menüsü (profil, ayarlar, tema, çıkış). Hem DashboardShell hem Landing kullanır.
export function DashboardHeader({ navItems, transparent = false }: DashboardHeaderProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const home = roleHome(user?.role_id);
  const { data: msgUnreadCounts } = useMessagesUnreadCount();
  const msgUnread = msgUnreadCounts?.inbox ?? 0;

  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close mobile menu on navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [accountOpen]);

  // Kullanıcının Kişiselleştir'den ayarladığı kısayol düzeni (rol bazlı).
  // İki bağımsız yüzey: üst bar ikonları + profil (yan) menüsü.
  const roleId = user?.role_id;
  const navPrefs = useNavPrefsStore((s) =>
    roleId != null ? s.byRole[roleId] : undefined
  );
  const navbarItems = useMemo(
    () =>
      resolveSurface(navItems ?? [], navPrefs?.navbar, "navbar").filter(
        (i) => i.visible
      ),
    [navItems, navPrefs]
  );
  const sidebarItems = useMemo(
    () =>
      resolveSurface(navItems ?? [], navPrefs?.sidebar, "sidebar").filter(
        (i) => i.visible
      ),
    [navItems, navPrefs]
  );

  const accountLinks = (onClick: () => void) => {
    return (
      <>
        <NavLink to={ROUTES.profile} onClick={onClick} className={menuItemClass}>
          <Icon name="profile" className="h-5 w-5" />
          Profil
        </NavLink>
        {sidebarItems.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            onClick={onClick}
            className={menuItemClass}
          >
            {l.icon && <Icon name={l.icon} className="h-5 w-5" />}
            {l.label}
            {l.to === ROUTES.messages && msgUnread > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                {msgUnread > 9 ? "9+" : msgUnread}
              </span>
            )}
          </NavLink>
        ))}

        <NavLink to={ROUTES.settings} onClick={onClick} className={menuItemClass}>
          <Icon name="settings" className="h-5 w-5" />
          Ayarlar
        </NavLink>
        <a
          href="https://shopier.com"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClick}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <Icon name="shop" className="h-5 w-5" />
          Mağaza
        </a>
        <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
        <button
          onClick={() => {
            onClick();
            logout();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <Icon name="logout" className="h-5 w-5" />
          Çıkış yap
        </button>
      </>
    );
  };

  // transparent (landing) modunda logo ve padding'i public navbar ile birebir
  // eşitleriz; panel modunda mevcut (biraz daha küçük) ölçüler korunur.
  const headerClass = transparent
    ? "sticky top-0 z-40 border-b border-slate-100 bg-white/80 px-6 py-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80"
    : "border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 sm:px-6";
  const logoClass = transparent
    ? "h-8 sm:h-10 w-auto object-contain"
    : "h-7 sm:h-8 w-auto object-contain";

  return (
    <>
    <header className={headerClass}>
      <div className="flex w-full items-center justify-between gap-3">
        <Link
          to={home}
          className="group flex shrink-0 items-center gap-2 transition hover:opacity-90"
          aria-label="Ana sayfa"
        >
          <NavbarWidget logoClass={logoClass} />
        </Link>

        {/* Masaüstü: nav ikonları + avatar dropdown */}
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {navbarItems.map((l) =>
            l.icon ? (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                title={l.label}
                aria-label={l.label}
                className={navIconClass}
              >
                <span className="relative">
                  <Icon name={l.icon} className="h-5 w-5" />
                  {l.to === ROUTES.messages && msgUnread > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
                      {msgUnread > 9 ? "9+" : msgUnread}
                    </span>
                  )}
                </span>
              </NavLink>
            ) : (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? "bg-indigo-600 text-white"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`
                }
              >
                {l.label}
              </NavLink>
            )
          )}

          <a
            href="https://shopier.com"
            title="Mağaza"
            aria-label="Mağaza"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-2 transition text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <span className="relative">
              <Icon name="shop" className="h-5 w-5" />
            </span>
          </a>

          <NotificationsBell />

          <div ref={accountRef} className="relative ml-1">
            <button
              type="button"
              aria-label="Hesap menüsü"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((o) => !o)}
              className="rounded-full ring-2 ring-transparent transition hover:ring-indigo-200 dark:hover:ring-slate-700"
            >
              <Avatar name={user?.full_name ?? "?"} avatar_url={user?.avatar_url} size="sm" />
            </button>
            {accountOpen && (
              <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
                <div className="border-b border-slate-100 px-3 pb-2 pt-1 dark:border-slate-700">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {user?.full_name}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {user?.email}
                  </p>
                </div>
                <div className="mt-1 flex flex-col">
                  {accountLinks(() => {
                    setAccountOpen(false);
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobil: bildirim + hamburger */}
        <div className="flex items-center gap-1 sm:hidden">
          <NavLink
            to={ROUTES.favorites}
            title="Favorilerim"
            aria-label="Favorilerim"
            className="inline-flex shrink-0 items-center justify-center rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <span className="relative">
              <Icon name="favorites" className="h-6 w-6" />
            </span>
          </NavLink>
          <NotificationsBell />
          <button
            type="button"
            aria-label="Menüyü aç/kapat"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="inline-flex shrink-0 items-center justify-center rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="h-6 w-6"
            >
              {menuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobil açılır menü */}
      {menuOpen && (
        <div className="mt-3 flex flex-col gap-0.5 sm:hidden">
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar name={user?.full_name ?? "?"} avatar_url={user?.avatar_url} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                {user?.full_name}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {user?.email}
              </p>
            </div>
          </div>
          <div className="mb-1 border-t border-slate-100 dark:border-slate-700" />
          {accountLinks(() => {
            setMenuOpen(false);
          })}
        </div>
      )}
    </header>

    {personalizeOpen && (
      <PersonalizeModal
        onClose={() => setPersonalizeOpen(false)}
        navItems={navItems}
        roleId={roleId}
      />
    )}
    </>
  );
}
