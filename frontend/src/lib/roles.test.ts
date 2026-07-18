import { describe, it, expect } from "vitest";
import { roleHome } from "@/lib/roles";
import { ROLE_IDS } from "@/types";

describe("roleHome", () => {
  it("tüm roller kök (`/`) workspace'inden başlar", () => {
    expect(roleHome(ROLE_IDS.ADMIN)).toBe("/");
    expect(roleHome(ROLE_IDS.TUTOR)).toBe("/");
    expect(roleHome(ROLE_IDS.CLIENT)).toBe("/");
    expect(roleHome(ROLE_IDS.LIBRARY_OPERATOR)).toBe("/");
    expect(roleHome(ROLE_IDS.COURIER)).toBe("/");
  });
  it("bilinmeyen/eksik rol -> /giris", () => {
    expect(roleHome(undefined)).toBe("/giris");
    expect(roleHome(null)).toBe("/giris");
    expect(roleHome(999)).toBe("/giris");
  });
});
