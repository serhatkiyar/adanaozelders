// Kütüphane rezervasyonu iptal onayı.
//
// `window.confirm` yerine geçer (eski `Tickets.tsx:537-548` ve `:692-703`).
// Tarayıcı diyaloğu iOS'ta sayfayı dondurur, tasarım diline uymaz ve iade
// kuralını anlatacak yeri yoktur — oysa iptal geri alınamaz bir karardır ve
// para sonucu doğurur.
//
// İptal politikası BURADA, aksiyonun tam yanında yazar (Resy deseni: "Change"
// akışının ilk ekranı politikayı gösterir). Politikayı ince yazıya gömmek
// bilinen bir booking UX hatasıdır.
import { Modal } from "@/components/ui/Modal";

export function ReservationCancelDialog({
  open,
  onClose,
  onConfirm,
  isPending = false,
  tamIade,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending?: boolean;
  /** Şimdi iptal edilirse tam iade alınır mı (24 saat kuralı). */
  tamIade: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Rezervasyonu iptal et" maxWidth="max-w-sm">
      <p className="text-sm text-slate-600">
        {tamIade
          ? "Rezervasyonun iptal edilecek ve ödemen tamamen iade edilecek."
          : "Başlangıca 24 saatten az kaldı: iptal edebilirsin ama ödemen iade edilmez."}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
        >
          Vazgeç
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
        >
          {isPending ? "İptal ediliyor…" : "İptal et"}
        </button>
      </div>
    </Modal>
  );
}
