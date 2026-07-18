import { describe, expect, it } from "vitest";
import { ROUTES } from "@/lib/routes";
import { ADMIN_NAV_ITEMS, getAdminNavItem } from "./adminNavigation";

describe("admin navigation", () => {
  it("uses canonical /yonetim routes", () => {
    expect(ROUTES.admin).toBe("/yonetim");
    expect(ROUTES.adminReports).toBe("/yonetim/moderasyon/sikayetler");
    expect(ADMIN_NAV_ITEMS.every((item) => item.to.startsWith("/yonetim"))).toBe(true);
  });

  it("resolves every store sub-route to the store page metadata", () => {
    const item = getAdminNavItem(ROUTES.adminStoreOrders);
    expect(item.label).toBe("Mağaza");
    expect(item.to).toBe(ROUTES.adminStoreProducts);
  });

  it("keeps the overview route exact", () => {
    expect(getAdminNavItem(ROUTES.admin).label).toBe("Genel Bakış");
    expect(getAdminNavItem(ROUTES.adminUsers).label).toBe("Kullanıcılar");
  });
});
