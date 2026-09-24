import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/hooks/useNotifications";
import { formatChatTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/routes";
import type { NotificationOut } from "@/types";

/**
 * Bildirim paneli — üst bardaki zilin altında açılır.
 *
 * Görsel dil Mesajlar paneliyle AYNI (`components/mesaj/MesajlarPaneli.tsx`,
 * kullanıcı kararı 22 Eyl 2026): aynı kabuk ölçüsü (25rem × 32rem), aynı
 * başlık satırı ve kapatma düğmesi, aynı liste ritmi. İki panel üst barda yan
 * yana duruyor; farklı görünmeleri için bir sebep yok.
 *
 * Satırdaki ikon bildirimin GİTTİĞİ yerden türetilir: kullanıcı okumadan önce
 * neyin bildirimi olduğunu görür. Bağlantı yoksa zil ikonu kalır — uydurma
 * bir tür gösterilmez.
 */

/**
 * Bildirim linki → satır görseli (Fluent Emoji 3D, kullanıcı kararı 22 Eyl
 * 2026). Yalnız gerçekten üretilen yollar eşleşir; tanınmayan ya da linksiz
 * bildirimde zil kalır — uydurma bir tür gösterilmez.
 */
function satirGorseli(link?: string | null): string {
  if (!link) return "/icons/bildirim-genel.png";
  if (link.startsWith("/mesajlar") || link.startsWith("/mesaj-merkezi")) return "/icons/bildirim-mesaj.png";
  if (link.startsWith("/ders-talepleri")) return "/icons/bildirim-talep.png";
  if (link.startsWith("/takvim")) return "/icons/bildirim-takvim.png";
  if (link.startsWith("/siparislerim") || link.startsWith("/magaza")) return "/icons/bildirim-kargo.png";
  if (link.startsWith("/dersler") || link.startsWith("/rezervasyon")) return "/icons/bildirim-ders.png";
  if (link.startsWith("/bakiyem")) return "/icons/bildirim-para.png";
  if (link.startsWith("/degerlendirmeler")) return "/icons/bildirim-yildiz.png";
  if (link.startsWith("/ayarlar") || link.startsWith("/profil")) return "/icons/bildirim-ayarlar.png";
  return "/icons/bildirim-genel.png";
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: unread = 0 } = useUnreadCount();
  const { data: items, isLoading } = useNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  // ── Airbnb-style: açılır açılmaz tüm bildirimleri otomatik okundu işaretle ──
  useEffect(() => {
    if (open && unread > 0) {
      markAll.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const handleItem = (n: NotificationOut) => {
    if (!n.is_read) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Bildirimler"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-10 w-9 items-center justify-center rounded-lg text-slate-900 transition hover:text-marka-metin"
      >
        <Icon name="notifications" className="h-6 w-6" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 flex max-h-[32rem] w-[25rem] origin-top-right flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
            <p className="text-xl font-bold text-slate-900">Bildirimler</p>
            <div className="flex shrink-0 items-center gap-1">
              {items && items.length > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-marka-metin"
                >
                  Tümünü okundu işaretle
                </button>
              )}
              <PlainButton
                aria-label="Kapat"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-marka-metin"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </PlainButton>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-2xl bg-slate-100" />
                ))}
              </div>
            ) : !items || items.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <img src="/icons/zil.png" alt="" aria-hidden className="h-28 w-28" />
                <p className="mt-4 text-sm font-semibold text-slate-700">Henüz bildirim yok</p>
                <p className="mt-1 text-xs text-slate-500">Yeni bir şey olduğunda burada görünür.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-200">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItem(n)}
                      className={`flex w-full items-start gap-3 px-5 py-3.5 text-left transition hover:bg-slate-50 ${
                        n.is_read ? "" : "bg-marka-soft/40"
                      }`}
                    >
                      <img
                        src={satirGorseli(n.link)}
                        alt=""
                        aria-hidden
                        className="mt-0.5 h-9 w-9 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-sm leading-snug ${
                            n.is_read ? "text-slate-700" : "font-semibold text-slate-900"
                          }`}
                        >
                          {n.message}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {formatChatTime(n.created_at)}
                        </span>
                      </span>
                      {!n.is_read && (
                        <span aria-hidden className="mt-3 h-2 w-2 shrink-0 rounded-full bg-marka" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-200">
            <Link
              to={ROUTES.notifications}
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 px-4 py-3.5 text-sm font-semibold text-marka-metin transition hover:bg-slate-50"
            >
              Tüm bildirimleri gör
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M5.22 14.78a.75.75 0 0 1 0-1.06l3.22-3.22H4a.75.75 0 0 1 0-1.5h4.44L5.22 5.78a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0Z"
                  clipRule="evenodd"
                />
              </svg>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
