import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
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
    "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 ";

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
    <Modal
      open
      onClose={onClose}
      ariaLabel="Soru sor"
      hideCloseButton
      panelClassName="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 "
    >
        <h3 className="text-lg font-bold text-slate-900 ">
          Soru Sor
        </h3>
        <p className="mt-1 text-sm text-slate-500 ">
          {tutorName} eğitmenine bu dersle ilgili soru yöneltebilirsin.
          {typeof remaining === "number" && (
            <span className="font-medium text-marka-metin ">
              {" "}
              Kalan hakkın: {remaining}
            </span>
          )}
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <Field label="Konu (opsiyonel)" labelClassName="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400 ">
            {(id) => (
                <input
                    id={id}
                  type="text"
                  maxLength={150}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className={inputCls}
                  placeholder="Örn. Türev konusu"
                />
            )}
          </Field>
          <Field label="Sorun" labelClassName="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400 ">
            {(id) => (
                <textarea
                    id={id}
                  required
                  rows={4}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className={inputCls}
                  placeholder="Sorunu buraya yaz…"
                />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 "
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={ask.isPending}
              className="rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-60"
            >
              {ask.isPending ? "Gönderiliyor…" : "Gönder"}
            </button>
          </div>
        </form>
    </Modal>
  );
}
