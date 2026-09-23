import { FormEvent, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { OnayKutusu } from "@/components/form/alanlar";
import { AxiosError } from "axios";
import { useCreateReview, useUpdateReview } from "@/hooks/useReviews";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { ReviewOut, ReviewUpdate } from "@/types";

const YORUM_MAKS = 2000;

interface ReviewModalProps {
  bookingId: number;
  /** Verilirse düzenleme modu: öğrencinin bu öğretmene yazdığı tek kayıt. */
  existing?: ReviewOut;
  onClose: () => void;
  onReviewed: (bookingId: number) => void;
}

/** Alt kriterler isteğe bağlı; genel puandan otomatik doldurulmaz. */
const ALT_KRITERLER = [
  { alan: "clarity_rating", ad: "Netlik" },
  { alan: "motivation_rating", ad: "Motivasyon" },
  { alan: "preparation_rating", ad: "Hazırlık" },
] as const;

type AltKriter = (typeof ALT_KRITERLER)[number]["alan"];

export function ReviewModal({
  bookingId,
  existing,
  onClose,
  onReviewed,
}: ReviewModalProps) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [alt, setAlt] = useState<Record<AltKriter, number | null>>({
    clarity_rating: existing?.clarity_rating ?? null,
    motivation_rating: existing?.motivation_rating ?? null,
    preparation_rating: existing?.preparation_rating ?? null,
  });
  const [comment, setComment] = useState(existing?.comment_text ?? "");
  const [anonim, setAnonim] = useState(existing?.is_anonymous ?? false);
  const createReview = useCreateReview();
  const updateReview = useUpdateReview();
  const bekliyor = createReview.isPending || updateReview.isPending;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (rating < 1) {
      toast.error("Lütfen genel puanı seç.");
      return;
    }
    const icerik = {
      rating,
      ...alt,
      comment_text: comment.trim() || null,
      is_anonymous: anonim,
    };
    if (existing) {
      // Yalnız gerçekten değişen alanlar gider: sunucu "Düzenlendi"yi içerik
      // değişikliğine bağlar, aynı metni yeniden göndermek (maskeleme/boşluk
      // farkı) tek başına anonimlik değişikliğini düzenleme gibi gösterirdi.
      const payload: ReviewUpdate = {};
      if (icerik.rating !== existing.rating) payload.rating = icerik.rating;
      for (const { alan } of ALT_KRITERLER) {
        if (icerik[alan] !== (existing[alan] ?? null)) payload[alan] = icerik[alan];
      }
      if (icerik.comment_text !== (existing.comment_text?.trim() || null)) {
        payload.comment_text = icerik.comment_text;
      }
      if (icerik.is_anonymous !== existing.is_anonymous) {
        payload.is_anonymous = icerik.is_anonymous;
      }
      if (Object.keys(payload).length === 0) {
        onClose();
        return;
      }
      updateReview.mutate(
        { reviewId: existing.id, payload },
        {
          onSuccess: () => {
            toast.success("Değerlendirmen güncellendi.");
            onClose();
          },
          onError: (err) =>
            toast.error(getErrorMessage(err, "Değerlendirme güncellenemedi.")),
        }
      );
      return;
    }
    createReview.mutate(
      { booking_id: bookingId, ...icerik },
      {
        onSuccess: () => {
          toast.success("Değerlendirmen kaydedildi.");
          onReviewed(bookingId);
          onClose();
        },
        onError: (err) => {
          /* 409'un birden çok gerekçesi var (öğretmen zaten değerlendirilmiş,
             kartla ödenmemiş); metin sunucudan gelir. Hepsinde pencere
             kapanır: kullanıcı aynı formu tekrar gönderemez. */
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

  const baslik = existing ? "Değerlendirmeni düzenle" : "Değerlendir";

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={baslik}
      hideCloseButton
      panelClassName="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 "
    >
        <h3 className="text-lg font-bold text-slate-900 ">{baslik}</h3>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Genel puan <span className="text-rose-600">*</span>
            </p>
            <YildizSecici
              ad="Genel puan"
              deger={rating}
              onChange={setRating}
              boyut="h-8 w-8"
            />
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">
              İsteğe bağlı: öğretmeni ayrıntılı puanla.
            </p>
            {ALT_KRITERLER.map(({ alan, ad }) => (
              <div key={alan} className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700">{ad}</span>
                <div className="flex items-center gap-2">
                  <YildizSecici
                    ad={ad}
                    deger={alt[alan] ?? 0}
                    onChange={(v) => setAlt((o) => ({ ...o, [alan]: v }))}
                    boyut="h-6 w-6"
                  />
                  <button
                    type="button"
                    onClick={() => setAlt((o) => ({ ...o, [alan]: null }))}
                    disabled={alt[alan] == null}
                    aria-label={`${ad} puanını temizle`}
                    className="w-14 text-right text-xs font-medium text-slate-500 transition hover:text-slate-800 disabled:invisible"
                  >
                    Temizle
                  </button>
                </div>
              </div>
            ))}
          </div>

          <Field label="Yorum (opsiyonel)">
            {(id) => (
                <textarea
                    id={id}
                  rows={4}
                  maxLength={YORUM_MAKS}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
                  placeholder="Deneyimini paylaş..."
                />
            )}
          </Field>

          <OnayKutusu ad="is_anonymous" isaretli={anonim} onChange={setAnonim}>
            <span className="font-medium text-slate-800">Anonim paylaş</span>
            <span className="block text-xs text-slate-500">
              Adın ve fotoğrafın gösterilmez; “Anonim Öğrenci” olarak görünür.
            </span>
          </OnayKutusu>

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
              disabled={bekliyor}
              className="rounded-lg bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-60"
            >
              {bekliyor ? "Kaydediliyor..." : existing ? "Kaydet" : "Gönder"}
            </button>
          </div>
        </form>
    </Modal>
  );
}

/** 1–5 yıldız girişi (üzerine gelince önizler). */
function YildizSecici({
  ad,
  deger,
  onChange,
  boyut,
}: {
  ad: string;
  deger: number;
  onChange: (v: number) => void;
  boyut: string;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div
      className="flex items-center gap-1"
      role="radiogroup"
      aria-label={ad}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const active = (hover || deger) >= i;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={deger === i}
            onMouseEnter={() => setHover(i)}
            onClick={() => onChange(i)}
            aria-label={`${ad}: ${i} yıldız`}
            className="p-0.5"
          >
            <svg
              viewBox="0 0 20 20"
              className={`${boyut} transition ${active ? "text-amber-400" : "text-slate-300 "}`}
              fill="currentColor"
            >
              <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
