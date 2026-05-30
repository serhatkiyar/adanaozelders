import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AxiosError } from "axios";
import { DashboardShell } from "@/components/DashboardShell";
import { Avatar } from "@/components/Avatar";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useConversations,
  useMarkConversationRead,
  useMessages,
  useSendMessage,
} from "@/hooks/useMessages";
import { formatChatTime, formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROLE_IDS } from "@/types";

type Role = "CLIENT" | "TUTOR";

export default function Messages() {
  const { data: user } = useCurrentUser();
  const role: Role | null =
    user?.role_id === ROLE_IDS.CLIENT
      ? "CLIENT"
      : user?.role_id === ROLE_IDS.TUTOR
        ? "TUTOR"
        : null;
  const navItems = role === "TUTOR" ? TUTOR_NAV : STUDENT_NAV;

  const [searchParams, setSearchParams] = useSearchParams();
  const { data: conversations, isLoading } = useConversations();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ counterpartyId: number; name: string } | null>(
    null
  );

  // Profilden "Mesaj Gönder" ile gelindiğinde (?to=&name=) doğru sohbeti seç
  // veya henüz yoksa taslak oluştur. Çözümleyince parametreyi temizle.
  useEffect(() => {
    const toParam = searchParams.get("to");
    if (!toParam || conversations === undefined) return;
    const cpId = Number(toParam);
    const existing = conversations.find((c) => c.counterparty_id === cpId);
    if (existing) {
      setSelectedId(existing.id);
      setDraft(null);
    } else {
      setDraft({ counterpartyId: cpId, name: searchParams.get("name") ?? "Kullanıcı" });
      setSelectedId(null);
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, conversations, setSearchParams]);

  const selectedConv = useMemo(
    () => conversations?.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );
  const activeCounterpartyId =
    selectedConv?.counterparty_id ?? draft?.counterpartyId ?? null;
  const activeName =
    selectedConv?.counterparty_name ?? draft?.name ?? null;

  const { data: messages, isLoading: messagesLoading } = useMessages(selectedId);
  const send = useSendMessage();
  const markRead = useMarkConversationRead();
  const [text, setText] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, selectedId, draft]);

  // Sohbet açılınca okundu işaretle (badge sıfırlanır).
  useEffect(() => {
    if (selectedId !== null) markRead.mutate(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const showChat = selectedId !== null || draft !== null;

  const openConversation = (id: number) => {
    setSelectedId(id);
    setDraft(null);
  };

  const backToList = () => {
    setSelectedId(null);
    setDraft(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || activeCounterpartyId == null) return;
    send.mutate(
      { counterpartyId: activeCounterpartyId, body },
      {
        onSuccess: (msg) => {
          setText("");
          setSelectedId(msg.conversation_id);
          setDraft(null);
        },
        onError: (err) => {
          if (err instanceof AxiosError && err.response?.status === 403) {
            toast.error(
              "Mesajlaşmak için aranızda beklemede veya onaylı bir rezervasyon olmalı."
            );
            return;
          }
          toast.error(getErrorMessage(err, "Mesaj gönderilemedi."));
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
    <DashboardShell title="Mesajlar" navItems={navItems}>
      <div className="mx-auto flex h-[calc(100vh-9rem)] min-h-[26rem] max-w-5xl overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
        {/* ── Sohbet listesi ── */}
        <aside
          className={`${
            showChat ? "hidden md:flex" : "flex"
          } w-full shrink-0 flex-col border-r border-slate-100 dark:border-slate-700 md:w-80`}
        >
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Sohbetler
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700"
                  />
                ))}
              </div>
            ) : !conversations || conversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl dark:bg-slate-700">
                  💬
                </div>
                <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Henüz mesajın yok
                </p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Bir profilden "Mesaj Gönder" ile başlat.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50 dark:divide-slate-700/60">
                {conversations.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openConversation(c.id)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                          active
                            ? "bg-indigo-50 dark:bg-slate-700/60"
                            : "hover:bg-slate-50 dark:hover:bg-slate-700/40"
                        }`}
                      >
                        <Avatar name={c.counterparty_name ?? "?"} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                              {c.counterparty_name ?? "Kullanıcı"}
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {formatChatTime(c.last_message_at)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
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
                    </li>
                  );
                })}
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
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-700">
                ✉️
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
              <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
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
                <Avatar name={activeName ?? "?"} size="sm" />
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {activeName ?? "Kullanıcı"}
                </span>
              </div>

              {/* Mesajlar */}
              <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-4 py-4 dark:bg-slate-900/40">
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
                  messages.map((m) => {
                    const mine = m.sender_role === role;
                    return (
                      <div
                        key={m.id}
                        className={`flex ${mine ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
                            mine
                              ? "bg-indigo-600 text-white"
                              : "bg-white text-slate-700 ring-1 ring-slate-100 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600"
                          }`}
                        >
                          <p className="whitespace-pre-line text-sm leading-relaxed">
                            {m.body}
                          </p>
                          <p
                            className={`mt-1 text-[10px] ${
                              mine
                                ? "text-indigo-200"
                                : "text-slate-400 dark:text-slate-500"
                            }`}
                          >
                            {formatDateTime(m.created_at)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {/* Yazma alanı */}
              <form
                onSubmit={submit}
                className="flex items-end gap-2 border-t border-slate-100 p-3 dark:border-slate-700"
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
                  className="min-h-[42px] max-h-32 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
                />
                <button
                  type="submit"
                  disabled={send.isPending || !text.trim()}
                  className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {send.isPending ? "…" : "Gönder"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
