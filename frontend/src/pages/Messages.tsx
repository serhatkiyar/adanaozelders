import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AxiosError } from "axios";
import { DashboardShell } from "@/components/DashboardShell";
import { Avatar } from "@/components/Avatar";
import { BookingActionCard } from "@/components/BookingActionCard";
import { RightContextPanel } from "@/components/RightContextPanel";
import { STUDENT_NAV, TUTOR_NAV, OPERATOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useArchiveConversation,
  useConversations,
  useMarkConversationRead,
  useMessages,
  useMessageSearch,
  useMessagesUnreadCount,
  useSendMessage,
  useToggleReaction,
} from "@/hooks/useMessages";
import { useDebounce } from "@/hooks/useDebounce";
import { formatChatTime, formatDateTime } from "@/lib/datetime";
import { buildSnippet } from "@/lib/messageSearch";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROLE_IDS } from "@/types";
import type { ConversationOut, MessageOut, MessageSearchHit } from "@/types";

const REACTION_EMOJIS = ["👍", "❤️", "😄", "🎉", "😮", "😢", "🙏"];

type Role = "CLIENT" | "TUTOR" | "LIBRARY";

export default function Messages() {
  const { data: user } = useCurrentUser();
  const role: Role | null =
    user?.role_id === ROLE_IDS.CLIENT
      ? "CLIENT"
      : user?.role_id === ROLE_IDS.TUTOR
        ? "TUTOR"
        : user?.role_id === ROLE_IDS.LIBRARY_OPERATOR
          ? "LIBRARY"
          : null;
  const navItems =
    role === "TUTOR"
      ? TUTOR_NAV
      : role === "CLIENT"
        ? STUDENT_NAV
        : role === "LIBRARY"
          ? OPERATOR_NAV
          : undefined;

  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Seçili sohbetin başlık/arşiv bilgisi. Gözatma listesinde olmayabileceği için
  // (ör. arşiv sekmesindeyken aramadan bir mesaja atlanınca) tıklama anında saklanır.
  const [selectedMeta, setSelectedMeta] = useState<{
    id: number;
    counterpartyId: number | null;
    counterpartyRole?: string | null;
    name: string | null;
    avatar?: string | null;
    archived: boolean;
  } | null>(null);
  const [draft, setDraft] = useState<{
    counterpartyId: number;
    counterpartyRole?: string | null;
    name: string;
  } | null>(null);
  // Aramadan bir mesaja atlandığında, mesajlar yüklenince kaydırılacak hedef.
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<number | null>(
    null
  );
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

  // Arama sunucu tarafında (ad + tüm mesaj geçmişi); "okunmamış" istemci tarafı.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "archived">("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<MessageOut | null>(null);
  const debouncedQuery = useDebounce(query, 300);
  const term = debouncedQuery.trim();
  const searching = term.length > 0;

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const { data: conversations, isLoading } = useConversations(filter === "archived");
  const { data: searchResults, isLoading: searchLoading } = useMessageSearch(term);
  // Okunmamış sayısı: gelen kutusu rozeti "Okunmamış" çipinde, arşivdeki
  // okunmamışlar ise arşiv ikonunda gösterilir (arama sonucuna bağlı değil).
  const { data: unreadCounts } = useMessagesUnreadCount();
  const inboxUnread = unreadCounts?.inbox ?? 0;
  const archivedUnread = unreadCounts?.archived ?? 0;

  const openConversation = (
    meta: {
      id: number;
      counterpartyId: number | null;
      counterpartyRole?: string | null;
      name: string | null;
      avatar?: string | null;
      archived: boolean;
    },
    matchMessageId?: number | null
  ) => {
    setSelectedId(meta.id);
    setSelectedMeta(meta);
    setDraft(null);
    setReplyTarget(null);
    setPendingScrollMessageId(matchMessageId ?? null);
  };

  // Profilden "Mesaj Gönder" ile gelindiğinde (?to=&name=) doğru sohbeti seç
  // veya henüz yoksa taslak oluştur. Çözümleyince parametreyi temizle.
  useEffect(() => {
    const toParam = searchParams.get("to");
    if (!toParam || conversations === undefined) return;
    const cpId = Number(toParam);
    const toRole = searchParams.get("role"); // CLIENT | TUTOR | LIBRARY (opsiyonel)
    const existing = conversations.find(
      (c) =>
        c.counterparty_id === cpId &&
        (!toRole || c.counterparty_role === toRole)
    );
    if (existing) {
      openConversation({
        id: existing.id,
        counterpartyId: existing.counterparty_id ?? cpId,
        counterpartyRole: existing.counterparty_role,
        name: existing.counterparty_name ?? null,
        avatar: existing.counterparty_avatar_url,
        archived: existing.archived ?? false,
      });
    } else {
      setDraft({
        counterpartyId: cpId,
        counterpartyRole: toRole,
        name: searchParams.get("name") ?? "Kullanıcı",
      });
      setSelectedId(null);
      setSelectedMeta(null);
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, conversations, setSearchParams]);

  const browseConv = useMemo(
    () => conversations?.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  // "Okunmamış" filtresi (arşiv zaten sunucuda uygulandı)
  const filteredConversations = useMemo(() => {
    if (!conversations) return conversations;
    if (filter !== "unread") return conversations;
    return conversations.filter((c) => (c.unread ?? 0) > 0);
  }, [conversations, filter]);

  // Başlık/aksiyon bilgisi: önce taze gözatma kaydı, yoksa tıklamadaki meta.
  const activeCounterpartyId =
    browseConv?.counterparty_id ??
    selectedMeta?.counterpartyId ??
    draft?.counterpartyId ??
    null;
  const activeName =
    browseConv?.counterparty_name ?? selectedMeta?.name ?? draft?.name ?? null;
  const activeAvatar =
    browseConv?.counterparty_avatar_url ?? selectedMeta?.avatar ?? null;
  const activeArchived = browseConv?.archived ?? selectedMeta?.archived ?? false;
  // Karşı tarafın türü: sohbet kaydından, yoksa meta/draft'tan, yoksa rolüme göre
  // varsayılan (CLIENT→TUTOR, TUTOR→CLIENT). Kütüphane operatörü için zorunlu gelir.
  const activeCounterpartyRole: string | null =
    browseConv?.counterparty_role ??
    selectedMeta?.counterpartyRole ??
    draft?.counterpartyRole ??
    (role === "CLIENT" ? "TUTOR" : role === "TUTOR" ? "CLIENT" : null);

  // Karşı tarafın profili: kütüphane → kütüphane sayfası; eğitmen → ilan; öğrenci → profil.
  const counterpartyHref =
    activeCounterpartyId == null
      ? null
      : activeCounterpartyRole === "LIBRARY"
        ? ROUTES.library(activeCounterpartyId)
        : activeCounterpartyRole === "TUTOR"
          ? ROUTES.tutor(activeCounterpartyId)
          : activeCounterpartyRole === "CLIENT"
            ? ROUTES.studentProfile(activeCounterpartyId)
            : null;

  const { data: messages, isLoading: messagesLoading } = useMessages(selectedId);
  const send = useSendMessage();
  const markRead = useMarkConversationRead();
  const reaction = useToggleReaction(selectedId);
  const archive = useArchiveConversation();
  const [text, setText] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  // En-alta kaydırmanın hangi sohbet/uzunlukta yapıldığını izler; böylece bir
  // arama hedefine atlama "en alta in" ile çakışmaz ve her poll'da zıplamayız.
  const bottomStateRef = useRef<{ conv: number | null; count: number }>({
    conv: null,
    count: 0,
  });

  // (1) Atlama: aramadan gelen hedef mesaj yüklenince o satıra kaydır + vurgula
  // (tek seferlik). Hedef yüklü pencerede yoksa en alta in. "En alta" effect'iyle
  // çakışmamak için, atladığımız sohbeti bottomStateRef'e işaretleriz.
  useEffect(() => {
    if (pendingScrollMessageId === null || messagesLoading || !messages) return;
    const present = messages.some((m) => m.id === pendingScrollMessageId);
    if (present) {
      const target = pendingScrollMessageId;
      requestAnimationFrame(() => {
        document
          .getElementById(`msg-${target}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      setHighlightedMessageId(target);
    } else {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    bottomStateRef.current = { conv: selectedId, count: messages.length };
    setPendingScrollMessageId(null);
  }, [messages, messagesLoading, selectedId, pendingScrollMessageId]);

  // (2) En alta in: sohbet açıldığında veya yeni mesaj eklendiğinde. Atlama
  // beklerken devre dışı (yukarı kaydırmayı geri almasın).
  useEffect(() => {
    if (pendingScrollMessageId !== null || !messages) return;
    const prev = bottomStateRef.current;
    const convChanged = selectedId !== prev.conv;
    const grew = selectedId === prev.conv && messages.length > prev.count;
    if (convChanged || grew) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    bottomStateRef.current = { conv: selectedId, count: messages.length };
  }, [messages, selectedId, pendingScrollMessageId]);

  // Vurguyu animasyon bitince temizle (aynı mesaja tekrar atlanabilsin).
  useEffect(() => {
    if (highlightedMessageId === null) return;
    const t = setTimeout(() => setHighlightedMessageId(null), 2600);
    return () => clearTimeout(t);
  }, [highlightedMessageId]);

  // Sohbet açılınca VE açıkken yeni mesaj gelince okundu işaretle. Böylece sohbeti
  // görüntülerken yan listedeki ve navbar'daki okunmamış sayısı artmaya devam etmez.
  const lastMessageId =
    messages && messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (selectedId !== null) markRead.mutate(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, lastMessageId]);

  const showChat = selectedId !== null || draft !== null;

  const backToList = () => {
    setSelectedId(null);
    setSelectedMeta(null);
    setDraft(null);
    setReplyTarget(null);
    setPendingScrollMessageId(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || activeCounterpartyId == null) return;
    send.mutate(
      {
        counterpartyId: activeCounterpartyId,
        counterpartyRole: activeCounterpartyRole,
        body,
        replyToId: replyTarget?.id,
      },
      {
        onSuccess: (msg) => {
          setText("");
          setReplyTarget(null);
          setSelectedId(msg.conversation_id);
          setSelectedMeta({
            id: msg.conversation_id,
            counterpartyId: activeCounterpartyId,
            counterpartyRole: activeCounterpartyRole,
            name: activeName,
            avatar: activeAvatar,
            archived: false,
          });
          setDraft(null);
        },
        onError: (err) => {
          // 403'ün gerçek sebebini (telefon doğrulama VEYA rezervasyon kapısı)
          // sunucudan gelen Türkçe detayla göster — hepsini "rezervasyon" sanma.
          const detail =
            err instanceof AxiosError &&
            typeof err.response?.data?.detail === "string"
              ? (err.response.data.detail as string)
              : null;
          toast.error(detail ?? getErrorMessage(err, "Mesaj gönderilemedi."));
        },
      }
    );
  };

  if (role === null) {
    return (
      <DashboardShell title="Mesajlar">
        <div className="mx-auto max-w-md rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Mesajlaşma yalnızca öğrenci ve eğitmenler içindir.
          </p>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Mesajlar" navItems={navItems} flush>
      <div className="mx-auto flex h-full w-full max-w-screen-2xl overflow-hidden bg-white px-4 md:px-8 dark:bg-slate-900">
        {/* ── Sohbet listesi ── */}
        <aside
          aria-label="Konuşma listesi"
          className={`${
            showChat ? "hidden md:flex" : "flex"
          } w-full shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 md:w-[380px] lg:w-[460px]`}
        >
          <div className="space-y-3 border-b border-slate-100 px-5 pb-3 pt-5 dark:border-slate-800">
            {/* Başlık ↔ arama (Airbnb gibi: ikona tıklayınca animasyonla açılır) */}
            {searchOpen ? (
              <div className="animate-searchbar flex items-center gap-2">
                <div className="relative flex-1">
                  <svg
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"
                    />
                  </svg>
                  <input
                    type="search"
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") closeSearch();
                    }}
                    placeholder="Sohbetlerde ara"
                    aria-label="Sohbetlerde ara"
                    className="w-full rounded-full border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500 dark:focus:ring-slate-700"
                  />
                </div>
                <button
                  type="button"
                  onClick={closeSearch}
                  className="shrink-0 rounded-lg px-2 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  İptal et
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  Mesajlar
                </h1>
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  aria-label="Ara"
                  className="rounded-full p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"
                    />
                  </svg>
                </button>
              </div>
            )}
            {/* Filtre çipleri + arşiv ikonu (sağda) */}
            <div className="flex items-center gap-2">
              {([
                { key: "all", label: "Tümü" },
                { key: "unread", label: "Okunmamış" },
              ] as const).map((f) => {
                const activeChip = filter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold transition ${
                      activeChip
                        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    }`}
                  >
                    {f.label}
                    {f.key === "unread" && inboxUnread > 0 && (
                      <span
                        className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                          activeChip
                            ? "bg-white/20 text-current dark:bg-slate-900/15"
                            : "bg-indigo-600 text-white"
                        }`}
                      >
                        {inboxUnread > 9 ? "9+" : inboxUnread}
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setFilter(filter === "archived" ? "all" : "archived")
                }
                aria-pressed={filter === "archived"}
                aria-label={filter === "archived" ? "Arşivden çık" : "Arşiv"}
                title={filter === "archived" ? "Arşivden çık" : "Arşiv"}
                className={`relative ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${
                  filter === "archived"
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
                </svg>
                {archivedUnread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
                    {archivedUnread > 9 ? "9+" : archivedUnread}
                  </span>
                )}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {searching ? (
              searchLoading && !searchResults ? (
                <ListSkeleton />
              ) : !searchResults ||
                (searchResults.chats.length === 0 &&
                  searchResults.messages.length === 0) ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Sonuç bulunamadı
                  </p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                    "{term}" için isim veya mesaj eşleşmedi.
                  </p>
                </div>
              ) : (
                <div className="pb-2">
                  {searchResults.chats.length > 0 && (
                    <>
                      <SectionHeader label="Sohbetler" />
                      <ul className="divide-y divide-slate-50 dark:divide-slate-700/60">
                        {searchResults.chats.map((c) => (
                          <li key={c.id}>
                            <ConversationRow
                              c={c}
                              active={c.id === selectedId}
                              onClick={() =>
                                openConversation({
                                  id: c.id,
                                  counterpartyId: c.counterparty_id ?? null,
                                  counterpartyRole: c.counterparty_role,
                                  name: c.counterparty_name ?? null,
                                  avatar: c.counterparty_avatar_url,
                                  archived: c.archived ?? false,
                                })
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {searchResults.messages.length > 0 && (
                    <>
                      <SectionHeader
                        label="Mesajlar"
                        count={searchResults.messages.length}
                      />
                      <ul className="divide-y divide-slate-50 dark:divide-slate-700/60">
                        {searchResults.messages.map((hit) => (
                          <li key={hit.message_id}>
                            <MessageHitRow
                              hit={hit}
                              term={term}
                              active={hit.conversation_id === selectedId}
                              onClick={() =>
                                openConversation(
                                  {
                                    id: hit.conversation_id,
                                    counterpartyId: hit.counterparty_id ?? null,
                                    counterpartyRole: hit.counterparty_role,
                                    name: hit.counterparty_name ?? null,
                                    avatar: hit.counterparty_avatar_url,
                                    archived: false,
                                  },
                                  hit.message_id
                                )
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )
            ) : isLoading ? (
              <ListSkeleton />
            ) : !conversations || conversations.length === 0 ? (
              filter === "archived" ? (
                <EmptyArchived />
              ) : (
                <EmptyInbox />
              )
            ) : !filteredConversations || filteredConversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Okunmamış mesaj yok
                </p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Tüm sohbetlerin okundu.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50 dark:divide-slate-700/60">
                {filteredConversations.map((c) => (
                  <li key={c.id}>
                    <ConversationRow
                      c={c}
                      active={c.id === selectedId}
                      onClick={() =>
                        openConversation({
                          id: c.id,
                          counterpartyId: c.counterparty_id ?? null,
                          name: c.counterparty_name ?? null,
                          avatar: c.counterparty_avatar_url,
                          archived: c.archived ?? false,
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* ── Sohbet penceresi ── */}
        <section
          className={`${
            showChat ? "flex" : "hidden md:flex"
          } min-w-0 flex-1 flex-col`}
        >
          {!showChat ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500">
                <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                Bir sohbet seç
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Soldaki listeden bir konuşma aç.
              </p>
            </div>
          ) : (
            <>
              {/* Başlık */}
              <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
                <button
                  type="button"
                  onClick={backToList}
                  aria-label="Listeye dön"
                  className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 md:hidden"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                  </svg>
                </button>
                {counterpartyHref ? (
                  <Link
                    to={counterpartyHref}
                    className="-mx-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1 transition hover:bg-slate-100 dark:hover:bg-slate-700/50"
                    title={
                      role === "CLIENT"
                        ? "Eğitmenin ilanını görüntüle"
                        : "Öğrencinin profilini görüntüle"
                    }
                  >
                    <Avatar name={activeName ?? "?"} avatar_url={activeAvatar} size="md" />
                    <span className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900 dark:text-white">
                      {activeName ?? "Kullanıcı"}
                    </span>
                  </Link>
                ) : (
                  <>
                    <Avatar name={activeName ?? "?"} avatar_url={activeAvatar} size="md" />
                    <span className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900 dark:text-white">
                      {activeName ?? "Kullanıcı"}
                    </span>
                  </>
                )}
                {selectedId !== null && (
                  <button
                    type="button"
                    onClick={() =>
                      archive.mutate(
                        { id: selectedId, archived: !activeArchived },
                        {
                          onSuccess: () => {
                            toast.success(
                              activeArchived
                                ? "Sohbet arşivden çıkarıldı."
                                : "Sohbet arşivlendi."
                            );
                            backToList();
                          },
                          onError: (err) =>
                            toast.error(getErrorMessage(err, "İşlem başarısız.")),
                        }
                      )
                    }
                    disabled={archive.isPending}
                    title={activeArchived ? "Arşivden çıkar" : "Arşivle"}
                    aria-label={activeArchived ? "Arşivden çıkar" : "Arşivle"}
                    className="shrink-0 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Mesajlar */}
              <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-5 dark:bg-slate-900/40 sm:px-6">
                <div className="mx-auto w-full max-w-4xl space-y-2.5">
                {selectedId !== null && messagesLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-10 w-2/3 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-700 ${
                          i % 2 ? "ml-auto" : ""
                        }`}
                      />
                    ))}
                  </div>
                ) : !messages || messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Henüz mesaj yok.
                    </p>
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                      İlk mesajı sen yaz.
                    </p>
                  </div>
                ) : (
                  messages.map((m) => (
                    <MessageRow
                      key={m.id}
                      m={m}
                      mine={m.sender_role === role}
                      highlighted={m.id === highlightedMessageId}
                      onReply={() => setReplyTarget(m)}
                      onReact={(emoji) => reaction.mutate({ messageId: m.id, emoji })}
                    />
                  ))
                )}
                {/* Görüldü/Gönderildi — yalnız son mesaj benimse (WhatsApp tarzı) */}
                {messages && messages.length > 0 && role && (() => {
                  const last = messages[messages.length - 1];
                  if (last.sender_role !== role) return null;
                  const readAt = browseConv?.counterparty_last_read_at;
                  const seen =
                    readAt != null &&
                    new Date(last.created_at).getTime() <= new Date(readAt).getTime();
                  return (
                    <p className="px-1 pb-1 text-right text-[11px] font-medium">
                      {seen ? (
                        <span className="text-indigo-500 dark:text-indigo-400">Görüldü</span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">Gönderildi</span>
                      )}
                    </p>
                  );
                })()}
                <div ref={bottomRef} />
                </div>
              </div>

              {/* Yazma alanı */}
              <div className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {replyTarget && (
                <div className="mx-auto flex w-full max-w-4xl items-start gap-2 px-3 pt-3 sm:px-6">
                  <div className="min-w-0 flex-1 rounded-lg border-l-2 border-indigo-500 bg-slate-50 px-3 py-2 dark:bg-slate-800">
                    <p className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-300">
                      {replyTarget.sender_role === role
                        ? "Kendine yanıt"
                        : `${activeName ?? "Kullanıcı"} kişisine yanıt`}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {replyTarget.body}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTarget(null)}
                    aria-label="Yanıtı iptal et"
                    className="mt-1 shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
              <form
                onSubmit={submit}
                className="mx-auto flex w-full max-w-4xl items-end gap-2 p-3 sm:px-6 sm:py-4"
              >
                <textarea
                  rows={1}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit(e);
                    }
                  }}
                  placeholder="Mesaj yaz…"
                  className="min-h-[48px] max-h-40 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
                />
                <button
                  type="submit"
                  disabled={send.isPending || !text.trim()}
                  className="shrink-0 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {send.isPending ? "…" : "Gönder"}
                </button>
              </form>
              </div>
            </>
          )}
        </section>

        {/* Right Context Panel */}
        {(() => {
          if (!messages) return null;
          const lastBookingMsg = [...messages].reverse().find((m) => m.msg_type === "booking_card");
          const activeBookingId = lastBookingMsg?.meta_data?.booking_id;
          if (!activeBookingId) return null;
          return <RightContextPanel bookingId={activeBookingId} />;
        })()}
      </div>
    </DashboardShell>
  );
}

// Tek mesaj satırı: balon (yanıt önizleme dahil) + reaksiyon çipleri + hover'da
// "yanıtla" ve emoji tepki aksiyonları.
function MessageRow({
  m,
  mine,
  highlighted,
  onReply,
  onReact,
}: {
  m: MessageOut;
  mine: boolean;
  highlighted: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const reactions = m.reactions ?? [];

  // ── Sistem mesajları (booking_card vb.) — özel render ──
  if (m.msg_type === "booking_card" && m.meta_data) {
    return (
      <div
        id={`msg-${m.id}`}
        className={`-mx-3 flex scroll-mt-6 justify-center rounded-xl px-3 py-2 ${
          highlighted ? "animate-highlight-row" : ""
        }`}
      >
        <BookingActionCard meta={m.meta_data} />
      </div>
    );
  }

  return (
    <div
      id={`msg-${m.id}`}
      className={`group -mx-3 flex scroll-mt-6 rounded-xl px-3 py-1 ${
        highlighted ? "animate-highlight-row" : ""
      } ${mine ? "justify-end" : "justify-start"}`}
    >
      <div className={`flex max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            mine
              ? "bg-indigo-600 text-white"
              : "bg-white text-slate-700 ring-1 ring-slate-100 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600"
          }`}
        >
          {m.reply_preview && (
            <div
              className={`mb-1.5 rounded-md border-l-2 px-2 py-1 text-xs ${
                mine
                  ? "border-white/60 bg-white/15 text-indigo-50"
                  : "border-indigo-400 bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              <span className="line-clamp-2 whitespace-pre-line">
                {m.reply_preview.body}
              </span>
            </div>
          )}
          <p className="whitespace-pre-line text-[15px] leading-relaxed">{m.body}</p>
          <p
            className={`mt-1 text-[10px] ${
              mine ? "text-indigo-200" : "text-slate-400 dark:text-slate-500"
            }`}
          >
            {formatDateTime(m.created_at)}
          </p>
        </div>

        {reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact(r.emoji)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition ${
                  r.reacted
                    ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300 dark:bg-indigo-500/20 dark:text-indigo-200"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                <span>{r.emoji}</span>
                <span className="font-semibold">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        <div
          className={`relative mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 ${
            mine ? "flex-row-reverse" : ""
          }`}
        >
          <button
            type="button"
            onClick={onReply}
            title="Yanıtla"
            aria-label="Yanıtla"
            className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 6 6v3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            title="Tepki ver"
            aria-label="Tepki ver"
            className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M9 9.75h.008v.008H9V9.75Zm6 0h.008v.008H15V9.75ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </button>
          {pickerOpen && (
            <div className="absolute bottom-full z-10 mb-1 flex gap-0.5 rounded-full bg-white p-1 shadow-lg ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
              {REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onReact(e);
                    setPickerOpen(false);
                  }}
                  className="rounded-full px-1.5 py-0.5 text-base transition hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Liste yükleme iskeleti (gözatma + arama ortak).
function ListSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700"
        />
      ))}
    </div>
  );
}

// Arama sonuçlarındaki bölüm başlığı ("Sohbetler" / "Mesajlar").
function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between px-4 pb-1 pt-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      {count !== undefined && (
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {count} sonuç
        </span>
      )}
    </div>
  );
}

// Sohbet listesi satırı (gözatma + arama "Sohbetler" bölümü ortak).
function ConversationRow({
  c,
  active,
  onClick,
}: {
  c: ConversationOut;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition ${
        active
          ? "bg-indigo-50 dark:bg-slate-700/60"
          : "hover:bg-slate-50 dark:hover:bg-slate-700/40"
      }`}
    >
      <Avatar
        name={c.counterparty_name ?? "?"}
        avatar_url={c.counterparty_avatar_url}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-base font-semibold text-slate-900 dark:text-white">
            {c.counterparty_name ?? "Kullanıcı"}
          </span>
          <span className="shrink-0 text-xs text-slate-400">
            {formatChatTime(c.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-sm text-slate-500 dark:text-slate-400">
            {c.last_message ?? "Yeni sohbet"}
          </p>
          {(c.unread ?? 0) > 0 && (
            <span className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
              {(c.unread ?? 0) > 9 ? "9+" : c.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// Arama "Mesajlar" bölümünde tek eşleşen mesaj satırı (terim vurgulu).
// Tıklanınca sohbet açılır ve bu mesaja kaydırılıp işaretlenir.
function MessageHitRow({
  hit,
  term,
  active,
  onClick,
}: {
  hit: MessageSearchHit;
  term: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3.5 px-4 py-3 text-left transition ${
        active
          ? "bg-indigo-50 dark:bg-slate-700/60"
          : "hover:bg-slate-50 dark:hover:bg-slate-700/40"
      }`}
    >
      <Avatar
        name={hit.counterparty_name ?? "?"}
        avatar_url={hit.counterparty_avatar_url}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
            {hit.counterparty_name ?? "Kullanıcı"}
          </span>
          <span className="shrink-0 text-xs text-slate-400">
            {formatChatTime(hit.created_at)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
          {buildSnippet(hit.body, term).map((seg, i) =>
            seg.match ? (
              <mark
                key={i}
                className="rounded bg-indigo-100 px-0.5 font-medium text-indigo-700 dark:bg-indigo-500/30 dark:text-indigo-200"
              >
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )}
        </p>
      </div>
    </button>
  );
}

// Boş durum: arşiv sekmesi.
function EmptyArchived() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500">
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
        </svg>
      </div>
      <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
        Arşiv boş
      </p>
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
        Arşivlediğin sohbetler burada görünür.
      </p>
    </div>
  );
}

// Boş durum: hiç sohbet yok.
function EmptyInbox() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500">
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
        </svg>
      </div>
      <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
        Henüz mesajın yok
      </p>
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
        Bir profilden "Mesaj Gönder" ile başlat.
      </p>
    </div>
  );
}
