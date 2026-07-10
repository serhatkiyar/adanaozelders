import { describe, expect, it } from "vitest";

import {
  canChangeAddress,
  canChangePref,
  canPostpone,
  isDropPref,
  prefBannerText,
} from "./deliveryPref";

const base = { has_physical: true, status: "PAID", payment_status: "PAID", postpone_count: 0 };

describe("prefBannerText", () => {
  it("standart tercihte bant yok", () => {
    expect(prefBannerText("ADRESIMDEYIM")).toBeNull();
    expect(prefBannerText(null)).toBeNull();
  });
  it("komşuya bırakmada not eklenir", () => {
    expect(prefBannerText("KOMSUYA_BIRAK", "Ayşe Hn. D:4")).toContain("Ayşe Hn. D:4");
  });
  it("kapıya bırak bandı", () => {
    expect(prefBannerText("KAPIYA_BIRAK")).toContain("Kapıya bırak");
  });
});

describe("isDropPref", () => {
  it("kapıya/komşuya → true, diğerleri false", () => {
    expect(isDropPref("KAPIYA_BIRAK")).toBe(true);
    expect(isDropPref("KOMSUYA_BIRAK")).toBe(true);
    expect(isDropPref("BENI_ARA")).toBe(false);
    expect(isDropPref(undefined)).toBe(false);
  });
});

describe("aşama kuralları (backend aynası)", () => {
  it("PAID ve SHIPPED'te tercih değişir; DELIVERED'da değişmez", () => {
    expect(canChangePref(base)).toBe(true);
    expect(canChangePref({ ...base, status: "SHIPPED" })).toBe(true);
    expect(canChangePref({ ...base, status: "DELIVERED" })).toBe(false);
  });
  it("dijital siparişte tercih yok", () => {
    expect(canChangePref({ ...base, has_physical: false })).toBe(false);
  });
  it("erteleme sınırı (2) dolunca kapanır", () => {
    expect(canPostpone(base)).toBe(true);
    expect(canPostpone({ ...base, postpone_count: 2 })).toBe(false);
  });
  it("adres değişikliği yalnız dağıtım öncesi (PAID)", () => {
    expect(canChangeAddress(base)).toBe(true);
    expect(canChangeAddress({ ...base, status: "SHIPPED" })).toBe(false);
  });
});
