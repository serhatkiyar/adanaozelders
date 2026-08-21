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

  it("eşleşmeyen yolda Genel Bakış'a düşer (dizi sırasına DEĞİL)", () => {
    // Fallback `ADMIN_NAV_ITEMS[0]` iken eşleşmeyen bir yol "Hakedişler"
    // başlığını gösteriyordu — dizi sırası grup sırasıyla aynı değil.
    const item = getAdminNavItem("/yonetim/boyle-bir-sayfa-yok");
    expect(item.to).toBe(ROUTES.admin);
    expect(item.label).toBe("Genel Bakış");
  });
});

describe("İP-B1 · klavye kısayolları", () => {
  it("hiçbir harf iki alana birden verilmez", () => {
    // Dizi (`G` + harf) tek bir hedefe çözülmeli. İki alan aynı harfi alsaydı
    // `find` ilkini seçerdi — yani hedef, kaynak dosyadaki YAZIM SIRASINA
    // bağlı olurdu ve öğe eklendikçe sessizce değişirdi.
    const harfler = ADMIN_NAV_ITEMS.map((i) => i.kisayol).filter(Boolean);
    expect(new Set(harfler).size).toBe(harfler.length);
  });

  it("her kısayol TEK harftir ve büyük yazılır", () => {
    // Küçük harf yazılsaydı eşleşme (`toLocaleUpperCase("tr")` ile normalize
    // edilen tuş) hiç tutmazdı ve kısayol sessizce ölü olurdu.
    for (const i of ADMIN_NAV_ITEMS) {
      if (!i.kisayol) continue;
      expect(i.kisayol, i.label).toMatch(/^[A-ZÇĞİÖŞÜ]$/);
    }
  });

  it("kısayolu olan her alan gerçek bir rotaya bakar", () => {
    for (const i of ADMIN_NAV_ITEMS) {
      if (!i.kisayol) continue;
      expect(Object.values(ROUTES)).toContain(i.to);
    }
  });
});
