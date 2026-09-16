import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { AxiosError } from "axios";
import { useCreateReview } from "@/hooks/useReviews";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

interface ReviewModalProps {
  bookingId: number;
  onClose: () => void;
  onReviewed: (bookingId: number) => void;
}

export function ReviewModal({
  bookingId,
  onClose,
  onReviewed,
}: ReviewModalProps) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const createReview = useCreateReview();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (rating < 1) {
      toast.error("Lütfen 1-5 arası puan ver.");
      return;
    }
    createReview.mutate(
      {
        booking_id: bookingId,
        rating,
        comment_text: comment.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("Değerlendirmen kaydedildi.");
          onReviewed(bookingId);
          onClose();
        },
        onError: (err) => {
          /* 409'un birden çok gerekçesi var (zaten değerlendirilmiş, kartla
             ödenmemiş, eğitmene ikinci yorum); metin sunucudan gelir. Hepsinde
             pencere kapanır: kullanıcı aynı formu tekrar gönderemez. */
          if (err instanceof AxiosError && err.response?.status === 409) {
            toast.error(getErrorMessage(err, "Bu ders değerlendirilemiyor."));
            onReviewed(bookingId);
            onClose();
            return;
          }
          toast.error(getErrorMessage(err, "Değerlendirme kaydedilemedi."));
        },
      }
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Değerlendir"
      hideCloseButton
      panelClassName="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 "
    >
        <h3 className="text-lg font-bold text-slate-900 ">Değerlendir</h3>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((i) => {
              const active = (hover || rating) >= i;
              return (
                <button
                  key={i}
                  type="button"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setRating(i)}
                  aria-label={`${i} yıldız`}
                  className="p-0.5"
                >
                  <svg
                    viewBox="0 0 20 20"
                    className={`h-8 w-8 transition ${active ? "text-amber-400" : "text-slate-300 "}`}
                    fill="currentColor"
                  >
                    <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
                  </svg>
                </button>
              );
            })}
          </div>

          <Field label="Yorum (opsiyonel)">
            {(id) => (
                <textarea
                    id={id}
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                  placeholder="Deneyimini paylaş..."
                />
            )}
          </Field>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 "
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={createReview.isPending}
              className="rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-60"
            >
              {createReview.isPending ? "Kaydediliyor..." : "Gönder"}
            </button>
          </div>
        </form>
    </Modal>
  );
}
