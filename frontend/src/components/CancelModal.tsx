import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useCancelBooking } from "@/hooks/useBookings";
import { iptalKurali } from "@/lib/dersOnayi";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { BookingOut } from "@/types";

interface CancelModalProps {
  bookingId: number;
  counterpartName?: string;
  onClose: () => void;
  /**
   * Verilirse iptal kuralı (12 saat) pencerede açıkça yazılır. Kuralın kendisi
   * sunucudadır; burası yalnız kullanıcıyı önceden bilgilendirir.
   */
  booking?: BookingOut;
  rol?: "TUTOR" | "CLIENT";
  /** Öğrenci için "bunun yerine ertele" kısayolu (12 saatten fazla varken). */
  onReschedule?: () => void;
}

export function CancelModal({
  bookingId,
  counterpartName,
  onClose,
  booking,
  rol,
  onReschedule,
}: CancelModalProps) {
  const [reason, setReason] = useState("");
  // Doğrulama ve sunucu hatası pencerede, alanın altında kalır: yalnız toast
  // 4,5 sn sonra kayboluyor ve `aria-modal` pencerenin dışında kalıyordu.
  const [hata, setHata] = useState<string | null>(null);
  const cancel = useCancelBooking();
  const kural = booking && rol ? iptalKurali(booking, rol) : null;
  const odendi = booking?.payment?.status === "HELD";
  const kabulEdilmis = booking?.status === "ACCEPTED";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (cancel.isPending) return;
    if (reason.trim().length < 3) {
      setHata("Lütfen kısa bir iptal nedeni yaz (en az 3 karakter).");
      return;
    }
    setHata(null);
    cancel.mutate(
      { id: bookingId, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success("Ders talebi iptal edildi.");
          onClose();
        },
        onError: (err) => setHata(getErrorMessage(err, "İptal edilemedi.")),
      }
    );
  };

  if (kural === "egitmen_gec") {
    return (
      <Modal
        open
        onClose={onClose}
        ariaLabel="Ders iptal edilemiyor"
        hideCloseButton
        panelClassName="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200"
      >
        <h3 className="text-lg font-bold text-slate-900">Bu ders artık iptal edilemez</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Derse 12 saatten az kaldı. Öğrencinle konuşup çözüm bul; ders
          yapılamayacaksa destek ekibine yaz.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
          >
            Tamam
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Ders talebini iptal et"
      hideCloseButton
      panelClassName="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 "
    >
        <h3 className="text-lg font-bold text-slate-900 ">
          {kabulEdilmis ? "Dersi İptal Et" : "Ders Talebini İptal Et"}
        </h3>
        <p className="mt-1 text-sm text-slate-500 ">
          {counterpartName
            ? `${counterpartName} bilgilendirilecek.`
            : "Karşı taraf bilgilendirilecek."}{" "}
          İptal nedenini kısaca yaz.
        </p>

        {kural === "ogrenci_gec" && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200"
          >
            Derse 12 saatten az kaldı.{" "}
            {odendi
              ? "Şimdi iptal edersen ödediğin ücret iade edilmez, öğretmene aktarılır."
              : "Bu saatten sonra ders ertelenemez."}
          </p>
        )}
        {/* Öğretmen iptalinde öğrencinin metni ("ödediğin tutar") yanlış kişiye
            konuşuyordu; öğretmen kendi cümlesini görür. */}
        {kural === "ucretsiz" && kabulEdilmis && odendi && rol === "TUTOR" && (
          <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Derse 12 saatten fazla var; öğrencinin ödediği tutar kendisine iade edilir.
          </p>
        )}
        {kural === "ucretsiz" && kabulEdilmis && odendi && rol !== "TUTOR" && (
          <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Derse 12 saatten fazla var; iptal ücretsizdir ve ödediğin tutar iade edilir.
            {onReschedule && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onReschedule();
                  }}
                  className="font-semibold text-marka-metin underline-offset-2 hover:underline"
                >
                  Bunun yerine ertele
                </button>
              </>
            )}
          </p>
        )}

        <form onSubmit={submit} className="mt-4 space-y-4">
          <Field label="İptal nedeni" error={hata ?? undefined} labelClassName="sr-only">
            {(id, describedBy) => (
              <textarea
                id={id}
                rows={3}
                autoFocus
                value={reason}
                maxLength={500}
                aria-invalid={hata ? true : undefined}
                aria-describedby={describedBy}
                onChange={(e) => setReason(e.target.value)}
                placeholder="ör. Programımda değişiklik oldu…"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 "
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={cancel.isPending}
              className="min-h-[44px] rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {cancel.isPending ? "İptal ediliyor…" : "İptal Et"}
            </button>
          </div>
        </form>
    </Modal>
  );
}
