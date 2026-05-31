import { describe, it, expect } from "vitest";
import { roleHome } from "@/lib/roles";
import { ROLE_IDS } from "@/types";

describe("roleHome", () => {
  it("rol bazlı ana sayfayı döndürür", () => {
    expect(roleHome(ROLE_IDS.ADMIN)).toBe("/panel");
    expect(roleHome(ROLE_IDS.TUTOR)).toBe("/panel");
    expect(roleHome(ROLE_IDS.CLIENT)).toBe("/egitmenler");
  });
  it("bilinmeyen/eksik rol -> /giris", () => {
    expect(roleHome(undefined)).toBe("/giris");
    expect(roleHome(null)).toBe("/giris");
    expect(roleHome(999)).toBe("/giris");
  });
});
