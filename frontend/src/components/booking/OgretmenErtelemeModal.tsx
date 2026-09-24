import { FormEvent, useState } from "react";
import { AxiosError } from "axios";

import { ACIKLAMA, DUGME_BIRINCIL, DUGME_IKINCIL, ETIKET } from "@/components/pano/stil";
import { Modal } from "@/components/ui/Modal";
import { useTutorReschedule } from "@/hooks/useBookings";
import { formatRange, istanbulNow, localInputToIso } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { BookingOut } from "@/types";

const alanCls =
  "h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka-focus";

const SAAT = 3_600_000;

/**
 * Öğretmen onaylı dersi başka zamana alır (24 Eyl 2026, Preply deseni). Yalnız
 * yeni başlangıç seçilir: süre ve ücret aynı kalır. Ders hemen taşınır;
 * öğrenciye "yeni saat uygun mu" sorulur, uymazsa ders iptal edilir ve
 * ücret öğrenciye iade edilir. Yakın saatler için uyarı gösterilir.
 */
export function OgretmenErtelemeModal({
  booking,
  onClose,
}: {
  booking: BookingOut;
  onClose: () => void;
}) {
  const [tarih, setTarih] = useState("");
  const [saat, setSaat] = useState("");
  const ertele = useTutorReschedule();
  const bugun = istanbulNow().dateStr;

  const yeniMs = tarih && saat ? new Date(localInputToIso(`${tarih}T${saat}`)).getTime() : null;
  const kalan = (ms: number) => ms - Date.now();
  const eskiYakin = kalan(new Date(booking.start_at).getTime()) < 24 * SAAT;
  const yeniYakin = yeniMs !== null && kalan(yeniMs) < 24 * SAAT;
  const yeniBesGun = yeniMs !== null && !yeniYakin && kalan(yeniMs) < 5 * 24 * SAAT;

  const gonder = (e: FormEvent) => {
    e.preventDefault();
    if (!tarih || !saat) {
      toast.error("Yeni tarih ve saati seç.");
      return;
    }
    ertele.mutate(
      { id: booking.id, startAt: localInputToIso(`${tarih}T${saat}`) },
      {
        onSuccess: () => {
          toast.success("Ders yeni saate alındı; öğrencine uygun olup olmadığı soruldu.");
          onClose();
        },
        onError: (err) => {
          if (err instanceof AxiosError && err.response?.status === 409) {
            const detail = err.response.data?.detail;
            toast.error(typeof detail === "string" ? detail : "Bu saatte başka bir dersin var.");
            return;
          }
          toast.error(getErrorMessage(err, "Ders başka zamana alınamadı."));
        },
      }
    );
  };

  return (
    <Modal open onClose={onClose} title="Dersi başka zamana al" maxWidth="max-w-lg">
      <form onSubmit={gonder} className="mt-5 space-y-5">
        <div className="rounded-lg bg-slate-50 px-4 py-3">
          <p className={ACIKLAMA}>Şu anki saat</p>
          <p className={ETIKET}>{formatRange(booking.start_at, booking.end_at)}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={`mb-1.5 block ${ACIKLAMA}`}>Yeni tarih</span>
            <input
              type="date"
              min={bugun}
              value={tarih}
              onChange={(e) => setTarih(e.target.value)}
              className={alanCls}
            />
          </label>
          <label className="block">
            <span className={`mb-1.5 block ${ACIKLAMA}`}>Başlangıç saati</span>
            <input
              type="time"
              step={900}
              value={saat}
              onChange={(e) => setSaat(e.target.value)}
              className={alanCls}
            />
          </label>
        </div>

        <p className={ACIKLAMA}>
          Dersin süresi ve ücreti değişmez. Yeni saat öğrencine sorulur; uymazsa ders iptal
          edilir ve ücreti iade edilir.
        </p>

        {(eskiYakin || yeniYakin) && (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-base leading-6 text-amber-800">
            Ders saatine 24 saatten az var. Son dakika değişiklikleri öğrencini zor durumda
            bırakabilir; önce ona mesajla sor.
          </p>
        )}
        {yeniBesGun && !eskiYakin && (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-base leading-6 text-slate-700">
            Yeni saate 5 günden az kaldı. Öğrencinin programını ayarlayabilmesi için önceden
            haber vermen iyi olur.
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={DUGME_IKINCIL}>
            Vazgeç
          </button>
          <button type="submit" disabled={ertele.isPending} className={DUGME_BIRINCIL}>
            {ertele.isPending ? "Alınıyor…" : "Yeni saate al"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
