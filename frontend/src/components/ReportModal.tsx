import { FormEvent, useState } from "react";
import { useCreateReport } from "@/hooks/useReports";
import { ReportReason } from "@/types";
import { toast } from "@/store/toastStore";
import { getErrorMessage } from "@/lib/errors";

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  [ReportReason.SPAM]: "Spam / istenmeyen içerik",
  [ReportReason.HARASSMENT]: "Taciz / hakaret",
  [ReportReason.INAPPROPRIATE]: "Uygunsuz içerik",
  [ReportReason.CONTACT_INFO]: "Platform dışına yönlendirme",
  [ReportReason.SCAM]: "Dolandırıcılık",
  [ReportReason.OTHER]: "Diğer",
};

const inputCls =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white";

export function ReportModal({
  targetType,
  targetId,
  targetLabel,
  onClose,
}: {
  targetType: string;
  targetId: number;
  targetLabel?: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>(ReportReason.INAPPROPRIATE);
  const [description, setDescription] = useState("");
  const mutation = useCreateReport();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate(
      {
        target_type: targetType,
        target_id: targetId,
        reason,
        description: description.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("Şikayetin alındı; ekibimiz inceleyecek.");
          onClose();
        },
        onError: (err) =>
          toast.error(getErrorMessage(err, "Şikayet gönderilemedi.")),
      }
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          Şikayet et
        </h2>
        {targetLabel && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {targetLabel}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Neden
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReason)}
              className={inputCls}
            >
              {Object.values(ReportReason).map((r) => (
                <option key={r} value={r}>
                  {REPORT_REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Açıklama (opsiyonel)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Ne olduğunu kısaca anlat…"
              className={inputCls}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mutation.isPending ? "Gönderiliyor…" : "Şikayet et"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
