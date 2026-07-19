import { describe, expect, it } from "vitest";

import { adminAreaAccess } from "./adminAccess";

describe("adminAreaAccess", () => {
  it("undefined izin listesi fail-open (karar backend'de)", () => {
    expect(adminAreaAccess(undefined, "products")).toEqual({ canView: true, canManage: true });
  });

  it("yalnız view → salt-okunur", () => {
    expect(adminAreaAccess(["products.view"], "products")).toEqual({
      canView: true,
      canManage: false,
    });
  });

  it("manage view'u ima eder", () => {
    expect(adminAreaAccess(["products.manage"], "products")).toEqual({
      canView: true,
      canManage: true,
    });
  });

  it("hiçbiri yoksa 403 adayı", () => {
    expect(adminAreaAccess(["orders.view"], "products")).toEqual({
      canView: false,
      canManage: false,
    });
  });

  it("çoklu alan: herhangi birinin izni yeter (AdminStore sekmeleri)", () => {
    const perms = ["orders.view", "coupons.manage"];
    expect(adminAreaAccess(perms, "products", "orders", "returns", "coupons")).toEqual({
      canView: true,
      canManage: true,
    });
    expect(adminAreaAccess(["products.view"], "orders", "returns")).toEqual({
      canView: false,
      canManage: false,
    });
  });
});
