import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/admin/ui";
import { GezinmeBaglantisi } from "@/components/admin/ui2/gezinmeBekcisi";
import { useOpenReportCount } from "@/hooks/useReports";
import { ROUTES } from "@/lib/routes";
import { ADMIN_NAV_GROUPS, ADMIN_NAV_ITEMS, type AdminNavItem } from "./adminNavigation";
import { AdminProfilMenusu } from "./AdminProfilMenusu";
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

function Glif({ ad, className }: { ad: AdminNavItem["icon"]; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICONS[ad]}
    </svg>
  );
}

export interface AdminSidebarProps {
  onNavigate?: () => void;
  /** Yalnız ikon gösterilen dar hâl (masaüstü rail). */
  katli?: boolean;
  /** Komut penceresini açar. */
  onAramaAc: () => void;
  /** Katlamayı çeviren düğme — çekmece varyantında verilmez. */
  onKatlamaDegistir?: () => void;
  /**
   * `data-testid` ve dolayısıyla nöbetçi kimliği. Rail ve çekmece AYNI
   * bileşendir ama aynı anda DOM'da bulunabilir; testin hangisini ölçtüğü
   * belirsiz kalmasın diye kimlik çağırandan gelir.
   */
  testId?: string;
}

/**
 * ── Panel gezinme çubuğu: ÜÇ BÖLGE (İP-B1 · docs/tasarim-dili.md §4.1) ──
 *
 * Üst: marka + arama öğesi (komut penceresini açar) + katlama.
 * Orta: alan gezinmesi — **yalnız bu bölge kayar**.
 * Alt: Ayarlar + profil menüsü (tema anahtarı, çıkış).
 *
 * Ayarların gezinme gruplarının DIŞINDA, altta durmasının sebebi Medusa'yla
 * aynı: ayarlar bir alan değil bir kiptir. Grupların içinde olsaydı "Platform"
 * başlığı altında, "Kullanıcılar"la aynı seviyede görünürdü.
 *
 * Katlı hâlde etiket metni DOM'dan kalkar ama erişilebilir ad `aria-label` ile
 * KORUNUR. Bu bir süs değil, kabuğun kırmızı matrisindeki bir madde: ikon-only
 * gezinme, adı `<span>`den alan bir yazımda ekran okuyucuya sessiz kalır.
 */
