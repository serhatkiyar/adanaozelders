import { FormEvent, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useConfirmBooking, useReportBookingIssue } from "@/hooks/useBookings";
import { formatDateTime } from "@/lib/datetime";
import { onayDurumu, SORUN_NEDENLERI, sorunNedeniEtiketi } from "@/lib/dersOnayi";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { BookingIssueReason, BookingOut } from "@/types";

/** Panodaki onay kartı da açar (`components/pano/SiradakiEylemKarti.tsx`). */
export function SorunBildirModal({ booking, onClose }: { booking: BookingOut; onClose: () => void }) {
  const [reason, setReason] = useState<BookingIssueReason | null>(null);
  const [note, setNote] = useState("");
  const report = useReportBookingIssue();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason) {
      toast.error("Lütfen bir neden seç.");
      return;
    }
    report.mutate(
      { id: booking.id, reason, note },
      {
        onSuccess: () => {
          toast.success("Sorun bildirildi. Ekibimiz inceleyecek.");
          onClose();
        },
        onError: (err) => toast.error(getErrorMessage(err, "Sorun bildirilemedi.")),
      }
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Ders için sorun bildir"
      hideCloseButton
      panelClassName="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200"
    >
      <h3 className="text-lg font-bold text-slate-900">Sorun bildir</h3>
      <p className="mt-1 text-sm text-slate-500">
        Ders ücreti inceleme bitene kadar eğitmene aktarılmaz. Ekibimiz iki tarafla da
        iletişime geçip karar verir.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <fieldset className="space-y-2">
          <legend className="sr-only">Sorun nedeni</legend>
          {SORUN_NEDENLERI.map((n) => (
            <label
              key={n.value}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm ring-1 transition ${
                reason === n.value
                  ? "bg-marka-soft text-marka-soft-fg ring-marka/40"
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="sorun-nedeni"
                value={n.value}
                checked={reason === n.value}
                onChange={() => setReason(n.value)}
                className="accent-marka"
              />
              {n.label}
            </label>
          ))}
        </fieldset>
        <textarea
          rows={3}
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ne olduğunu kısaca anlat (isteğe bağlı)"
          aria-label="Açıklama"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={report.isPending}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {report.isPending ? "Gönderiliyor…" : "Sorunu bildir"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Öğrencinin ders sonrası kartı: "Ders gerçekleşti" ücreti eğitmene geçirir,
 * "Sorun bildir" ücreti inceleme bitene kadar bekletir. Bildirim gelmezse
 * ders 72 saat sonra onaylanmış sayılır (kural sunucuda).
 */
export function DersOnayKarti({ booking }: { booking: BookingOut }) {
  const [sorunAcik, setSorunAcik] = useState(false);
  const confirm = useConfirmBooking();
  const durum = onayDurumu(booking);

  if (durum === "yok") return null;

  if (durum === "onaylandi") {
    return (
      <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Dersi onayladın. Teşekkürler!
      </div>
    );
  }
  if (durum === "sorun_bildirildi") {
    return (
      <div role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
        <p className="font-semibold">Sorun bildirdin: {sorunNedeniEtiketi(booking.issue_reason)}</p>
        <p className="mt-0.5 text-xs">
          Ekibimiz inceliyor. Karar verilene kadar ders ücreti eğitmene aktarılmaz.
        </p>
      </div>
    );
  }
  if (durum === "sure_doldu") return null;

  const onayla = () =>
    confirm.mutate(booking.id, {
      onSuccess: () => toast.success("Dersi onayladın."),
      onError: (err) => toast.error(getErrorMessage(err, "Ders onaylanamadı.")),
    });

  return (
    <section
      aria-label="Ders onayı"
      className="rounded-2xl bg-marka-soft px-5 py-4 ring-1 ring-marka/20"
    >
      <p className="text-sm font-semibold text-marka-soft-fg">Dersin gerçekleşti mi?</p>
      <p className="mt-0.5 text-xs leading-relaxed text-marka-metin-hover">
        Onayladığında ücret eğitmenine aktarılır. Bir sorun olduysa
        {booking.issue_report_deadline
          ? ` ${formatDateTime(booking.issue_report_deadline)} tarihine kadar`
          : " 72 saat içinde"}{" "}
        bildirebilirsin; bildirim yapılmazsa ders onaylanmış sayılır.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={confirm.isPending}
          onClick={onayla}
          className="rounded-xl bg-marka px-4 py-2.5 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-60"
        >
          {confirm.isPending ? "Onaylanıyor…" : "Ders gerçekleşti"}
        </button>
        <button
          type="button"
          onClick={() => setSorunAcik(true)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Sorun bildir
        </button>
      </div>
      {sorunAcik && <SorunBildirModal booking={booking} onClose={() => setSorunAcik(false)} />}
    </section>
  );
}
