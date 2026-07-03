import { describe, expect, it } from "vitest";

import type { DeliveryRun, DeliveryStop } from "@/types";
import { googleNavUrl, nextPendingStop, runProgress } from "./deliveryRun";

function stop(partial: Partial<DeliveryStop>): DeliveryStop {
  return {
    id: 1,
    run_id: 1,
    order_id: 1,
    sequence: 1,
    status: "PENDING",
    qr_payload: "1:tok",
    items: [],
    ...partial,
  };
}

function run(stops: DeliveryStop[]): DeliveryRun {
  return {
    id: 1,
    run_date: "2026-07-03",
    vehicle: "LADA",
    status: "ACTIVE",
    created_at: "2026-07-03T08:00:00Z",
    depot_lat: 36.9855,
    depot_lng: 35.3253,
    stops,
  };
}

describe("googleNavUrl", () => {
  it("pin varsa koordinatla üretir (pin otorite)", () => {
    expect(googleNavUrl(37.01, 35.32, "Adres yazısı")).toBe(
      "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=37.01,35.32"
    );
  });
  it("pin yoksa adresi encode eder", () => {
    expect(googleNavUrl(null, null, "Çakmak Cad. 12, Seyhan")).toContain(
      encodeURIComponent("Çakmak Cad. 12, Seyhan")
    );
  });
  it("ikisi de yoksa null (buton gizlenir)", () => {
    expect(googleNavUrl(null, undefined, "  ")).toBeNull();
  });
});

describe("nextPendingStop", () => {
  it("sequence sırasına göre ilk bekleyeni döner", () => {
    const r = run([
      stop({ id: 3, sequence: 3, status: "PENDING" }),
      stop({ id: 1, sequence: 1, status: "DELIVERED" }),
      stop({ id: 2, sequence: 2, status: "PENDING" }),
    ]);
    expect(nextPendingStop(r)?.id).toBe(2);
  });
  it("hepsi sonuçlandıysa null", () => {
    const r = run([stop({ id: 1, status: "DELIVERED" }), stop({ id: 2, status: "FAILED" })]);
    expect(nextPendingStop(r)).toBeNull();
  });
});

describe("runProgress", () => {
  it("[sonuçlanan, toplam] sayar", () => {
    const r = run([
      stop({ id: 1, status: "DELIVERED" }),
      stop({ id: 2, status: "FAILED" }),
      stop({ id: 3, status: "PENDING" }),
    ]);
    expect(runProgress(r)).toEqual([2, 3]);
  });
});