export function AdminSidebar({
  onNavigate,
  katli = false,
  onAramaAc,
  onKatlamaDegistir,
  testId,
}: AdminSidebarProps) {
  const { pathname } = useLocation();
  // FAIL-CLOSED (İP-4/F-1): izin bilgisi yüklenemediyse menü öğesi
  // GÖSTERİLMEZ. Eskiden `!permissions ||` ile fail-open'dı ve `lib/adminAccess`
  // ile aynı sözleşmeyi paylaşıyordu; o sözleşme değişti, bu da onunla gitti —
  // aksi hâlde menüde görünüp tıklandığında 403 veren bir öğe kalırdı.
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  const izinVar = (kod?: string) => !kod || (permissions?.includes(kod) ?? false);
  const { data: openReports = 0 } = useOpenReportCount(izinVar("reports.view"));

  const ayarlar = ADMIN_NAV_ITEMS.find((i) => i.to === ROUTES.adminSettings);

  const ogeSinifi = (aktif: boolean) =>
    `group flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus focus-visible:ring-offset-2 focus-visible:ring-offset-panel-surface ${
      katli ? "justify-center px-0" : ""
    } ${
      aktif
        ? "bg-panel-accent-soft text-panel-accent"
        : "text-panel-fg-muted hover:bg-panel-surface-hover hover:text-panel-fg"
    }`;

  return (
    <div
      data-testid={testId}
      data-katli={katli ? "true" : "false"}
      className="flex h-full min-h-0 flex-col bg-panel-surface"
    >
      {/* ── ÜST: marka · arama · katlama ── */}
      <div data-testid="rail-ust" className="flex flex-col gap-2 border-b border-panel-border p-3">
        <div className={`flex items-center gap-2 ${katli ? "justify-center" : ""}`}>
          <Link
            to={ROUTES.admin}
            onClick={onNavigate}
            aria-label="Yönetim paneli ana sayfası"
            className="flex min-w-0 items-center gap-2 rounded-xl px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-panel-accent text-sm font-semibold text-panel-accent-fg"
            >
              A
            </span>
            {!katli && (
              <span className="min-w-0 truncate text-sm font-semibold text-panel-fg">Yönetim</span>
            )}
          </Link>
          {!katli && onKatlamaDegistir && (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={false}
              onClick={onKatlamaDegistir}
              className="ml-auto !px-2"
            >
              <span className="sr-only">Menüyü katla</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                <path strokeLinecap="round" d="M15 5v14M4 12h7m0 0-3-3m3 3-3 3" />
              </svg>
            </Button>
          )}
        </div>

        {katli && onKatlamaDegistir && (
          <Button variant="ghost" size="sm" aria-pressed onClick={onKatlamaDegistir} className="!px-2">
            <span className="sr-only">Menüyü katla</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path strokeLinecap="round" d="M9 5v14M20 12h-7m0 0 3-3m-3 3 3 3" />
            </svg>
          </Button>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={onAramaAc}
          className={`w-full ${katli ? "!px-2" : "justify-start !font-normal"}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 flex-none">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
          </svg>
          {katli ? (
            <span className="sr-only">Ara</span>
          ) : (
            <>
              <span className="flex-1 text-left text-panel-fg-subtle">Ara</span>
              <kbd className="flex-none rounded-md border border-panel-border px-1.5 py-0.5 text-[10px] font-semibold text-panel-fg-subtle">
                Ctrl K
              </kbd>
            </>
          )}
        </Button>
      </div>

      {/* ── ORTA: alan gezinmesi (yalnız bu bölge kayar) ── */}
      <div data-testid="rail-orta" className="min-h-0 flex-1 overflow-y-auto">
        <nav aria-label="Yönetim menüsü" className="space-y-4 px-3 py-4">
          {ADMIN_NAV_GROUPS.map((group) => {
            const items = ADMIN_NAV_ITEMS.filter(
              (item) => item.group === group && item.to !== ROUTES.adminSettings && izinVar(item.requiredPermission)
            );
            if (items.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`admin-nav-${group}`}>
                {!katli && (
                  <h2
                    id={`admin-nav-${group}`}
                    className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-panel-fg-subtle"
                  >
                    {group}
                  </h2>
                )}
                {/* Katlı hâlde başlık görünmez ama gruplama ekran okuyucuda
                    korunur: `aria-label` başlığın yerine geçer. */}
                <div className="space-y-0.5" role="group" aria-label={katli ? group : undefined}>
                  {items.map((item) => {
                    // ── İKON DEĞİL ROTA (İP-B1 · Görev 5 · tarayıcı turu) ──
                    //
                    // Eski koşul `item.icon === "store"` idi ve "Hakedişler"
                    // de o ikonu taşıyor: `/yonetim/magaza/*` altındayken
                    // kenar çubuğunda İKİ öğe birden etkin görünüyordu.
                    // Ekran görüntüsünde yakalandı; `aria-current` doğruydu
                    // (yalnız Mağaza'daydı), yani hata SALT GÖRSELDİ ve
                    // hiçbir a11y nöbetçisi göremezdi.
                    const storeActive =
                      item.to === ROUTES.adminStoreProducts &&
                      pathname.startsWith("/yonetim/magaza/");
                    const etiket = item.shortLabel ?? item.label;
                    return (
                      <GezinmeBaglantisi
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={onNavigate}
                        aria-label={katli ? etiket : undefined}
                        title={katli ? etiket : undefined}
                        className={({ isActive }) => ogeSinifi(isActive || storeActive)}
                      >
                        {({ isActive }) => {
                          const active = isActive || storeActive;
                          return (
                            <>
                              {/* Etkinlik DOM'da GÖRÜNÜR bir sözleşme:
                                  `aria-current` yalnız NavLink'in kendi
                                  eşleşmesini yansıtıyor, `storeActive` gibi
                                  türetilmiş etkinlikleri değil. Bu yüzden
                                  "aynı anda kaç öğe etkin" sorusu ancak
                                  buradan ölçülebilir (tur, iki öğenin birden
                                  etkin göründüğü bir hatayı ekran
                                  görüntüsünden yakaladı). */}
                              <span data-etkin={active ? "true" : "false"} className="sr-only" />
                              <Glif
                                ad={item.icon}
                                className={`h-[18px] w-[18px] shrink-0 ${
                                  active ? "text-panel-accent" : "text-panel-fg-subtle group-hover:text-panel-fg"
                                }`}
                              />
                              {!katli && <span className="min-w-0 flex-1 truncate">{etiket}</span>}
                              {item.badge === "open-reports" && openReports > 0 && (
                                <span
                                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
                                    katli ? "absolute" : ""
                                  } bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300`}
                                >
                                  {openReports > 99 ? "99+" : openReports}
                                </span>
                              )}
                            </>
                          );
                        }}
                      </GezinmeBaglantisi>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>
      </div>

      {/* ── ALT: Ayarlar + profil ── */}
      <div data-testid="rail-alt" className="space-y-1 border-t border-panel-border p-3">
        {ayarlar && izinVar(ayarlar.requiredPermission) && (
          <GezinmeBaglantisi
            to={ayarlar.to}
            onClick={onNavigate}
            aria-label={katli ? "Ayarlar" : undefined}
            title={katli ? "Ayarlar" : undefined}
            className={({ isActive }) => ogeSinifi(isActive)}
          >
            {({ isActive }) => (
              <>
                <Glif
                  ad="settings"
                  className={`h-[18px] w-[18px] shrink-0 ${
                    isActive ? "text-panel-accent" : "text-panel-fg-subtle group-hover:text-panel-fg"
                  }`}
                />
                {!katli && <span className="min-w-0 flex-1 truncate">Ayarlar</span>}
              </>
            )}
          </GezinmeBaglantisi>
        )}
        <AdminProfilMenusu katli={katli} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
