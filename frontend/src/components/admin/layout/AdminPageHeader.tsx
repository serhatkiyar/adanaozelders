import { useLocation } from "react-router-dom";
import { Button } from "@/components/admin/ui";
import { GezinmeBaglantisi } from "@/components/admin/ui2/gezinmeBekcisi";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ROUTES } from "@/lib/routes";
import { getAdminNavItem } from "./adminNavigation";
import { BASLIK_AKSIYON_ID } from "./baslikAksiyonu";

export interface AdminPageHeaderProps {
  /** Mobil gezinme çekmecesini açar. */
  onMenuAc: () => void;
}

/**
 * ── Üst başlık şeridi (İP-B1 · docs/tasarim-dili.md §4.2) ──
 *
 * Sol: sayfa yolu + `<h1>` + açıklama. Sağ: birincil aksiyon yuvası + bildirim.
 *
 * Birincil aksiyon yuvası İP-B2'de DOLDU: artık bir `id` taşıyan boş bir
 * kutudur ve ekranlar `PanelBaslikAksiyonu` ile oraya portal açar (gerekçesi
 * `baslikAksiyonu.tsx`te — context+state yolu sonsuz döngü üretiyordu).
 * Kazanç: "Yeni ürün" panelin her ekranında AYNI yerde durur; bugüne dek her
 * ekran onu kendi içeriğinin farklı bir yerine koyuyordu.
 *
 * Bildirim alanı UYDURMA DEĞİL: `NotificationsBell` gerçek `/notifications`
 * ucuna bağlı, okunmamış sayacı ve yan paneli olan mevcut bileşendir. Panelin
 * üstündeki genel site navbar'ı kalkarken bildirime erişim kaybolmasın diye
 * buraya taşındı.
 */
export function AdminPageHeader({ onMenuAc }: AdminPageHeaderProps) {
  const { pathname } = useLocation();
  const current = getAdminNavItem(pathname);
  const kokte = current.to === ROUTES.admin;

  return (
    <header className="sticky top-0 z-30 border-b border-panel-border bg-panel-surface/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1200px] items-start gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Button
          variant="secondary"
          size="sm"
          onClick={onMenuAc}
          className="mt-0.5 shrink-0 !px-2 lg:hidden"
        >
          <span className="sr-only">Yönetim menüsünü aç</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </Button>

        <div className="min-w-0 flex-1">
          {!kokte && (
            <nav aria-label="Sayfa yolu" className="mb-0.5 hidden items-center gap-2 text-xs text-panel-fg-subtle sm:flex">
              <GezinmeBaglantisi className="transition hover:text-panel-fg" to={ROUTES.admin} end>
                Yönetim
              </GezinmeBaglantisi>
              <span aria-hidden="true">/</span>
              <span className="truncate text-panel-fg-muted">{current.shortLabel ?? current.label}</span>
            </nav>
          )}
          <h1 className="truncate text-xl font-semibold tracking-tight text-panel-fg sm:text-2xl">
            {current.label}
          </h1>
          <p className="mt-1 hidden max-w-3xl text-sm leading-6 text-panel-fg-muted md:block">
            {current.description}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div id={BASLIK_AKSIYON_ID} className="flex items-center gap-2" />
          <NotificationsBell />
        </div>
      </div>
    </header>
  );
}
