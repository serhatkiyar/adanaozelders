import { describe, expect, it } from "vitest";

import type { DeliveryInfo } from "@/types";

import { formatCountdown, promiseDayLabel, promiseText, promisedDateLabel } from "./deliveryPromise";

const TODAY = new Date(2026, 6, 8, 14, 0); // 8 Tem 2026 Çarşamba 14:00

describe("promiseDayLabel", () => {
  it("aynı gün → bugün", () => {
    expect(promiseDayLabel("2026-07-08", TODAY)).toBe("bugün");
  });
  it("ertesi gün → yarın", () => {
    expect(promiseDayLabel("2026-07-09", TODAY)).toBe("yarın");
  });
  it("uzak gün → haftagünü + tarih", () => {
    const label = promiseDayLabel("2026-07-13", TODAY);
    expect(label).toContain("Pazartesi");
    expect(label).toContain("13");
  });
  it("geçmiş tarih 'bugün' DEMEZ (tarihe döner)", () => {
    const label = promiseDayLabel("2026-07-06", TODAY);
    expect(label).not.toBe("bugün");
    expect(label).toContain("6");
  });
});

describe("formatCountdown", () => {
  it("saat + dakika", () => {
    expect(formatCountdown(2 * 3600 + 14 * 60)).toBe("2 sa 14 dk");
  });
  it("yalnız dakika", () => {
    expect(formatCountdown(45 * 60)).toBe("45 dk");
  });
  it("tam saat", () => {
    expect(formatCountdown(3 * 3600)).toBe("3 sa");
  });
  it("1 dk altı", () => {
    expect(formatCountdown(30)).toBe("1 dk'dan az");
  });
});

describe("promiseText", () => {
  const base: DeliveryInfo = {
    cutoff_hour: 16,
    promised_date_now: "2026-07-08",
    countdown_seconds: 7200,
    districts: ["Seyhan"],
  };
  it("cutoff öncesi geri sayımlı aciliyet", () => {
    expect(promiseText(base, TODAY)).toBe("2 sa içinde sipariş ver, bugün kapında");
  });
  it("cutoff sonrası (countdown null) yarın sözü", () => {
    expect(
      promiseText(
        { ...base, promised_date_now: "2026-07-09", countdown_seconds: null },
        TODAY,
      ),
    ).toBe("Şimdi sipariş ver, yarın kapında");
  });
});

describe("promisedDateLabel", () => {
  it("null/undefined → null", () => {
    expect(promisedDateLabel(null, TODAY)).toBeNull();
    expect(promisedDateLabel(undefined, TODAY)).toBeNull();
  });
  it("tarihli sipariş → etiket", () => {
    expect(promisedDateLabel("2026-07-09", TODAY)).toBe("yarın");
  });
});
