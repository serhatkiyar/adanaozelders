/**
 * Liste satırının ikinci satırı — tür etiketi ne zaman yazılır?
 *
 * Gerçek Chrome turunda yakalanan kusur: satır "Çalışma alanı" başlığının
 * altına bir daha "Çalışma alanı · Yaşam Kütüphanesi" yazıyordu; derste de
 * "Ders" / "Ders · Eda Yılmaz". Tür etiketi yalnız BAŞLIK BAŞKA BİR ŞEYSE
 * bilgi taşır (deneme sınavında başlık sınavın adıdır).
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ReservationRow } from "./ReservationRow";
import type { ReservationItem } from "@/lib/reservationModel";

function item(over: Partial<ReservationItem> = {}): ReservationItem {
  return {
    id: 1,
    tur: "calisma",
    baslik: "Çalışma alanı",
    altBaslik: "Yaşam Kütüphanesi",
    baslangic: "2026-09-04T09:00:00+03:00",
    bitis: "2026-09-04T13:00:00+03:00",
    durum: "ONAYLANDI",
    tutar: "80.00",
    girisKodu: null,
    girisZamani: null,
    tamIade: true,
    ...over,
  } as ReservationItem;
}

function sar(i: ReservationItem) {
  return render(
    <MemoryRouter>
      <ReservationRow item={i} to="/x" />
    </MemoryRouter>,
  );
}

describe("satır tür etiketi", () => {
  it("başlık tür adının KENDİSİYSE ikinci satırda tekrarlanmaz", () => {
    const { container } = sar(item());
    const metin = container.textContent ?? "";
    expect(metin.match(/Çalışma alanı/g)?.length).toBe(1);
    expect(screen.getByText("Yaşam Kütüphanesi")).toBeTruthy();
  });

  it("derste de tekrarlanmaz — alt satırda yalnız eğitmen kalır", () => {
    const { container } = sar(item({ tur: "ders", baslik: "Ders", altBaslik: "Eda Yılmaz" }));
    const metin = container.textContent ?? "";
    expect(metin.match(/Ders/g)?.length).toBe(1);
    expect(screen.getByText("Eda Yılmaz")).toBeTruthy();
  });

  it("denemede başlık sınavın adıdır, tür etiketi BİLGİ taşır ve kalır", () => {
    sar(
      item({
        tur: "deneme",
        baslik: "TYT Genel Deneme",
        altBaslik: "Merkez Kütüphane",
      }),
    );
    expect(screen.getByText("TYT Genel Deneme")).toBeTruthy();
    expect(screen.getByText(/Deneme sınavı · Merkez Kütüphane/)).toBeTruthy();
  });
});
