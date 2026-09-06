import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
        className="relative rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 "
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          className="h-5 w-5"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white ">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 ">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 ">
            <p className="text-sm font-semibold text-slate-900 ">
              Bildirimler
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="text-xs font-medium text-marka-metin transition hover:text-marka-metin-hover "
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
              <div className="px-4 py-10 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl ">
                  🔔
                </div>
                <p className="mt-3 text-sm text-slate-500 ">
                  Henüz bildirim yok
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50 ">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItem(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
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
                        <span className="mt-0.5 block text-xs text-slate-400 ">
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
              className="flex items-center justify-center gap-1.5 px-4 py-3 text-sm font-medium text-marka-metin transition hover:bg-slate-50 "
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
