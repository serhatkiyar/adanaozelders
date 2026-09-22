import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/components/AppIcon";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/hooks/useNotifications";
import { formatDateTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/routes";
import type { NotificationOut } from "@/types";

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
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
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
        className="relative rounded-lg p-2 text-slate-900 transition hover:text-marka-metin "
      >
        <Icon name="notifications" className="h-6 w-6" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white ">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Kart dili projenin geri kalanıyla AYNI ("elevated surface" —
          `rounded-3xl`/`shadow-2xl`/`ring-slate-100`/`zoom-in-95`, bkz.
          `AuthModal`/`BookingModal`/`DistrictMapModal` vb.); önceki
          `rounded-2xl`/`shadow-xl`/`ring-slate-200` daha zayıftı, o yüzden
          düz/karaktersiz duruyordu (kullanıcı kararı, 22 Eyl 2026). */}
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 origin-top-right overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-150 ">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 ">
            <p className="text-xl font-bold text-slate-900 ">
              Bildirimler
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="text-xs font-semibold text-marka-metin transition hover:text-marka-metin-hover "
              >
                Tümünü okundu işaretle
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-lg bg-slate-100 "
                  />
                ))}
              </div>
            ) : !items || items.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400 ">
                  <Icon name="notifications" className="h-7 w-7" />
                </div>
                <p className="mt-4 text-sm font-semibold text-slate-700 ">
                  Henüz bildirim yok
                </p>
                <p className="mt-1 text-xs text-slate-500 ">
                  Yeni bir şey olduğunda burada görünür.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50 ">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItem(n)}
                      className={`flex w-full items-start gap-3 px-5 py-3.5 text-left transition hover:bg-slate-50 ${
                        n.is_read ? "" : "bg-marka-soft/50 "
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          n.is_read ? "bg-transparent" : "bg-marka-mid"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug text-slate-700 ">
                          {n.message}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500 ">
                          {formatDateTime(n.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Tüm bildirimleri gör — özel sayfaya yönlendir ── */}
          <div className="border-t border-slate-100 ">
            <Link
              to={ROUTES.notifications}
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 px-4 py-3.5 text-sm font-semibold text-marka-metin transition hover:bg-slate-50 "
            >
              Tüm bildirimleri gör
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
                aria-hidden
              >
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
