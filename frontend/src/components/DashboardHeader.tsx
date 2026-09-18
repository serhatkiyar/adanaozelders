import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { NavbarWidget } from "@/components/NavbarWidget";
import { PersonalizeModal } from "@/components/PersonalizeModal";
import { Icon } from "@/components/AppIcon";
import { useAuthStore } from "@/store/authStore";
import { useNavPrefsStore } from "@/store/navPrefsStore";
import { useLogout } from "@/hooks/useLogout";
import { useMessagesUnreadCount } from "@/hooks/useMessages";
import { useUnreadCount } from "@/hooks/useNotifications";
import { roleHome } from "@/lib/roles";
import { resolveSurface } from "@/lib/navPrefs";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";
import type { NavItem } from "@/lib/nav";

// Üst bar ikonları (17 Eyl 2026, Preply ölçüsü): 24px ikon, merkezler arası 36px,
// dolgu yok; aktif ikon koyu, pasif ikincil renk.
const navIconClass = ({ isActive }: { isActive: boolean }) =>
  `relative inline-flex h-10 w-9 items-center justify-center rounded-lg transition ${
    isActive ? "text-slate-900" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;

const menuItemClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-base font-medium leading-6 transition ${
    isActive
      ? "bg-slate-100 font-semibold text-slate-900"
      : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
  }`;

function SayiRozeti({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white">
      {n > 9 ? "9+" : n}
    </span>
  );
}

interface DashboardHeaderProps {
  navItems?: NavItem[];
  /** true iken header şeffaf/sticky (landing üzerinde); değilse panel düz beyaz. */
  transparent?: boolean;
  /** Navbar'ın ortasına yerleşen içerik (Landing'de kategori çubuğu). */
  center?: ReactNode;
  /** Navbar'ın altına yerleşen ikinci satır (Landing'de arama çubuğu). */
  bottom?: ReactNode;
  /**
   * Telefonda (yalnız `<md`) EN ÜSTTE, kategori şeridinin de üstünde duran
   * içerik — ana sayfada tek satırlık arama tetikleyicisi.
   */
  mobilUst?: ReactNode;
  /**
   * Telefonda logo ve hesap ikonlarını üst bardan KALDIR. Gerekçe ve sınırı
   * için `PublicNavbar`daki aynı adlı prop'un notuna bakınız: bayrak yalnız
   * `MobilAltSekmeler` çizen yüzeylerde açılabilir, yoksa hesaba giden yol
   * kapanır. Bugün tek veren `Landing`dir.
   */
  mobilSade?: boolean;
  /** false iken alt arama satırı yumuşakça katlanır (Landing scroll daralması). */
  expanded?: boolean;
}

