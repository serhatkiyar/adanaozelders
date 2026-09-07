import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
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
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 ";

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
    <Modal open onClose={onClose} title="Şikayet et" description={targetLabel}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Neden">
            {(id) => (
              <select
                id={id}
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
            )}
          </Field>

          <Field label="Açıklama (opsiyonel)">
            {(id) => (
              <textarea
                id={id}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Ne olduğunu kısaca anlat…"
                className={inputCls}
              />
            )}
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 "
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
    </Modal>
  );
}
