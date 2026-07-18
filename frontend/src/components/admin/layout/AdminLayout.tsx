import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { DashboardHeader } from "@/components/DashboardHeader";
import { AdminPageHeader } from "./AdminPageHeader";
import { AdminSidebar } from "./AdminSidebar";
import { getAdminNavItem } from "./adminNavigation";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AdminLayout() {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = getAdminNavItem(pathname);

  useEffect(() => {
    document.title = `Adana Özel Ders · ${current.label}`;
  }, [current.label]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;

    const drawer = drawerRef.current;
    const first = drawer?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const firstItem = focusable[0];
      const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <DashboardHeader transparent />

      <div className="mx-auto flex w-full max-w-screen-2xl">
        <aside className="sticky top-[73px] hidden h-[calc(100vh-73px)] w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-950/70 lg:block">
          <AdminSidebar />
        </aside>

        <div className="min-w-0 flex-1">
          <div className="sticky top-[73px] z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:hidden">
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              aria-controls="admin-mobile-navigation"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <span className="sr-only">Yönetim menüsünü aç</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{current.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Yönetim paneli</p>
            </div>
          </div>

          <main id="admin-main-content" className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <AdminPageHeader />
            <Outlet />
          </main>
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button type="button" aria-label="Yönetim menüsünü kapat" className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div
            ref={drawerRef}
            id="admin-mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Yönetim menüsü"
            className="admin-drawer-enter relative flex h-full w-[min(88vw,20rem)] flex-col bg-white shadow-2xl dark:bg-slate-950"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <p className="font-bold text-slate-950 dark:text-white">Yönetim</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Operasyon merkezi</p>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800">
                <span className="sr-only">Menüyü kapat</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AdminSidebar onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
