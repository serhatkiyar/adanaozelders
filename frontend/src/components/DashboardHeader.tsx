import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { ROLE_IDS } from "@/types";
import type { NavItem } from "@/lib/nav";

const navIconClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg p-2 transition ${
    isActive
      ? "bg-marka text-white"
      : "text-slate-600 hover:bg-slate-100 "
  }`;

const menuItemClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-marka-soft text-marka-hover "
      : "text-slate-700 hover:bg-slate-50 "
  }`;

interface DashboardHeaderProps {
  navItems?: NavItem[];
  /** true iken header şeffaf/sticky (landing üzerinde); değilse panel düz beyaz. */
  transparent?: boolean;
  /** Navbar'ın ortasına yerleşen içerik (Landing'de kategori çubuğu). */
  center?: ReactNode;
  /** Navbar'ın altına yerleşen ikinci satır (Landing'de arama çubuğu). */
  bottom?: ReactNode;
  /** false iken alt arama satırı yumuşakça katlanır (Landing scroll daralması). */
  expanded?: boolean;
}

// Oturum içi üst bar: logo + rol bazlı nav ikonları + bildirim zili + hesap
// menüsü (profil, ayarlar, tema, çıkış). Hem DashboardShell hem Landing kullanır.
export function DashboardHeader({ navItems, transparent = false, center, bottom, expanded = true }: DashboardHeaderProps) {
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
          Hesabım
        </NavLink>
        {/* Admin artık kökten panele ZORLA yönlendirilmiyor (29 Ağu: admin de
            özel ders yüzeyini gezebilmeli); panele dönüş yolu bu menüde durur. */}
        {user?.role_id === ROLE_IDS.ADMIN && (
          <NavLink to={ROUTES.admin} onClick={onClick} className={menuItemClass}>
            <Icon name="settings" className="h-5 w-5" />
            Yönetim Paneli
          </NavLink>
        )}
        {sidebarItems.map((l) =>
          // Donmuş bölüm: bağlantı DEĞİL. `NavLink`e `aria-disabled` eklemek
          // yetmezdi — anchor `href`i taşımaya ve tıklamayı yutmaya devam
          // ederdi (bkz. lib/ozellikBayraklari.ts).
          l.yakinda ? (
            <span
              key={l.to}
              aria-disabled="true"
              tabIndex={-1}
              className={`${menuItemClass} cursor-default opacity-60`}
            >
              {l.icon && <Icon name={l.icon} className="h-5 w-5" />}
              {l.label}
            </span>
          ) : (
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
          )
        )}

        <NavLink to={ROUTES.settings} onClick={onClick} className={menuItemClass}>
          <Icon name="settings" className="h-5 w-5" />
          Ayarlar
        </NavLink>
        <div className="my-1 border-t border-slate-100 " />
        <button
          onClick={() => {
            onClick();
            logout();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 "
        >
          <Icon name="logout" className="h-5 w-5" />
          Çıkış yap
        </button>
      </>
    );
  };

  // transparent (landing) modunda logo ve padding'i public navbar ile birebir
  // eşitleriz; panel modunda mevcut (biraz daha küçük) ölçüler korunur.
  // px/py header elementine değil iç wrapper'a taşındı; böylece bottom slot
  // kendi max-width'ini bağımsız yönetebiliyor (çift girintileme önlenir).
  const headerClass = transparent
    // Zemin saf beyaz DEĞİL (#fafafa): akıştaki beyaz içerikten ayrışsın (29 Ağu).
    ? "sticky top-0 z-40 border-b border-slate-100 bg-[#fafafa]/85 backdrop-blur-md "
    : "border-b border-slate-200 bg-[#fafafa] ";
  const innerPad = "px-4 md:px-8 pt-5 pb-2";
  // 30 Ağu: telefonda da TAM (yazılı) logo — kategori şeridi mobilde ikinci
  // satırda olduğundan üstte çakışma yok; yazısız simge devre dışı.
  const logoClass = transparent
    ? "block h-8 md:h-9 w-auto object-contain"
    : "block h-7 md:h-8 w-auto object-contain";
  const logoCompactClass = "hidden";

  return (
    <>
    <header className={headerClass}>
      <div className={innerPad}>
      <div className="mx-auto flex w-full max-w-screen-2xl items-start justify-between gap-3">
        <div className="flex-1 flex justify-start">
          <Link
            to={home}
            className="group flex shrink-0 items-center gap-2 transition hover:opacity-90"
            aria-label="Ana sayfa"
          >
            <NavbarWidget logoClass={logoClass} logoCompactClass={logoCompactClass} />
          </Link>
        </div>

        {/* Navbar ortası — kategori çubuğu (yalnız Landing'de geçilir) */}
        {center && (
          <div className="hidden shrink-0 justify-center lg:flex">
            {center}
          </div>
        )}

        {/* Masaüstü: nav ikonları + avatar dropdown */}
        <div className="hidden flex-1 shrink-0 items-center justify-end gap-1 sm:flex">
          {navbarItems.map((l) =>
            l.yakinda ? (
              // Üst bar kısayolu ikon-only; rozet sığmaz, `title`/`aria-label`
              // "Yakında"yı taşır ki ekran okuyucu da durumu duysun.
              <span
                key={l.to}
                aria-disabled="true"
                tabIndex={-1}
                title={`${l.label}, Yakında`}
                aria-label={`${l.label}, Yakında`}
                className={`${navIconClass} cursor-default opacity-40`}
              >
                {l.icon ? (
                  <Icon name={l.icon} className="h-5 w-5" />
                ) : (
                  <span className="text-sm font-medium">{l.label}</span>
                )}
              </span>
            ) : l.icon ? (
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
                    <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white ">
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
                      ? "bg-marka text-white"
                      : "text-slate-600 hover:bg-slate-100 "
                  }`
                }
              >
                {l.label}
              </NavLink>
            )
          )}

          <NotificationsBell />

          <div ref={accountRef} className="relative ml-1">
            <button
              type="button"
              aria-label="Hesap menüsü"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((o) => !o)}
              className="rounded-full ring-2 ring-transparent transition hover:ring-marka/20 "
            >
              <Avatar name={user?.full_name ?? "?"} avatar_url={user?.avatar_url} size="sm" />
            </button>
            {accountOpen && (
              <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-200 ">

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
        <div className="flex flex-1 items-center justify-end gap-1 sm:hidden">
          {/* Favoriler ÖĞRENCİYE aittir (`STUDENT_NAV`). Bu kısayol role
              bakmadan basılıyordu: eğitmenin ve kütüphane operatörünün mobil
              üst barında, kendilerine ait olmayan ve boş açılan bir ekrana
              giden ikon duruyordu. Operatörün işi fiziksel olarak mobildir
              (QR kapıda okutulur), yani yanlış ikonu en çok o görüyordu. */}
          {user?.role_id === ROLE_IDS.CLIENT && (
            <NavLink
              to={ROUTES.favorites}
              title="Favorilerim"
              aria-label="Favorilerim"
              className="inline-flex shrink-0 items-center justify-center rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 "
            >
              <span className="relative">
                <Icon name="favorites" className="h-6 w-6" />
              </span>
            </NavLink>
          )}
          <NotificationsBell />
          <button
            type="button"
            aria-label="Menüyü aç/kapat"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="inline-flex shrink-0 items-center justify-center rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 "
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
      </div>{/* /innerPad */}

      {center && (
        <div className="flex justify-center overflow-x-auto px-4 pb-3 lg:hidden" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
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

      {/* Mobil açılır menü */}
      {menuOpen && (
        <div className="mt-3 flex flex-col gap-0.5 px-4 sm:hidden">

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
