import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";

import { useModalA11y } from "@/hooks/useModalA11y";
import { useMessagesUnreadCount } from "@/hooks/useMessages";
import { ROUTES } from "@/lib/routes";
import type { NavItem } from "@/lib/nav";

/**
 * TELEFONDA SAĞDAN AÇILAN PANEL ÇEKMECESİ (kullanıcı kararı, 19 Eyl 2026).
 *
 * ## Neden var
 *
 * Telefonda panel sayfaları üst üste İKİ tam-genişlik gezinme çubuğu
 * çiziyordu: logolu üst bar ve hemen altında yatay panel şeridi (Pano ·
 * Takvim · Mesajlar · Analizler · İlanım). Alt sekme çubuğu da sayılınca
 * içerik başlamadan üç kat gezinme oluyordu ve aynı hedef birden çok yerde
 * tekrarlanıyordu (Mesajlar üçe, Pano ikiye).
 *
 * Kullanıcı kararı: yatay şerit telefonda kalksın, bölümler üst bardaki
 * hamburger düğmesinden açılan bu çekmeceden seçilsin. Şerit `≥sm`de
 * (640px) aynen durur — çekmece yalnız hamburger'ın göründüğü bantta,
 * yani `<sm`de çizilir. İki kırılım noktası BİLEREK eşittir: şerit
 * hamburger'ın olmadığı bir bantta gizlenseydi bölümlere giden yol
 * tamamen kapanırdı.
 *
 * ## Portal ZORUNLU
 *
 * `Modal`daki ile aynı gerekçe: üst bar `backdrop-blur` kullanır ve blur'lu
 * bir ata, içindeki `position: fixed` öğeyi kendi kutusuna hapseder. Portal
 * olmasaydı çekmece ekranın sağına değil üst barın içine çizilirdi.
 *
 * ## Erişilebilirlik
 *
 * Odak tuzağı, Esc ile kapanma, odağın geri verilmesi ve arka planın
 * kaydırma kilidi `useModalA11y`den gelir — bu kod tabanındaki tek doğru
 * uygulama odur, ikinci bir kopyası yazılmaz.
 */
export function MobilPanelCekmecesi({
  open,
  onClose,
  sekmeler,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Panel bölümleri (şeridin telefondaki karşılığı). Yoksa yalnız hesap satırları çizilir. */
  sekmeler?: NavItem[];
  /** Hesap satırları — `DashboardHeader` kendi `accountLinks`ini geçer. */
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const { data: msgUnreadCounts } = useMessagesUnreadCount();
  const msgUnread = msgUnreadCounts?.inbox ?? 0;

  useModalA11y({ open, onClose, panelRef });

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] sm:hidden">
      {/* Arka plan: tıklayınca kapanır. `<button>` olduğu için klavyeyle de
          erişilebilir — div + onClick sessizce klavyeye kapalı kalırdı. */}
      <button
        type="button"
        aria-label="Menüyü kapat"
        className="absolute inset-0 bg-slate-950/50"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Panel menüsü"
        className="absolute inset-y-0 right-0 flex w-[85vw] max-w-xs flex-col overflow-y-auto bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <span className="text-base font-semibold text-slate-900">Menü</span>
          <button
            type="button"
            aria-label="Menüyü kapat"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="h-5 w-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {sekmeler && sekmeler.length > 0 && (
          <div className="flex flex-col gap-0.5 border-b border-slate-100 p-2">
            {sekmeler.map((item) =>
              // Donmuş bölüm bağlantı DEĞİL — şeritteki (`PanelSekmeleri`) ve
              // hesap menüsündeki aynı kuralın karşılığı.
              item.yakinda ? (
                <span
                  key={item.to}
                  aria-disabled="true"
                  tabIndex={-1}
                  className={`${CEKMECE_SATIRI} cursor-default text-slate-400 opacity-70`}
                >
                  {item.label}
                </span>
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onClose}
                  // Alt sayfada (ör. ilanı öne çıkar) `NavLink` yalnız kendi
                  // `to`suna bakar ve hiçbir bölüm işaretlenmezdi; şeritteki
                  // ile aynı `altYollar` eşleşmesi burada da uygulanır.
                  aria-current={
                    (item.altYollar ?? []).some((p) => pathname.startsWith(p))
                      ? "page"
                      : undefined
                  }
                  className={({ isActive }) =>
                    `${CEKMECE_SATIRI} ${
                      isActive ||
                      (item.altYollar ?? []).some((p) => pathname.startsWith(p))
                        ? "bg-slate-100 font-semibold text-slate-900"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`
                  }
                >
                  {item.label}
                  {item.to === ROUTES.messages && msgUnread > 0 && (
                    <span className="ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                      {msgUnread > 9 ? "9+" : msgUnread}
                    </span>
                  )}
                </NavLink>
              )
            )}
          </div>
        )}

        <div className="flex flex-col gap-0.5 p-2">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/** Hesap menüsü satırlarıyla AYNI ölçü — çekmecede iki grup yan yana duruyor. */
const CEKMECE_SATIRI =
  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-base font-medium leading-6 transition";
