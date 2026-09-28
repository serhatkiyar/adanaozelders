import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/admin/ui";
import { AdminKomutPenceresi } from "./AdminKomutPenceresi";
import { AdminPageHeader } from "./AdminPageHeader";
import { AdminSidebar } from "./AdminSidebar";
import { getAdminNavItem } from "./adminNavigation";
import { usePanelKabugu } from "./panelKabuguDurumu";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * ── Panel kabuğu (İP-B1 · Görev 4 · docs/tasarim-dili.md §4) ──
 *
 * Değişen: ÇERÇEVE. Değişmeyen: ekran içerikleri — `Outlet`in altındaki
 * hiçbir ekran bu pakette elden geçmedi.
 *
 * Önce ne vardı: panelin üstünde genel site navbar'ı (`DashboardHeader`)
 * duruyordu, solda tek parça bir kenar çubuğu vardı, arama/komut penceresi
 * yoktu, tema yalnız açık↔koyu arasında geçiş yapabiliyordu ("sistem" bir kez
 * terk edilince geri seçilemiyordu) ve katlama diye bir şey yoktu.
 *
 * Şimdi: üç bölgeli kendi rail'i (arama · alanlar · Ayarlar+profil),
 * katlanabilir ve tercihi kalıcı, `Ctrl+K` komut penceresi, `G`+harf
 * kısayolları, üç seçenekli tema anahtarı ve bildirimi taşıyan bir üst şerit.
 *
 * Kaydırma kabuğa ait: `h-dvh` + yalnız `<main>` kayar. Böylece rail ve üst
 * şerit uzun listelerde ekrandan çıkmaz — Medusa'nın deseni. `dvh`, mobil
 * tarayıcıların adres çubuğu daralınca `100vh`in taşırmasını önler.
 */
export default function AdminLayout() {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [komutAcik, setKomutAcik] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const katli = usePanelKabugu((s) => s.katli);
  const katlamaDegistir = usePanelKabugu((s) => s.katlamaDegistir);
  const current = getAdminNavItem(pathname);

  const komutAc = useCallback(() => setKomutAcik(true), []);
  const komutKapat = useCallback(() => setKomutAcik(false), []);

  useEffect(() => {
    document.title = `Adana Özel Ders · ${current.label}`;
  }, [current.label]);

  useEffect(() => {
    setDrawerOpen(false);
    // Kayan öğe pencere değil `<main>` ve kabuk rota değişince yeniden
    // kurulmaz: sıfırlanmazsa yeni ekran önceki listenin kaydırma konumunda,
    // başlığı ve filtreleri görünmeden açılıyordu.
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;

    triggerRef.current = document.activeElement as HTMLElement | null;
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
      triggerRef.current?.focus?.();
    };
  }, [drawerOpen]);

  return (
    // `panel-kok`: panel başlık tipografisinin (Figtree) TEK bağlanma
    // noktası — kural `index.css`te, sınıf yalnız burada. Public site
    // etkilenmez ve panelin 44 rotası göç etmeyi beklemez.
    <div className="panel-kok flex h-dvh min-h-0 bg-panel-bg text-panel-fg">
      <aside
        className={`hidden shrink-0 border-r border-panel-border lg:block ${
          katli ? "w-[72px]" : "w-[264px]"
        }`}
      >
        <AdminSidebar
          testId="panel-rail"
          katli={katli}
          onAramaAc={komutAc}
          onKatlamaDegistir={katlamaDegistir}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminPageHeader onMenuAc={() => setDrawerOpen(true)} />
        <main ref={mainRef} id="admin-main-content" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1200px] px-4 pb-12 pt-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          {/* Zemin: klavyeyle erişilemez olmalı (ESC ve odak tuzağı zaten var).
              Eskiden burada `aria-label`lı bir <button> vardı ve odak sırasına
              giriyordu — ekran okuyucu kullanıcısı çekmecenin içeriğine
              varmadan önce bir "kapat" düğmesine çarpıyordu. */}
          <div aria-hidden="true" className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div
            ref={drawerRef}
            id="admin-mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Yönetim menüsü"
            className="admin-drawer-enter relative flex h-full w-[min(88vw,20rem)] flex-col shadow-2xl"
          >
            {/* Kapatma: çekmecenin İÇİNDE ve odak sırasının başında.
                Eski yazımda zemin bir `<button>`dı ve odak sırasına giriyordu;
                ekran okuyucu kullanıcısı menüye varmadan ona çarpıyordu. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-2 top-2 z-10 !px-2"
            >
              <span className="sr-only">Menüyü kapat</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
              </svg>
            </Button>
            <AdminSidebar
              testId="panel-cekmece"
              cekmece
              onAramaAc={() => {
                setDrawerOpen(false);
                komutAc();
              }}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      <AdminKomutPenceresi acik={komutAcik} onAc={komutAc} onKapat={komutKapat} />
    </div>
  );
}
