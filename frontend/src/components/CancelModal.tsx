import { FormEvent, useState } from "react";
import { useCancelBooking } from "@/hooks/useBookings";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

interface CancelModalProps {
  bookingId: number;
  counterpartName?: string;
  onClose: () => void;
}

export function CancelModal({
  bookingId,
  counterpartName,
  onClose,
}: CancelModalProps) {
  const [reason, setReason] = useState("");
  const cancel = useCancelBooking();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      toast.error("Lütfen kısa bir iptal nedeni yaz.");
      return;
    }
    cancel.mutate(
      { id: bookingId, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success("Rezervasyon iptal edildi.");
          onClose();
        },
        onError: (err) => toast.error(getErrorMessage(err, "İptal edilemedi.")),
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
          Rezervasyonu İptal Et
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {counterpartName
            ? `${counterpartName} bilgilendirilecek.`
            : "Karşı taraf bilgilendirilecek."}{" "}
          İptal nedenini kısaca yaz.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <textarea
            rows={3}
            autoFocus
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ör. Programımda değişiklik oldu…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
          />
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
              disabled={cancel.isPending}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {cancel.isPending ? "İptal ediliyor…" : "İptal Et"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
