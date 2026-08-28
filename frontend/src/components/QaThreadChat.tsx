import { FormEvent, useState } from "react";
import { usePostQaMessage } from "@/hooks/useQa";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { formatDateTime } from "@/lib/datetime";
import type { QAMessageOut, QAThreadOut } from "@/types";

interface QaThreadChatProps {
  thread: QAThreadOut;
  role: "CLIENT" | "TUTOR";
  canReply: boolean;
}

export function QaThreadChat({ thread, role, canReply }: QaThreadChatProps) {
  const post = usePostQaMessage();
  const [text, setText] = useState("");

  // Migration öncesi açılmış thread'lerde messages boş olabilir → question/answer'dan türet.
  const messages: QAMessageOut[] =
    thread.messages && thread.messages.length > 0
      ? thread.messages
      : [
          {
            id: -1,
            sender_role: "CLIENT",
            body: thread.question,
            created_at: thread.created_at,
          },
          ...(thread.answer
            ? [
                {
                  id: -2,
                  sender_role: "TUTOR" as const,
                  body: thread.answer,
                  created_at: thread.answered_at ?? thread.created_at,
                },
              ]
            : []),
        ];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      toast.error("Lütfen bir mesaj yaz.");
      return;
    }
    post.mutate(
      { threadId: thread.id, body: text.trim() },
      {
        onSuccess: () => setText(""),
        onError: (err) =>
          toast.error(getErrorMessage(err, "Mesaj gönderilemedi.")),
      }
    );
  };

  return (
    <div className="space-y-2">
      {messages.map((m) => {
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
                  : "bg-slate-100 text-slate-700 "
              }`}
            >
              <p className="whitespace-pre-line text-sm leading-relaxed">
                {m.body}
              </p>
              <p
                className={`mt-1 text-[10px] ${
                  mine
                    ? "text-indigo-200"
                    : "text-slate-400 "
                }`}
              >
                {formatDateTime(m.created_at)}
              </p>
            </div>
          </div>
        );
      })}

      {canReply && (
        <form onSubmit={submit} className="flex items-end gap-2 pt-1">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Mesaj yaz…"
            className="min-h-[42px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
          />
          <button
            type="submit"
            disabled={post.isPending}
            className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-95 disabled:opacity-60"
          >
            {post.isPending ? "…" : "Gönder"}
          </button>
        </form>
      )}
    </div>
  );
}
