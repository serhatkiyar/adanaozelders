import { FormEvent, useState } from "react";
import { AxiosError } from "axios";
import { useAskQuestion } from "@/hooks/useQa";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

interface QuestionModalProps {
  bookingId: number;
  tutorName: string;
  remaining?: number;
  onClose: () => void;
}

export function QuestionModal({
  bookingId,
  tutorName,
  remaining,
  onClose,
}: QuestionModalProps) {
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const ask = useAskQuestion();

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) {
      toast.error("Lütfen sorunu yaz.");
      return;
    }
    ask.mutate(
      {
        booking_id: bookingId,
        subject: subject.trim() || null,
        question: question.trim(),
      },
      {
        onSuccess: () => {
          toast.success("Sorun gönderildi.");
          onClose();
        },
        onError: (err) => {
          if (err instanceof AxiosError && err.response?.status === 403) {
            toast.warning("Bu eğitmene soru sorma süren dolmuş.");
            onClose();
            return;
          }
          toast.error(getErrorMessage(err, "Soru gönderilemedi."));
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
          Soru Sor
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {tutorName} eğitmenine bu dersle ilgili soru yöneltebilirsin.
          {typeof remaining === "number" && (
            <span className="font-medium text-indigo-600 dark:text-indigo-400">
              {" "}
              Kalan hakkın: {remaining}
            </span>
          )}
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Konu (opsiyonel)
            </label>
            <input
              type="text"
              maxLength={150}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={inputCls}
              placeholder="Örn. Türev konusu"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Sorun
            </label>
            <textarea
              required
              rows={4}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className={inputCls}
              placeholder="Sorunu buraya yaz…"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={ask.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {ask.isPending ? "Gönderiliyor…" : "Gönder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
