import { describe, expect, it } from "vitest";

import type { DeliveryRun, DeliveryStop } from "@/types";
import {
  FAIL_REASON_LABEL,
  FAIL_REASONS,
  googleNavUrl,
  hasRunExceptions,
  nextPendingStop,
  runExceptions,
  runProgress,
} from "./deliveryRun";

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

describe("runExceptions (PDS O2 istisna şeridi)", () => {
  const TODAY = new Date(2026, 6, 10, 9, 0); // 10 Tem 2026, yerel

  it("yalnız PENDING durakları sayar; sonuçlananları yok sayar", () => {
    const r = run([
      stop({ id: 1, status: "DELIVERED", lat: null, lng: null }), // sonuçlandı → sayılmaz
      stop({ id: 2, status: "PENDING", lat: null, lng: null }), // pinsiz
    ]);
    const x = runExceptions(r, TODAY);
    expect(x.pinless).toBe(1);
    expect(hasRunExceptions(x)).toBe(true);
  });

  it("söz riski: geçmiş söz günü bekleyen durak", () => {
    const r = run([
      stop({ id: 1, lat: 37, lng: 35, promised_delivery_date: "2026-07-09" }), // dün
      stop({ id: 2, lat: 37, lng: 35, promised_delivery_date: "2026-07-10" }), // bugün
      stop({ id: 3, lat: 37, lng: 35, promised_delivery_date: "2026-07-11" }), // yarın
    ]);
    expect(runExceptions(r, TODAY).promiseRisk).toBe(1);
  });

  it("retry ve outlier sayımı", () => {
    const r = run([
      stop({ id: 1, lat: 37, lng: 35, failed_attempts: 2 }),
      stop({ id: 2, lat: 37, lng: 35, is_outlier: true }),
      stop({ id: 3, lat: 37, lng: 35 }),
    ]);
    const x = runExceptions(r, TODAY);
    expect(x.retry).toBe(1);
    expect(x.outlier).toBe(1);
  });

  it("sorun yoksa hasRunExceptions false", () => {
    const r = run([stop({ id: 1, lat: 37, lng: 35, promised_delivery_date: "2026-07-11" })]);
    expect(hasRunExceptions(runExceptions(r, TODAY))).toBe(false);
  });
});

describe("FAIL_REASONS (neden kodları)", () => {
  it("backend FailReason kümesiyle birebir eşleşir", () => {
    const codes = new Set(FAIL_REASONS.map((r) => r.code));
    expect(codes).toEqual(
      new Set([
        "EVDE_YOK",
        "ADRES_SORUNU",
        "ERISIM_SORUNU",
        "ERKEN_DENEME",
        "MUSTERI_TALEBI",
        "GUVENLIK",
        "PAKET_SORUNU",
        "ARAC_SORUNU",
        "DIGER",
      ]),
    );
  });
  it("her kodun etiket eşlemesi var", () => {
    for (const r of FAIL_REASONS) {
      expect(FAIL_REASON_LABEL[r.code]).toBe(r.label);
    }
  });
});
