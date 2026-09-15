/**
 * `PATHS.adminNewOrders`in var olduğunu ve `menu.ts`teki "Siparişler"
 * yaprağının izin beyanı (`requiredPermission: "orders"`) taşıdığını
 * doğrular. Asıl kapı `__guards__/panelIzinKapisi.test.ts` (App.tsx'in TÜM
 * `/yonetim-yeni` rotalarını tarar) — bu dosya yalnız BU ekranın kendi
 * sözleşmesini kayıt altına alır.
 */
import { PATHS } from "@/lib/routes";
import { PANEL_MENU, rotaIzniBul } from "@/panel/layout/menu";

describe("Siparişler rotası ve menü izni", () => {
  it("PATHS.adminNewOrders kanonik yolu taşır", () => {
    expect(PATHS.adminNewOrders).toBe("/yonetim-yeni/siparisler");
  });

  it("menu.ts'te 'orders' izin beyanıyla eşleşir", () => {
    const bilgi = rotaIzniBul(PANEL_MENU, PATHS.adminNewOrders);
    expect(bilgi?.requiredPermission).toBe("orders");
  });
});
