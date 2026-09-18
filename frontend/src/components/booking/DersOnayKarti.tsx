import { FormEvent, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  DUGME_SATIR_TEHLIKE,
  ETIKET,
} from "@/components/pano/stil";
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
      panelClassName="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
    >
      <h3 className={BOLUM_BASLIGI}>Sorun bildir</h3>
      <p className={`${ACIKLAMA} mt-2`}>
        Ders ücreti inceleme bitene kadar eğitmene aktarılmaz. Ekibimiz iki tarafla da
        iletişime geçip karar verir.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <fieldset className="space-y-2">
          <legend className="sr-only">Sorun nedeni</legend>
          {SORUN_NEDENLERI.map((n) => (
            <label
              key={n.value}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-base ring-1 transition ${
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
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20"
        />
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className={DUGME_SATIR_IKINCIL}
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={report.isPending}
            className={DUGME_SATIR_TEHLIKE}
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
      <div className={`${ACIKLAMA} rounded-lg bg-slate-50 px-4 py-3`}>
        Dersi onayladın. Teşekkürler!
      </div>
    );
  }
  if (durum === "sorun_bildirildi") {
    return (
      <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-base leading-6 text-amber-800">
        <p className="font-semibold">Sorun bildirdin: {sorunNedeniEtiketi(booking.issue_reason)}</p>
        <p className="mt-1 text-sm leading-5">
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
      className="rounded-lg border border-marka/20 bg-marka-soft p-4"
    >
      <p className={ETIKET}>Dersin gerçekleşti mi?</p>
      <p className={`${ACIKLAMA} mt-1`}>
        Onayladığında ücret eğitmenine aktarılır. Bir sorun olduysa
        {booking.issue_report_deadline
          ? ` ${formatDateTime(booking.issue_report_deadline)} tarihine kadar`
          : " 72 saat içinde"}{" "}
        bildirebilirsin; bildirim yapılmazsa ders onaylanmış sayılır.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={confirm.isPending}
          onClick={onayla}
          className={DUGME_SATIR_BIRINCIL}
        >
          {confirm.isPending ? "Onaylanıyor…" : "Ders gerçekleşti"}
        </button>
        <button
          type="button"
          onClick={() => setSorunAcik(true)}
          className={DUGME_SATIR_IKINCIL}
        >
          Sorun bildir
        </button>
      </div>
      {sorunAcik && <SorunBildirModal booking={booking} onClose={() => setSorunAcik(false)} />}
    </section>
  );
}
