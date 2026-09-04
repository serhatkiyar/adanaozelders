import { describe, expect, it } from "vitest";

import { BookingStatus } from "@/types";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "./bookingStatus";
import {
  RESERVATION_STATUS_LABEL,
  RESERVATION_STATUS_STYLE,
  SOLUK_DURUMLAR,
} from "./reservationStatus";
import type { ReservationStatusKey } from "./reservationModel";

const TUM_DURUMLAR: ReservationStatusKey[] = [
  "BEKLIYOR",
  "ONAYLANDI",
  "GIRIS_YAPILDI",
  "TAMAMLANDI",
  "REDDEDILDI",
  "IPTAL",
  "IADE_EDILIYOR",
  "IADE_EDILDI",
  "SURESI_DOLDU",
];

describe("durum rozeti tek kaynaktır", () => {
  it("her durumun etiketi ve stili vardır", () => {
    for (const d of TUM_DURUMLAR) {
      expect(RESERVATION_STATUS_LABEL[d], d).toBeTruthy();
      expect(RESERVATION_STATUS_STYLE[d], d).toMatch(/bg-\w+/);
    }
  });

  it("eski ders haritası artık BURADAN türer (üç harita çelişkisi bitti)", () => {
    // `bookingStatus.ts` bir shim'dir; çağrı yerleri değişmedi ama değer tek
    // kaynaktan gelir. Renk kayması olursa bu test görür.
    expect(BOOKING_STATUS_LABEL[BookingStatus.ACCEPTED]).toBe(
      RESERVATION_STATUS_LABEL.ONAYLANDI,
    );
    expect(BOOKING_STATUS_STYLE[BookingStatus.COMPLETED]).toBe(
      RESERVATION_STATUS_STYLE.TAMAMLANDI,
    );
    expect(BOOKING_STATUS_STYLE[BookingStatus.PENDING]).toBe(
      RESERVATION_STATUS_STYLE.BEKLIYOR,
    );
  });

  it("ONAYLANDI ve TAMAMLANDI farklı renktedir", () => {
    // `BookingActionCard`'ın eski haritasında bu ikisi TERS eşlenmişti; aynı
    // rezervasyon sohbette ve listede farklı renk görünüyordu.
    expect(RESERVATION_STATUS_STYLE.ONAYLANDI).not.toBe(
      RESERVATION_STATUS_STYLE.TAMAMLANDI,
    );
  });

  it("soluk durumlar yalnız 'artık yaşamayan' kayıtlardır", () => {
    expect([...SOLUK_DURUMLAR].sort()).toEqual(
      ["IADE_EDILDI", "IPTAL", "REDDEDILDI", "SURESI_DOLDU"].sort(),
    );
    expect(SOLUK_DURUMLAR.has("GIRIS_YAPILDI")).toBe(false);
    expect(SOLUK_DURUMLAR.has("ONAYLANDI")).toBe(false);
  });
});
