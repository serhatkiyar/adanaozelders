import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useLogout } from "@/hooks/useLogout";
import { alisverisYapabilir } from "@/lib/roles";

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
  // Hover ile açılır (kullanıcı isteği, 1 Eyl). Kapanış küçük gecikmeli:
  // tetik ile panel arasındaki 8px boşluğu geçerken menü sönmesin.
  const kapanisZamanlayici = useRef<number | undefined>(undefined);
  const location = useLocation();

  const hoverAc = () => {
    window.clearTimeout(kapanisZamanlayici.current);
    setOpen(true);
  };
  const hoverKapat = () => {
    window.clearTimeout(kapanisZamanlayici.current);
    kapanisZamanlayici.current = window.setTimeout(() => setOpen(false), 150);
  };

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
        className="group flex items-center gap-2 text-slate-600 transition-colors hover:text-[#F09A38] "
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span className="hidden text-sm font-medium sm:inline">Giriş Yap</span>
      </Link>
    );
  }

  const alisverisAcik = alisverisYapabilir(user.role_id);
  // Hover: açık turuncu zemin + marka turuncusu metin (Trendyol menü deseni).
  const itemClass =
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#FEF8F0] hover:text-[#F09A38] ";

  return (
    <div className="relative" ref={ref} onMouseEnter={hoverAc} onMouseLeave={hoverKapat}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="group flex items-center gap-2 transition-colors hover:text-[#F09A38] "
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span className="hidden text-sm font-medium sm:inline">Hesabım</span>
      </button>

      {open && (
        // KÖPRÜ DESENİ (1 Eyl): buton-menü arası boşluk `mt-2` (margin = ölü
        // bölge, imleç oradan geçerken mouseleave tetiklenir) DEĞİL `pt-2`
        // (padding = boşluk hover alanının İÇİNDE). Menü görsel olarak aynı
        // 8px aşağıda ama imleç yavaş inerken kapanmaz — zamanlayıcı yalnız
        // yana çıkışlarda devrededir. Tetiğin tam altına ortalanır.
        <div className="absolute left-1/2 top-full z-40 -translate-x-1/2 pt-2">
          <div
            role="menu"
            className="w-44 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-200 "
          >
          {/* Hesabım İLK sırada (kullanıcı isteği, 1 Eyl). */}
          <Link to={ROUTES.profile} onClick={() => setOpen(false)} className={itemClass}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Hesabım
          </Link>
          {alisverisAcik && (
            <Link to={ROUTES.orders} onClick={() => setOpen(false)} className={itemClass}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              Siparişlerim
            </Link>
          )}
          {/* "Ayarlar" kaldırıldı (1 Eyl, kullanıcı kararı) — Hesabım
              üzerinden zaten ulaşılıyor, menü sade kalsın. */}
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
        </div>
      )}
    </div>
  );
}
