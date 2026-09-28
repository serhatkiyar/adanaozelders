import { describe, expect, it } from "vitest";

import { dersOlayi } from "@/components/takvim/dersOlayi";
import { BookingStatus } from "@/types";

const ders = (status: BookingStatus, ek: { is_free_lesson?: boolean; series_id?: number | null } = {}) => ({
  status,
  client_name: "Ayşe",
  is_free_lesson: false,
  series_id: null,
  ...ek,
});

describe("dersOlayi", () => {
  it("bekleyen ücretsiz talep ONAYLI gibi boyanmaz ve durumu metinle söyler", () => {
    // Regresyon: `takvim-deneme` her tamamlanmamış ücretsiz derse veriliyordu.
    const olay = dersOlayi(ders(BookingStatus.PENDING, { is_free_lesson: true }), "Üye");
    expect(olay).toEqual({ sinif: "takvim-bekliyor", baslik: "Onay bekliyor · Ayşe" });
  });

  it("kabul edilmiş ücretsiz ders kendi rengini taşır", () => {
    expect(dersOlayi(ders(BookingStatus.ACCEPTED, { is_free_lesson: true }), "Üye")?.sinif).toBe(
      "takvim-deneme"
    );
  });

  it("haftalık seri ve tamamlanmış ders renkleri korunur; iptal çizilmez", () => {
    expect(dersOlayi(ders(BookingStatus.ACCEPTED, { series_id: 4 }), "Üye")?.sinif).toBe("takvim-haftalik");
    expect(dersOlayi(ders(BookingStatus.COMPLETED, { is_free_lesson: true }), "Üye")?.sinif).toBe(
      "takvim-tamamlandi"
    );
    expect(dersOlayi(ders(BookingStatus.CANCELLED), "Üye")).toBeNull();
  });
});