// Oturum içi üst bar: logo + rol bazlı nav ikonları + bildirim zili + hesap
// menüsü (profil, ayarlar, tema, çıkış). Hem DashboardShell hem Landing kullanır.
export function DashboardHeader({ navItems, transparent = false, center, bottom, mobilUst, mobilSade = false, expanded = true }: DashboardHeaderProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const home = roleHome(user?.role_id);
  const { data: msgUnreadCounts } = useMessagesUnreadCount();
  const msgUnread = msgUnreadCounts?.inbox ?? 0;
  const { data: bildirimOkunmamis = 0 } = useUnreadCount();

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
  /**
   * ÜST BARDA TEK KISAYOL: Favorilerim.
   *
   * Buraya eskiden rol menüsünün tamamı ikon olarak basılıyordu (öğrencide
   * beş, eğitmende altı ikon) ve aynı bağlantılar avatar açılırında zaten
   * duruyordu — yani üst bar, menünün eksiksiz bir KOPYASIYDI. Kullanıcı
   * kararı (6 Eyl): kalabalık kalksın, her şey menüden açılsın.
   *
   * Hiçbir şey erişilemez olmuyor: yan menüde varsayılan görünürlük
   * `defaultVisible("sidebar", …)` her öğe için `true`, yani açılır menü
   * kaldırılan ikonların ÜST KÜMESİ.
   *
   * Rolden değil `navItems`ten türetilir: rol kontrolü (`role_id === CLIENT`)
   * iki yüzeyde ayrı ayrı yazılıydı ve mobil tarafta bir kez zaten yanlış
   * yazılmıştı — eğitmenin ve operatörün üst barında kendilerine ait olmayan,
   * boş açılan bir Favoriler ikonu duruyordu. Tek türev, iki yüzey.
   */
  const favoriKisayolu = useMemo(
    () => (navItems ?? []).find((i) => i.to === ROUTES.favorites && !i.yakinda),
    [navItems]
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
        {/* MENÜNÜN İLK SATIRI ROLE GÖRE DEĞİŞİR (kullanıcı kararı, 8 Eyl 2026).
            Eğitmende "Panom" → `/pano`: şeridi olan tek rol odur ve ana
            sayfada (Landing) şerit çizilmediği için panele dönüş yolu bu
            satırdır. Kullanıcı: *"hesabım tıklamıcaz menüden Panom yazıcak
            ona tıklayacağız."* Öğrenci de Modül 4'te (18 Eyl 2026) şeride
            kavuştu ve aynı satırı aldı; onun "Hesabım"ı şeritte duruyor.
            Diğer rollerde şerit yok, giriş yine hesap sayfasıdır. */}
        {user?.role_id === ROLE_IDS.TUTOR || user?.role_id === ROLE_IDS.CLIENT ? (
          <NavLink to={ROUTES.bookings} onClick={onClick} className={menuItemClass}>
            <Icon name="clipboard" className="h-5 w-5" />
            Panom
          </NavLink>
        ) : (
          <NavLink to={ROUTES.profile} onClick={onClick} className={menuItemClass}>
            <Icon name="profile" className="h-5 w-5" />
            Hesabım
          </NavLink>
        )}
        {/* Admin artık kökten panele ZORLA yönlendirilmiyor (29 Ağu: admin de
            özel ders yüzeyini gezebilmeli); panele dönüş yolu bu menüde durur. */}
        {user?.role_id === ROLE_IDS.ADMIN && (
          <NavLink to={ROUTES.adminNew} onClick={onClick} className={menuItemClass}>
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

        {/* BİLDİRİMLER — üst bardaki zil kalkınca buraya taşındı.
            Zil, `/bildirimler` sayfasına giden TEK yoldu: rota hiçbir rol nav
            listesinde yok. Kaldırıp menüye koymasaydık ekran erişilemez
            kalırdı (nöbetçi: `__guards__/ustBarSadeligi.test.tsx`). */}
        <NavLink to={ROUTES.notifications} onClick={onClick} className={menuItemClass}>
          <Icon name="notifications" className="h-5 w-5" />
          Bildirimler
          {bildirimOkunmamis > 0 && (
            <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
              {bildirimOkunmamis > 9 ? "9+" : bildirimOkunmamis}
            </span>
          )}
        </NavLink>

        {/* Etiket sayfanın kendi başlığıyla aynı ("Ayarlar", 17 Eyl 2026).
            Eğitmende bu satır artık hesabın TEK girişi: "Hesabım" sekmesi
            şeritten kalktı ve içeriği gerçek sahiplerine dağıldı. */}
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
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-base font-medium leading-6 text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
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
    // Zemin saf beyaz DEĞİL (#f4f4f4; 16 Eyl 2026: bir ton koyu, navbar ve footer aynı): akıştaki beyaz içerikten ayrışsın (29 Ağu).
    ? "sticky top-0 z-40 border-b border-slate-100 bg-[#f4f4f4]/95 backdrop-blur-md "
    // Panel üst barı BEYAZ (17 Eyl 2026 kullanıcı kararı, Preply gibi; önceki
    // #f4f4f4 kararı yalnız ana sayfa/anonim kabukta sürüyor).
    : "border-b border-slate-200 bg-white ";
  /* `mobilSade` iken DOLGU DA GİZLENİR (16 Eyl 2026, ölçüldü): satır
     `hidden md:flex` olsa da dolgu bu sarmalayıcıda kaldığı için telefonda
     arama hapının üstünde 28px boş bant kalıyordu — anonim kabukta
     (`PublicNavbar`) dolgu gizlenen satırın kendisinde olduğundan orada
     yoktu; giriş yapınca "boşluk belirdi" sanılan fark buydu. */
  const innerPad = transparent
    ? `px-4 md:px-8 pt-5 pb-2 ${mobilSade ? "hidden md:block" : ""}`
    : `px-4 md:px-6 ${mobilSade ? "hidden md:block" : ""}`;
  // 30 Ağu: telefonda da TAM (yazılı) logo — kategori şeridi mobilde ikinci
  // satırda olduğundan üstte çakışma yok; yazısız simge devre dışı.
  const logoClass = "block h-8 md:h-9 w-auto object-contain";
  const logoCompactClass = "hidden";

  return (
    <>
    <header className={headerClass}>
      <div className={innerPad}>
      <div
        className={`mx-auto w-full max-w-screen-2xl justify-between gap-3 ${
          transparent ? "items-start" : "h-16 items-center md:h-[72px]"
        } ${mobilSade ? "hidden md:flex" : "flex"}`}
      >
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
        <div className="hidden flex-1 shrink-0 items-center justify-end gap-0 sm:flex">
          {/* ÜK-2 (17 Eyl 2026'da güncellendi): mesaj + bildirim + favori.
              Preply gibi okunmamış sayılar doğrudan üst barda görünür. */}
          <NavLink to={ROUTES.messages} title="Mesajlar" aria-label="Mesajlar" className={navIconClass}>
            <Icon name="messages" className="h-6 w-6" />
            <SayiRozeti n={msgUnread} />
          </NavLink>
          <NavLink to={ROUTES.notifications} title="Bildirimler" aria-label="Bildirimler" className={navIconClass}>
            <Icon name="notifications" className="h-6 w-6" />
            <SayiRozeti n={bildirimOkunmamis} />
          </NavLink>
          {favoriKisayolu && (
            <NavLink
              to={favoriKisayolu.to}
              title={favoriKisayolu.label}
              aria-label={favoriKisayolu.label}
              className={navIconClass}
            >
              <Icon name={favoriKisayolu.icon ?? "favorites"} className="h-6 w-6" />
            </NavLink>
          )}


          <div ref={accountRef} className="relative ml-2">
            <button
              type="button"
              aria-label="Hesap menüsü"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((o) => !o)}
              className="rounded ring-2 ring-transparent transition hover:ring-slate-300"
            >
              <Avatar name={user?.full_name ?? "?"} avatar_url={user?.avatar_url} size="xs" shape="kare" />
            </button>
            {accountOpen && (
              <div className="absolute right-0 top-full z-40 mt-3 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-[0_8px_32px_rgba(18,17,23,0.15)]">

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
        <div className="flex flex-1 items-center justify-end gap-0 sm:hidden">
          {/* Masaüstüyle AYNI türev (`favoriKisayolu`). Burada eskiden ayrı
              bir rol kontrolü yazılıydı ve bir kez zaten yanlış yazılmıştı:
              kısayol role bakmadan basılınca eğitmenin ve kütüphane
              operatörünün mobil üst barında, kendilerine ait olmayan ve boş
              açılan bir ekrana giden ikon duruyordu. Operatörün işi fiziksel
              olarak mobildir (QR kapıda okutulur), yani yanlış ikonu en çok o
              görüyordu. Tek türev, iki yüzey — bir daha ayrışamaz. */}
          <NavLink to={ROUTES.messages} title="Mesajlar" aria-label="Mesajlar" className={navIconClass}>
            <Icon name="messages" className="h-6 w-6" />
            <SayiRozeti n={msgUnread} />
          </NavLink>
          <NavLink to={ROUTES.notifications} title="Bildirimler" aria-label="Bildirimler" className={navIconClass}>
            <Icon name="notifications" className="h-6 w-6" />
            <SayiRozeti n={bildirimOkunmamis} />
          </NavLink>
          {favoriKisayolu && (
            <NavLink
              to={favoriKisayolu.to}
              title={favoriKisayolu.label}
              aria-label={favoriKisayolu.label}
              className="inline-flex shrink-0 items-center justify-center rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 "
            >
              <span className="relative">
                <Icon name={favoriKisayolu.icon ?? "favorites"} className="h-6 w-6" />
              </span>
            </NavLink>
          )}
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

      {/* Telefonda arama, kategorilerin ÜSTÜNDE (Airbnb sırası). */}
      {mobilUst && <div className="px-4 pb-2 pt-3 md:hidden">{mobilUst}</div>}
      {/* `justify-center` ve ikinci `px-4` KALDIRILDI — ilki içerik ekrandan
          genişse sol ucu erişilemez kırpıyor, ikincisi CategoryBar'ın kendi
          dolgusuyla üst üste biniyordu. Kaydırma artık tek kapta. */}
      {center && (
        <div className="pb-3 lg:hidden">
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
