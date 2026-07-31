import { type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useOpenReportCount } from "@/hooks/useReports";
import { ADMIN_NAV_GROUPS, ADMIN_NAV_ITEMS, type AdminNavItem } from "./adminNavigation";
import { useAuthStore } from "@/store/authStore";

const ICONS: Record<AdminNavItem["icon"], ReactNode> = {
  overview: <path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-13h6V4h-6v3Z" />,
  users: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87m-2-12a4 4 0 0 1 0 7.75" />,
  education: <path d="m3 9 9-5 9 5-9 5-9-5Zm3 3.5V17c3.5 2.7 8.5 2.7 12 0v-4.5M21 9v6" />,
  library: <path d="M4 21V5l8-3 8 3v16M8 9h.01M8 13h.01M8 17h.01M16 9h.01M16 13h.01M16 17h.01M10 21v-3h4v3" />,
  exam: <path d="M6 2h9l4 4v16H6V2Zm9 0v5h5M9 12h7M9 16h7M9 8h2" />,
  store: <path d="M3 9h18l-1-5H4L3 9Zm1 0v11h16V9M8 20v-6h8v6" />,
  // Envanter: raf + sayım işareti (mağaza tezgahından ayrı okunsun).
  inventory: <path d="M3 7h18v4H3V7Zm2 4v10h14V11M9 15h6M4 7l2-4h12l2 4" />,
  delivery: <path d="M3 6h11v11H3V6Zm11 4h4l3 3v4h-7v-7ZM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
  booking: <path d="M6 3v3m12-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm3 7h3v3H8v-3Z" />,
  moderation: <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-11 2 2 4-4" />,
  audit: <path d="M9 3h6l1 2h3v16H5V5h3l1-2Zm0 8 2 2 4-4m-6 8h6" />,
  access: <path d="M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 7a7 7 0 0 0-14 0m14-12h3m-1.5-1.5v3" />,
  // Ayarlar kendi glifini alır: "access" ile paylaşınca kenar çubuğunda iki
  // farklı bölüm aynı ikonla görünüyordu.
  settings: (
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a8.5 8.5 0 0 0-2-1.2L15.6 2h-3.9l-.4 2.5a8.5 8.5 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a8.5 8.5 0 0 0 2 1.2l.4 2.5h3.9l.4-2.5a8.5 8.5 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z" />
  ),
};

interface AdminSidebarProps {
  onNavigate?: () => void;
}

export function AdminSidebar({ onNavigate }: AdminSidebarProps) {
  const { pathname } = useLocation();
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  const { data: openReports = 0 } = useOpenReportCount(!permissions || permissions.includes("reports.view"));

  return (
    <nav aria-label="Yönetim menüsü" className="space-y-5 px-3 py-5">
      {ADMIN_NAV_GROUPS.map((group) => {
        const items = ADMIN_NAV_ITEMS.filter(
          (item) => item.group === group && (!permissions || !item.requiredPermission || permissions.includes(item.requiredPermission))
        );
        if (items.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`admin-nav-${group}`}>
            <h2 id={`admin-nav-${group}`} className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {group}
            </h2>
            <div className="space-y-0.5">
              {items.map((item) => {
                const storeActive = item.icon === "store" && pathname.startsWith("/yonetim/magaza/");
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) => {
                      const active = isActive || storeActive;
                      return `group flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
                        active
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                      }`;
                    }}
                  >
                    {({ isActive }) => {
                      const active = isActive || storeActive;
                      return (
                        <>
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`h-[18px] w-[18px] shrink-0 ${active ? "text-white" : "text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200"}`}>
                            {ICONS[item.icon]}
                          </svg>
                          <span className="min-w-0 flex-1 truncate">{item.shortLabel ?? item.label}</span>
                          {item.badge === "open-reports" && openReports > 0 && (
                            <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${active ? "bg-white text-indigo-700" : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"}`}>
                              {openReports > 99 ? "99+" : openReports}
                            </span>
                          )}
                        </>
                      );
                    }}
                  </NavLink>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}
