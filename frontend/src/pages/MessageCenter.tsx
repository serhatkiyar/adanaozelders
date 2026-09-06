import { useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import Messages from "@/pages/Messages";
import { NotificationsPanel } from "@/pages/Notifications";
import { UYE_NAV, TUTOR_NAV, OPERATOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMessagesUnreadCount } from "@/hooks/useMessages";
import { useUnreadCount } from "@/hooks/useNotifications";
import { ROLE_IDS } from "@/types";

type Pane = "messages" | "notifications";

/** Mesaj Merkezi — Mesajlar + Bildirimler tek çatıda; solda liste-seçer
 *  kenar çubuğu (Listelerim deseni), sağda seçili bölümün içeriği. */
export default function MessageCenter() {
  const { data: user } = useCurrentUser();
  const navItems =
    user?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : user?.role_id === ROLE_IDS.CLIENT
        ? UYE_NAV
        : user?.role_id === ROLE_IDS.LIBRARY_OPERATOR
          ? OPERATOR_NAV
          : undefined;

  const [pane, setPane] = useState<Pane>("messages");
  const { data: msgCounts } = useMessagesUnreadCount();
  const { data: notifUnread = 0 } = useUnreadCount();
  const msgUnread = msgCounts?.inbox ?? 0;

  const rowClass = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
      active
        ? "bg-slate-100 font-semibold text-slate-900 "
        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 "
    }`;

  const badge = (n: number) =>
    n > 0 ? (
      <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
        {n > 9 ? "9+" : n}
      </span>
    ) : null;

  return (
    <DashboardShell title="Mesaj Merkezi" navItems={navItems}>
      <div className="mx-auto max-w-screen-2xl">
        <h1 className="text-2xl font-bold text-slate-900 ">Mesaj Merkezi</h1>

        <div className="mt-6 grid gap-8 md:grid-cols-[13rem_minmax(0,1fr)]">
          {/* Sol: bölüm seçici */}
          <aside className="md:border-r md:border-slate-100 md:pr-6 ">
            <nav className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setPane("messages")}
                className={rowClass(pane === "messages")}
              >
                <span className="truncate">Mesajlar</span>
                {badge(msgUnread)}
              </button>
              <button
                type="button"
                onClick={() => setPane("notifications")}
                className={rowClass(pane === "notifications")}
              >
                <span className="truncate">Bildirimler</span>
                {badge(notifUnread)}
              </button>
            </nav>
          </aside>

          {/* Sağ: seçili bölümün içeriği */}
          <section className="min-w-0">
            {pane === "messages" ? (
              <div className="h-[calc(100vh-16rem)] min-h-[420px] overflow-hidden rounded-2xl border border-slate-200 ">
                <Messages embedded />
              </div>
            ) : (
              <NotificationsPanel />
            )}
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
