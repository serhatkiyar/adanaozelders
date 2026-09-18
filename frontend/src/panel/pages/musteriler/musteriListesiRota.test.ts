// @vitest-environment node
/**
 * `PATHS.adminNewCustomers`in var olduğunu ve `menu.ts`teki "Müşteriler"
 * yaprağının izin beyanı (`requiredPermission: "users"`) taşıdığını doğrular.
 * Asıl kapı `__guards__/panelIzinKapisi.test.ts` (App.tsx'in TÜM
 * `/yonetim-yeni` rotalarını tarar) — bu dosya yalnız BU ekranın kendi
 * sözleşmesini kayıt altına alır (bkz. `siparisListesiRota.test.ts` emsali).
 *
 * İzin kodu `"users"`: eski panelin `AdminUsersPage`i `adminNavigation.ts`te
 * `requiredPermission: "users.view"` taşıyor (bkz. `adminAreaAccess`
 * öneki) — burada da aynı öneke bağlanır (`users.view`/`users.manage`).
 */
import { PATHS } from "@/lib/routes";
import { PANEL_MENU, rotaIzniBul } from "@/panel/layout/menu";

describe("Müşteriler rotası ve menü izni", () => {
  it("PATHS.adminNewCustomers kanonik yolu taşır", () => {
    expect(PATHS.adminNewCustomers).toBe("/yonetim-yeni/musteriler");
  });

  it("menu.ts'te 'users' izin beyanıyla eşleşir", () => {
    const bilgi = rotaIzniBul(PANEL_MENU, PATHS.adminNewCustomers);
    expect(bilgi?.requiredPermission).toBe("users");
  });
});
