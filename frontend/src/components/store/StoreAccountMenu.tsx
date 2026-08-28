import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useLogout } from "@/hooks/useLogout";
import { ROLE_IDS } from "@/types";

/**
 * Mağaza navbar'ındaki hesap affordance'ı — ışınlayan link DEĞİL, açılır menü
 * (Amazon/D&R deseni). Tek kimlik; mağaza-işleri (Siparişlerim/Favorilerim/Çıkış)
 * bağlamı korur, Profil/Ayarlar bilerek panele köprüler. Headless dropdown deseni
 * DashboardHeader ile aynı (state + ref + dışına-tıkla + rota değişince kapanma).
 */
export function StoreAccountMenu() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const logout = useLogout(ROUTES.store); // çıkışta mağazada kal, /giris'e atma
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Çıkışta (kimlik yok): yerinde "Giriş Yap" modal'ı.
  if (!token || !user) {
    return (
      <Link
        to="?modal=login"
        className="group flex items-center gap-2 text-slate-600 transition-colors hover:text-indigo-600 "
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span className="hidden text-sm font-medium sm:inline">Giriş Yap</span>
      </Link>
    );
  }

  const isClient = user.role_id === ROLE_IDS.CLIENT;
  const itemClass =
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 ";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="group flex items-center gap-2 transition-colors hover:text-indigo-600 "
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span className="hidden text-sm font-medium sm:inline">Hesabım</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-56 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-200 "
        >
          <div className="my-1 border-t border-slate-100 " />

          {isClient && (
            <Link to={ROUTES.orders} onClick={() => setOpen(false)} className={itemClass}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              Siparişlerim
            </Link>
          )}
          <Link to={ROUTES.profile} onClick={() => setOpen(false)} className={itemClass}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Hesabım
          </Link>
          <Link to={ROUTES.settings} onClick={() => setOpen(false)} className={itemClass}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Ayarlar
          </Link>

          <div className="my-1 border-t border-slate-100 " />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className={`w-full text-left ${itemClass}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Çıkış yap
          </button>
        </div>
      )}
    </div>
  );
}
