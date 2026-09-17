import { NavLink, useLocation } from "react-router-dom";
import { useMessagesUnreadCount } from "@/hooks/useMessages";
import { ROUTES } from "@/lib/routes";
import type { NavItem } from "@/lib/nav";

/**
 * PANEL ŞERİDİ — üst barın hemen altında duran kalıcı sekme satırı.
 *
 * Kullanıcı kararı (8 Eyl 2026, Superprof'un eğitmen paneli gösterilerek):
 * panele giriş tek bir avatar açılırından olmasın, bölümler her sayfada
 * yerinde dursun. Görünüm Superprof'un koyu bandı DEĞİL — site tek tema ve
 * açık; şerit üst barla aynı zemini (#f4f4f4; 16 Eyl 2026: bir ton koyu, navbar ve footer aynı) taşır, aktif sekme marka
 * turuncusu bir alt çizgiyle işaretlenir.
 *
 * Metin-only (ikon yok): altı sekme mobilde yatay kayıyor, ikon satırı
 * kalabalıklaştırırdı.
 *
 * Şeridi kim çizer: `DashboardShell`. Sayfalar bu bileşeni doğrudan
 * çağırmaz — kabuk role göre kendisi türetir (`panoSekmeleriForRole`).
 */
export function PanelSekmeleri({ items }: { items: NavItem[] }) {
  const { data: msgUnreadCounts } = useMessagesUnreadCount();
  const msgUnread = msgUnreadCounts?.inbox ?? 0;
  const { pathname } = useLocation();

  return (
    <div className="border-b border-slate-200 bg-white">
      <nav
        aria-label="Panel bölümleri"
        // Mobilde altı sekme sığmaz: yatay kayar, çubuk gizlenir. Aynı reçete
        // üst bardaki kategori şeridinde de kullanılıyor (DashboardHeader).
        className="mx-auto flex w-full max-w-screen-2xl gap-2 overflow-x-auto px-0 md:px-2"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {items.map((item) =>
          // Donmuş bölüm bağlantı DEĞİL (bkz. lib/ozellikBayraklari.ts).
          // Şeritte şu an donmuş öğe yok; sözleşme `NavItem` gereği taşınır.
          item.yakinda ? (
            <span
              key={item.to}
              aria-disabled="true"
              tabIndex={-1}
              className="shrink-0 cursor-default whitespace-nowrap px-4 py-4 text-base font-semibold leading-6 text-slate-400 opacity-70"
            >
              {item.label}
            </span>
          ) : (
            (() => {
              // Alt sayfada (ör. ilanı öne çıkar) `NavLink` kendi `to`suna
              // bakar ve hiçbir sekme işaretlenmezdi; ek yollar burada
              // eşleşir ve `aria-current` de elle verilir.
              const altAktif = (item.altYollar ?? []).some((p) =>
                pathname.startsWith(p)
              );
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  aria-current={altAktif ? "page" : undefined}
                  className={({ isActive }) =>
                    `relative shrink-0 whitespace-nowrap px-4 py-4 text-base font-semibold leading-6 transition after:absolute after:inset-x-4 after:-bottom-px after:h-1 after:content-[''] ${
                      isActive || altAktif
                        ? "text-slate-900 after:bg-marka"
                        : "text-slate-600 after:bg-transparent hover:text-slate-900"
                    }`
                  }
                >
                  {item.label}
                  {item.to === ROUTES.messages && msgUnread > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 align-middle text-[10px] font-bold text-white">
                      {msgUnread > 9 ? "9+" : msgUnread}
                    </span>
                  )}
                </NavLink>
              );
            })()
          )
        )}
      </nav>
    </div>
  );
}
