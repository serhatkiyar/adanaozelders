/**
 * Değerlendirme formu — dört puan da zorunlu (23 Eyl 2026).
 *
 * - Genel puan seçilince Netlik / Motivasyon / Hazırlık kendiliğinden dolmaz.
 * - Alt kriterlerde "Temizle" yok: boş bırakılamayan alan temizlenemez.
 * - Eksik puanla gönderim sunucuya gitmez, kısa Türkçe uyarı çıkar.
 * - Eski (legacy) kayıtta boş gelen kriter tamamlanmadan düzenleme gitmez.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewModal } from "@/components/ReviewModal";
import type { ReviewOut } from "@/types";

const olustur = vi.fn();
const guncelle = vi.fn();
const hata = vi.fn();

vi.mock("@/hooks/useReviews", () => ({
  useCreateReview: () => ({ mutate: olustur, isPending: false }),
  useUpdateReview: () => ({ mutate: guncelle, isPending: false }),
}));
// `vi.mock` hoist edilir; DİNAMİK `import()` kullanılmaz (tembelModul nöbetçisi).
vi.mock("@/store/toastStore", () => ({
  toast: { error: (m: string) => hata(m), success: vi.fn() },
}));

const EKSIK = "Değerlendirmeni göndermek için tüm puanları seç.";

function sec(ad: string, yildiz: number) {
  fireEvent.click(screen.getByRole("radio", { name: `${ad}: ${yildiz} yıldız` }));
}

function secili(ad: string): number {
  const grup = screen.getByRole("radiogroup", { name: ad });
  const r = [...grup.querySelectorAll('[role="radio"]')].findIndex(
    (el) => el.getAttribute("aria-checked") === "true"
  );
  return r + 1; // seçim yoksa 0
}

function gonder() {
  fireEvent.click(screen.getByRole("button", { name: /Gönder|Kaydet/ }));
}

beforeEach(() => {
  olustur.mockReset();
  guncelle.mockReset();
  hata.mockReset();
});

describe("ReviewModal — dört zorunlu puan", () => {
  it("genel puan seçilince alt kriterler otomatik dolmaz", () => {
    render(<ReviewModal bookingId={1} onClose={vi.fn()} onReviewed={vi.fn()} />);
    sec("Genel puan", 5);
    expect(secili("Genel puan")).toBe(5);
    for (const ad of ["Netlik", "Motivasyon", "Hazırlık"]) {
      expect(secili(ad)).toBe(0);
    }
  });

  it("Temizle aksiyonu yok", () => {
    render(<ReviewModal bookingId={1} onClose={vi.fn()} onReviewed={vi.fn()} />);
    expect(screen.queryByText("Temizle")).toBeNull();
    expect(screen.queryByRole("button", { name: /temizle/i })).toBeNull();
  });

  it.each(["Genel puan", "Netlik", "Motivasyon", "Hazırlık"])(
    "%s eksikken gönderilmez",
    (eksik) => {
      render(<ReviewModal bookingId={1} onClose={vi.fn()} onReviewed={vi.fn()} />);
      for (const ad of ["Genel puan", "Netlik", "Motivasyon", "Hazırlık"]) {
        if (ad !== eksik) sec(ad, 4);
      }
      gonder();
      expect(olustur).not.toHaveBeenCalled();
      expect(hata).toHaveBeenCalledWith(EKSIK);
    }
  );

  it("dört puan seçilince bağımsız değerlerle gönderilir", () => {
    render(<ReviewModal bookingId={7} onClose={vi.fn()} onReviewed={vi.fn()} />);
    sec("Genel puan", 5);
    sec("Netlik", 2);
    sec("Motivasyon", 3);
    sec("Hazırlık", 4);
    gonder();
    expect(hata).not.toHaveBeenCalled();
    expect(olustur).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 7,
        rating: 5,
        clarity_rating: 2,
        motivation_rating: 3,
        preparation_rating: 4,
      }),
      expect.anything()
    );
  });

  const legacy: ReviewOut = {
    id: 9,
    booking_id: 7,
    client_id: 3,
    tutor_id: 4,
    rating: 5,
    clarity_rating: null,
    motivation_rating: null,
    preparation_rating: null,
    comment_text: "Eski yorum",
    is_anonymous: false,
    created_at: "2026-05-29T00:00:00Z",
  };

  it("düzenlemede mevcut puanlar dolu gelir", () => {
    render(
      <ReviewModal
        bookingId={7}
        existing={{ ...legacy, clarity_rating: 4, motivation_rating: 3, preparation_rating: 2 }}
        onClose={vi.fn()}
        onReviewed={vi.fn()}
      />
    );
    expect([secili("Genel puan"), secili("Netlik"), secili("Motivasyon"), secili("Hazırlık")])
      .toEqual([5, 4, 3, 2]);
  });

  it("eski kayıtta boş kriterler tamamlanmadan düzenleme gitmez", () => {
    render(
      <ReviewModal bookingId={7} existing={legacy} onClose={vi.fn()} onReviewed={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("checkbox"));
    gonder();
    expect(guncelle).not.toHaveBeenCalled();
    expect(hata).toHaveBeenCalledWith(EKSIK);

    sec("Netlik", 4);
    sec("Motivasyon", 4);
    sec("Hazırlık", 3);
    gonder();
    expect(guncelle).toHaveBeenCalledWith(
      {
        reviewId: 9,
        payload: {
          clarity_rating: 4,
          motivation_rating: 4,
          preparation_rating: 3,
          is_anonymous: true,
        },
      },
      expect.anything()
    );
  });
});
