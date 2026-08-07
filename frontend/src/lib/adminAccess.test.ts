import { describe, expect, it } from "vitest";

import { adminAreaAccess } from "./adminAccess";

describe("adminAreaAccess", () => {
  // İP-4/F-1 — SÖZLEŞME DEĞİŞİKLİĞİ (bilinçli):
  //
  // Bu iddia eskiden fail-OPEN'dı ("izin bilgisi yoksa her şeyi göster; karar
  // zaten backend'de"). Gerekçesi UI iyileştirmesiydi ama sonucu şuydu: izin
  // bilgisi yüklenememiş bir oturumda yönetici, kendisine kapalı olan yıkıcı
  // butonları GÖRÜYOR ve tıkladığında ancak 403 alıyordu — üstelik
  // `lib/queryClient.ts` 403'ü bildirimden muaf tuttuğu için hata çoğu yerde
  // SESSİZDİ. Yani fail-open'ın ödediği bedel "yetkisiz kullanıcıya çalışan
  // gibi görünen kontrol" idi.
  //
  // Fail-closed'ın maliyeti yok: `ProtectedRoute` admin ekranlarını `/auth/me`
  // çözülene kadar hiç render etmiyor ve `/auth/me` `admin_permissions`'ı HER
  // ZAMAN döndürüyor (`schemas/user.py` varsayılanı `[]`). `undefined` yalnız
  // eski persist edilmiş bir oturumda görülür — ve orada da doğru davranış
  // "aksiyonu gösterme"dir.
  it("undefined izin listesi FAIL-CLOSED (izin bilgisi yoksa aksiyon yok)", () => {
    expect(adminAreaAccess(undefined, "products")).toEqual({ canView: false, canManage: false });
  });

  it("boş izin listesi de kapalıdır", () => {
    expect(adminAreaAccess([], "products")).toEqual({ canView: false, canManage: false });
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
