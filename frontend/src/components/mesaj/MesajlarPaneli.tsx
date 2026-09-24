import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/AppIcon";
import { SohbetGorunumu } from "@/components/mesaj/SohbetGorunumu";
import { useConversations, useMessageSearch, useMessagesUnreadCount } from "@/hooks/useMessages";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDebounce } from "@/hooks/useDebounce";
import { formatChatTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";
import type { ConversationOut } from "@/types";

type Sekme = "all" | "unread" | "archived";
type Rol = "CLIENT" | "TUTOR" | "LIBRARY";

/**
 * Üst bardaki "Mesajlar" ikonuna basınca açılan önizleme paneli (kullanıcı
 * kararı, 22 Eyl 2026 — Preply referansı). Mesajlar sayfasında DEĞİLKEN bu
 * panel açılır; sayfanın kendisindeyken `DashboardHeader` zaten düz bir
 * `NavLink` render ediyor.
 *
 * Bir sohbete tıklayınca tam sayfaya GİTMEZ, panelin içinde küçük bir
 * konuşma görünümü açılır (kullanıcı kararı, 22 Eyl 2026: "sohbet seçince
 * böyle açılsın" — Preply referansı). Liste/arama/mesaj/gönderme/kompozer
 * hepsi `Messages.tsx`teki AYNI hook'ları ve AYNI bileşenleri kullanır
 * (`SablonPaneli`, `EmojiSecici`, birleşik kompozer kutusu; konuşma görünümü
 * 24 Eyl 2026'dan beri `SohbetGorunumu`nde, canlı dersin sohbetiyle ortak) — burada ikinci
 * bir sohbet arayüzü icat edilmedi, bizim gerçek sohbetimiz küçük bir
 * pencerede tekrar kullanıldı. Preply'nin klasör/AI-öneri/sesli mesaj
 * düğmeleri atlandı — bunların backend karşılığı yok (CLAUDE.md: backend
 * karşılığı olmayan düğme eklenmez).
 */
export function MesajlarPaneli() {
  const [open, setOpen] = useState(false);
  const [sekme, setSekme] = useState<Sekme>("all");
  const [query, setQuery] = useState("");
  const [activeConv, setActiveConv] = useState<ConversationOut | null>(null);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: user } = useCurrentUser();
  const role: Rol | null =
    user?.role_id === ROLE_IDS.CLIENT
      ? "CLIENT"
      : user?.role_id === ROLE_IDS.TUTOR
        ? "TUTOR"
        : user?.role_id === ROLE_IDS.LIBRARY_OPERATOR
          ? "LIBRARY"
          : null;
  // Arama kutusu karşı tarafı adıyla anar: öğrenci öğretmenlerini, öğretmen
  // öğrencilerini arar (24 Eyl 2026 — önceden her rolde "Öğrencileri" yazıyordu).
  const aramaMetni =
    role === "CLIENT" ? "Öğretmenleri veya mesajları ara" : "Öğrencileri veya mesajları ara";

  const { data: unreadCounts } = useMessagesUnreadCount();
  const inboxUnread = unreadCounts?.inbox ?? 0;
  const archivedUnread = unreadCounts?.archived ?? 0;

  const term = useDebounce(query.trim(), 300);
  const searching = term.length > 0;

  const { data: conversations, isLoading: inboxLoading } = useConversations(
    false,
    open && !activeConv && !searching && sekme !== "archived"
  );
  const { data: archivedConversations, isLoading: archivedLoading } = useConversations(
    true,
    open && !activeConv && !searching && sekme === "archived"
  );
  const { data: searchResults, isLoading: searchLoading } = useMessageSearch(
    open && !activeConv ? term : ""
  );

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

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSekme("all");
      setActiveConv(null);
      setText("");
    }
  }, [open]);

  const list: ConversationOut[] | undefined = searching
    ? searchResults?.chats
    : sekme === "archived"
      ? archivedConversations
      : sekme === "unread"
        ? conversations?.filter((c) => (c.unread ?? 0) > 0)
        : conversations;
  const loading = searching
    ? searchLoading
    : sekme === "archived"
      ? archivedLoading
      : inboxLoading;

  const openFullPage = () => {
    setOpen(false);
    if (activeConv?.counterparty_id) {
      const params = new URLSearchParams({ to: String(activeConv.counterparty_id) });
      if (activeConv.counterparty_role) params.set("role", activeConv.counterparty_role);
      navigate(`${ROUTES.messages}?${params.toString()}`);
    } else {
      navigate(ROUTES.messages);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Mesajlar"
        aria-label="Mesajlar"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-10 w-9 items-center justify-center rounded-lg text-slate-900 transition hover:text-marka-metin "
      >
        <Icon name="messages" className="h-6 w-6" />
        {inboxUnread > 0 && (
          <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ">
            {inboxUnread > 9 ? "9+" : inboxUnread}
          </span>
        )}
      </button>

      {/* Kart dili projenin geri kalanıyla AYNI ("elevated surface" —
          `rounded-3xl`/`shadow-2xl`/`ring-slate-100`/`zoom-in-95`, bkz.
          `AuthModal`/`BookingModal`/`DistrictMapModal` vb.); önceki
          `rounded-2xl`/`shadow-xl`/`ring-slate-200` daha zayıftı, panel bu
          yüzden düz/karaktersiz duruyordu (kullanıcı kararı, 22 Eyl 2026:
          "html ile yazmışız gibi duruyor, fotojenik değil"). Genişlik/dolgu
          da Preply referansındaki gibi biraz daha ferah. */}
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 flex h-[32rem] w-[25rem] origin-top-right flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in zoom-in-95 duration-150 ">
          {/* Başlık: sohbet açıkken geri oku + karşı taraf, kapalıyken "Mesajlar" */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-4 ">
            {activeConv ? (
              <button
                type="button"
                onClick={() => setActiveConv(null)}
                className="-mx-1.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-0.5 text-left transition hover:bg-slate-50 "
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0 text-slate-500 ">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
                <Avatar
                  name={activeConv.counterparty_name ?? "?"}
                  avatar_url={activeConv.counterparty_avatar_url}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-xl font-bold text-slate-900 ">
                  {activeConv.counterparty_name ?? "Kullanıcı"}
                </span>
              </button>
            ) : (
              <p className="text-xl font-bold text-slate-900 ">Mesajlar</p>
            )}
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={openFullPage}
                title="Tam sayfada aç"
                aria-label="Tam sayfada aç"
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-marka-metin "
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Kapat"
                aria-label="Kapat"
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-marka-metin "
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {activeConv ? (
            <>
              <SohbetGorunumu
                konusmaId={activeConv.id}
                karsiTarafId={activeConv.counterparty_id}
                karsiTarafRol={activeConv.counterparty_role}
                rol={role}
                metin={text}
                setMetin={setText}
              />
            </>
          ) : (
            <>
              {/* Arama kutusu: `Messages.tsx`teki gerçek arama kutusuyla AYNI
                  stil — beyaz zemin + ince çerçeve, dolgulu gri kutu DEĞİL
                  (önceki hali hem Preply referansından hem kendi gerçek
                  sayfamızdan sapıyordu, kullanıcı fark etti, 22 Eyl 2026). */}
              <div className="border-b border-slate-200 px-5 py-4 ">
                <div className="flex items-center gap-2.5 rounded-full border border-slate-300 bg-white px-4 py-2.5 transition focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-200 ">
                  <Icon name="search" className="h-4 w-4 shrink-0 text-slate-500" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={aramaMetni}
                    aria-label={aramaMetni}
                    className="w-full min-w-0 border-0 bg-transparent p-0 text-sm text-slate-900 placeholder-slate-500 outline-none focus:ring-0 "
                  />
                </div>
              </div>

              {!searching && (
                <div className="flex items-center gap-5 border-b border-slate-200 px-5 ">
                  {(
                    [
                      { key: "all", label: "Tümü" },
                      { key: "unread", label: "Okunmadı" },
                      { key: "archived", label: "Arşivlendi" },
                    ] as const
                  ).map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setSekme(s.key)}
                      className={`relative flex items-center gap-1.5 py-3 text-sm transition ${
                        sekme === s.key
                          ? "font-bold text-slate-900 "
                          : "font-medium text-slate-500 hover:text-slate-700 "
                      }`}
                    >
                      {s.label}
                      {s.key === "unread" && inboxUnread > 0 && (
                        <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-marka px-1 text-[10px] font-bold text-marka-fg ">
                          {inboxUnread > 9 ? "9+" : inboxUnread}
                        </span>
                      )}
                      {s.key === "archived" && archivedUnread > 0 && (
                        <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-marka px-1 text-[10px] font-bold text-marka-fg ">
                          {archivedUnread > 9 ? "9+" : archivedUnread}
                        </span>
                      )}
                      {sekme === s.key && (
                        <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-marka " />
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="space-y-2 px-5 py-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100 " />
                    ))}
                  </div>
                ) : !list || list.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                    {/* Boş durum görselleri Mesajlar sayfasıyla AYNI (23 Eyl 2026):
                        arşiv → arşiv kutusu, gelen/okunmamış → omuz silkme.
                        Aramada sayfanın görsel karşılığı yok; büyüteç kalır. */}
                    {searching ? (
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400 ">
                        <Icon name="search" className="h-7 w-7" />
                      </div>
                    ) : (
                      <img
                        src={sekme === "archived" ? "/icons/arsiv.png" : "/icons/omuz-silkme.png"}
                        alt=""
                        aria-hidden
                        className="h-24 w-24"
                      />
                    )}
                    <p className="mt-4 text-sm font-semibold text-slate-700 ">
                      {searching
                        ? "Sonuç bulunamadı"
                        : sekme === "archived"
                          ? "Arşiv boş"
                          : sekme === "unread"
                            ? "Okunmamış mesaj yok"
                            : "Henüz mesajın yok"}
                    </p>
                    {searching && (
                      <p className="mt-1 text-xs text-slate-500 ">
                        "{term}" için isim veya mesaj eşleşmedi.
                      </p>
                    )}
                  </div>
                ) : (
                  // `slate-50` neredeyse görünmüyordu (Preply referansındaki
                  // çizgi belirgin) — `slate-100`e koyulaştırıldı, 22 Eyl 2026.
                  <ul className="divide-y divide-slate-200 ">
                    {list.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setActiveConv(c)}
                          className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50 "
                        >
                          <Avatar
                            name={c.counterparty_name ?? "?"}
                            avatar_url={c.counterparty_avatar_url}
                            size="md"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[15px] font-bold text-slate-900 ">
                                {c.counterparty_name ?? "Kullanıcı"}
                              </span>
                              <span className="shrink-0 text-xs text-slate-500 ">
                                {formatChatTime(c.last_message_at)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <p className="min-w-0 truncate text-sm text-slate-500 ">
                                {c.last_message ?? "Yeni sohbet"}
                              </p>
                              {(c.unread ?? 0) > 0 && (
                                <span className="inline-flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-marka px-1 text-[10px] font-bold text-marka-fg ">
                                  {(c.unread ?? 0) > 9 ? "9+" : c.unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
