import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { navForRole } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useInfiniteNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useUnreadCount,
} from "@/hooks/useNotifications";
import { formatDateTime } from "@/lib/datetime";
import type { NotificationOut } from "@/types";

// ── İkon eşlemesi: bildirim mesajından bağlama uygun ikon çıkar ──
function resolveIcon(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("ders") || lower.includes("rezervasyon")) return "📚";
  if (lower.includes("ödeme") || lower.includes("bakiye") || lower.includes("kazanç"))
    return "💰";
  if (lower.includes("mesaj")) return "💬";
  if (lower.includes("yorum") || lower.includes("değerlendir")) return "⭐";
  if (lower.includes("onay") || lower.includes("doğrula")) return "✅";
  if (lower.includes("iptal") || lower.includes("red")) return "❌";
  if (lower.includes("talep")) return "📩";
  if (lower.includes("kütüphane") || lower.includes("etüt")) return "🏛️";
  return "🔔";
}

// ── Zaman etiketi: bugün, dün veya tarih ──
function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "Az önce";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saat önce`;
  return formatDateTime(iso);
}

export default function Notifications() {
  const { data: user } = useCurrentUser();
  const navItems = navForRole(user?.role_id);

  return (
    <DashboardShell title="Bildirimler" navItems={navItems}>
      <NotificationsPanel />
    </DashboardShell>
  );
}

/** Bildirim gelen kutusu içeriği — hem /bildirimler sayfası hem Mesaj Merkezi
 *  sağ paneli kullanır (shell'siz). */
export function NotificationsPanel() {
  const navigate = useNavigate();
  const { data: unread = 0 } = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteNotifications();

  const notifications = data?.pages.flat() ?? [];

  // ── Infinite scroll: sayfa dibine yaklaşınca yeni sayfa çek ──
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const sentinelCallback = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        },
        { rootMargin: "200px" }
      );
      observerRef.current.observe(node);
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  // Sentinel ref'i callback ile birleştir
  useEffect(() => {
    sentinelCallback(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [sentinelCallback]);

  const handleClick = (n: NotificationOut) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="mx-auto max-w-3xl">
        {/* ── Başlık alanı ── */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 ">
              Bildirimler
            </h1>
            <p className="mt-1 text-sm text-slate-500 ">
              {unread > 0
                ? `${unread} okunmamış bildiriminiz var`
                : "Tüm bildirimleriniz güncel"}
            </p>
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-marka px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-marka-hover active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                  clipRule="evenodd"
                />
              </svg>
              Tümünü okundu işaretle
            </button>
          )}
        </div>

        {/* ── Bildirim listesi ── */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl bg-slate-100 "
              />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 py-20 text-center ">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-3xl ">
              🔔
            </div>
            <p className="mt-4 text-base font-medium text-slate-700 ">
              Henüz bildirim yok
            </p>
            <p className="mt-1 text-sm text-slate-400 ">
              Yeni bildirimler burada görünecek.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={`group flex w-full items-start gap-4 rounded-2xl p-4 text-left transition-all hover:shadow-md ${
                  n.is_read
                    ? "bg-white ring-1 ring-slate-100 hover:bg-slate-50 "
                    : "bg-marka-soft ring-1 ring-marka/20 hover:bg-marka-line/70 "
                }`}
              >
                {/* İkon */}
                <span
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${
                    n.is_read
                      ? "bg-slate-100 "
                      : "bg-marka-line "
                  }`}
                >
                  {resolveIcon(n.message)}
                </span>

                {/* İçerik */}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm leading-relaxed ${
                      n.is_read
                        ? "text-slate-600 "
                        : "font-medium text-slate-900 "
                    }`}
                  >
                    {n.message}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-slate-400 ">
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-3.5 w-3.5"
                      aria-hidden
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {relativeDate(n.created_at)}
                  </span>
                </span>

                {/* Okunmamış göstergesi */}
                {!n.is_read && (
                  <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-marka-mid ring-2 ring-marka/20 " />
                )}

                {/* Ok ikonu (link varsa) */}
                {n.link && (
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="mt-2 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-slate-500 "
                    aria-hidden
                  >
                    <path
                      fillRule="evenodd"
                      d="M5 10a.75.75 0 0 1 .75-.75h6.638L10.23 7.29a.75.75 0 1 1 1.04-1.08l3.5 3.25a.75.75 0 0 1 0 1.08l-3.5 3.25a.75.75 0 1 1-1.04-1.08l2.158-1.96H5.75A.75.75 0 0 1 5 10Z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            ))}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-1" />

            {isFetchingNextPage && (
              <div className="flex items-center justify-center py-6">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-marka border-t-transparent" />
                <span className="ml-3 text-sm text-slate-500 ">
                  Yükleniyor…
                </span>
              </div>
            )}

            {!hasNextPage && notifications.length > 0 && (
              <p className="py-6 text-center text-xs text-slate-400 ">
                Tüm bildirimler yüklendi
              </p>
            )}
          </div>
        )}
    </div>
  );
}
