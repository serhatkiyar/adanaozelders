// @vitest-environment node
import { describe, it, expect } from "vitest";
import { alisverisYapabilir, roleHome } from "@/lib/roles";
import { ROLE_IDS } from "@/types";

describe("roleHome", () => {
  it("tüm roller kök (`/`) workspace'inden başlar", () => {
    expect(roleHome(ROLE_IDS.ADMIN)).toBe("/");
    expect(roleHome(ROLE_IDS.TUTOR)).toBe("/genel-bakis");
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

describe("alisverisYapabilir", () => {
  it("öğrenci ve öğretmen mağazadan alışveriş yapabilir", () => {
    expect(alisverisYapabilir(ROLE_IDS.CLIENT)).toBe(true);
    expect(alisverisYapabilir(ROLE_IDS.TUTOR)).toBe(true);
  });
  it("yönetim/operatör/kurye alıcı değildir (fail-closed)", () => {
    expect(alisverisYapabilir(ROLE_IDS.ADMIN)).toBe(false);
    expect(alisverisYapabilir(ROLE_IDS.LIBRARY_OPERATOR)).toBe(false);
    expect(alisverisYapabilir(ROLE_IDS.COURIER)).toBe(false);
  });
  it("oturumsuz/bilinmeyen rol alıcı değildir", () => {
    expect(alisverisYapabilir(undefined)).toBe(false);
    expect(alisverisYapabilir(null)).toBe(false);
    expect(alisverisYapabilir(999)).toBe(false);
  });
});
