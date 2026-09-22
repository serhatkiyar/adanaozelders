import { FormEvent, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { AxiosError } from "axios";
import { useRescheduleBooking } from "@/hooks/useBookings";
import { istanbulNow, localInputToIso } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

const TIME_SLOTS = [
  "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00",
  "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00",
];
const DURATIONS = [
  { label: "30 dk", value: 30 },
  { label: "1 saat", value: 60 },
  { label: "1.5 saat", value: 90 },
  { label: "2 saat", value: 120 },
];

interface RescheduleModalProps {
  bookingId: number;
  onClose: () => void;
}

const fieldCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 ";

export function RescheduleModal({ bookingId, onClose }: RescheduleModalProps) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60);
  const reschedule = useRescheduleBooking();
  // Talep penceresi İstanbul tarihiyle bugün dahil 14 gün (sunucu yine denetler).
  const todayStr = istanbulNow().dateStr;
  const maxDateStr = new Date(Date.parse(`${todayStr}T00:00:00Z`) + 13 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!date || !time) {
      toast.error("Tarih ve saat seç.");
      return;
    }
    const startLocal = `${date}T${time}`;
    const end = new Date(new Date(startLocal).getTime() + duration * 60_000);
    reschedule.mutate(
      {
        id: bookingId,
        startAt: localInputToIso(startLocal),
        endAt: end.toISOString(),
      },
      {
        onSuccess: () => {
          toast.success("Ders talebi yeni saate taşındı; öğretmen onayı bekliyor.");
          onClose();
        },
        onError: (err) => {
          if (err instanceof AxiosError && err.response?.status === 409) {
            toast.error("Bu saat dolu, başka bir zaman seç.");
            return;
          }
          if (err instanceof AxiosError && err.response?.status === 422) {
            // Kural 422'lerinin Türkçe metni gösterilir; pydantic listesi yedek metne düşer.
            const detail = err.response.data?.detail;
            toast.error(
              typeof detail === "string" && detail.trim()
                ? detail
                : "Seçtiğin saat öğretmenin müsaitliği dışında."
            );
            return;
          }
          toast.error(getErrorMessage(err, "Ertelenemedi."));
        },
      }
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Ders talebini ertele"
      hideCloseButton
      panelClassName="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 "
    >
        <h3 className="text-lg font-bold text-slate-900 ">
          Ders Talebini Ertele
        </h3>
        <p className="mt-1 text-sm text-slate-500 ">
          Yeni saat öğretmenin onayına sunulur.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            type="date"
            min={todayStr}
            max={maxDateStr}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={fieldCls}
          />
          <div className="flex gap-2">
            <select
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={fieldCls}
            >
              <option value="">Saat seç</option>
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className={fieldCls}
            >
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 "
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={reschedule.isPending}
              className="rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-60"
            >
              {reschedule.isPending ? "Taşınıyor…" : "Ertele"}
            </button>
          </div>
        </form>
    </Modal>
  );
}
