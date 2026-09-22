import { useState } from "react";

import { useSubmitDeliveryFeedback } from "@/hooks/useDelivery";
import {
  FEEDBACK_PROBLEMS,
  canSubmitFeedback,
} from "@/lib/deliveryFeedback";
import { toast } from "@/store/toastStore";

type DeliveryFeedbackSectionProps = (
  | { mode: "order"; orderId: number }
  | { mode: "token"; token: string }
) & {
  canFeedback: boolean;
  feedbackGiven: boolean;
};

export function DeliveryFeedbackSection(props: DeliveryFeedbackSectionProps) {
  const [thumbsUp, setThumbsUp] = useState<boolean | null>(null);
  const [problemCodes, setProblemCodes] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const target =
    props.mode === "order"
      ? { mode: "order" as const, orderId: props.orderId }
      : { mode: "token" as const, token: props.token };
  const submitFeedback = useSubmitDeliveryFeedback(target);

  if (props.feedbackGiven || submitted) {
    return (
      <div className="border-t border-slate-200 px-6 py-5 text-sm text-slate-500 ">
        Değerlendirmen için teşekkürler.
      </div>
    );
  }

  if (!props.canFeedback) return null;

  const toggleProblem = (code: string) => {
    setProblemCodes((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (thumbsUp == null || !canSubmitFeedback(thumbsUp, problemCodes)) return;

    submitFeedback.mutate(
      {
        thumbs_up: thumbsUp,
        problem_codes: thumbsUp ? [] : problemCodes,
        comment: thumbsUp || !comment.trim() ? null : comment.trim(),
      },
      {
        onSuccess: () => {
          setSubmitted(true);
          toast.success("Değerlendirmen alındı. Teşekkürler.");
        },
        onError: (error: unknown) => {
          const response = (error as {
            response?: { status?: number; data?: { detail?: string } };
          }).response;
          if (response?.status === 409) {
            setSubmitted(true);
            toast.info(response.data?.detail ?? "Bu sipariş zaten değerlendirilmiş.");
            return;
          }
          toast.error(response?.data?.detail ?? "Değerlendirme gönderilemedi.");
        },
      },
    );
  };

  const valid = thumbsUp != null && canSubmitFeedback(thumbsUp, problemCodes);

  return (
    <form
      onSubmit={submit}
      className="border-t border-slate-200 px-6 py-5 text-left "
    >
      <h2 className="text-sm font-semibold text-slate-900 ">
        Teslimatın nasıldı?
      </h2>
      <div className="mt-3 flex gap-2" role="group" aria-label="Teslimat değerlendirmesi">
        {[
          { value: true, label: "İyiydi", emoji: "👍" },
          { value: false, label: "Sorun yaşadım", emoji: "👎" },
        ].map((option) => {
          const selected = thumbsUp === option.value;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setThumbsUp(option.value);
                if (option.value) {
                  setProblemCodes([]);
                  setComment("");
                }
              }}
              className={[
                "rounded-full px-4 py-2 text-sm font-medium ring-1 transition-colors",
                selected
                  ? "bg-marka-soft text-marka-metin-hover ring-marka-focus "
                  : "text-slate-600 ring-slate-200 hover:text-slate-900 ",
              ].join(" ")}
            >
              <span aria-hidden="true">{option.emoji}</span> {option.label}
            </button>
          );
        })}
      </div>

      {thumbsUp === false && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-600 ">
            Hangi sorunları yaşadın?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {FEEDBACK_PROBLEMS.map(({ code, label }) => {
              const selected = problemCodes.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleProblem(code)}
                  className={[
                    "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors",
                    selected
                      ? "bg-marka-soft text-marka-metin-hover ring-2 ring-marka-focus "
                      : "text-slate-600 ring-slate-200 hover:ring-slate-300 ",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <label className="mt-4 block text-xs font-medium text-slate-600 ">
            Eklemek istediğin bir not var mı? <span className="font-normal">(isteğe bağlı)</span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Teslimatla ilgili ayrıntıyı yazabilirsin."
              className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm font-normal text-slate-900 outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
            />
          </label>
          <p className="mt-1 text-right text-xs tabular-nums text-slate-400 ">
            {comment.length}/500
          </p>
        </div>
      )}

      {thumbsUp != null && (
        <button
          type="submit"
          disabled={!valid || submitFeedback.isPending}
          className="mt-4 rounded-full bg-marka px-5 py-2 text-sm font-semibold text-marka-fg transition-colors hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-40 "
        >
          {submitFeedback.isPending ? "Gönderiliyor…" : "Gönder"}
        </button>
      )}
    </form>
  );
}
