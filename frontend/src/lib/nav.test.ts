import { describe, expect, it } from "vitest";

import { OPERATOR_NAV, STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { resolveSurface } from "@/lib/navPrefs";
import { ROUTES } from "@/lib/routes";

// Eğitmen "Öğren" hub'ına ulaşabilmeli.
//
// Neden bu test var: `/ogren/*` route'ları `ProtectedRoute` altında, yani rol
// kısıtı YOK — eğitmen adresi elle yazsa sayfa açılıyordu. Ama TUTOR_NAV'da
// hub'a link olmadığı için hiçbir tıklama zinciri oraya varmıyordu; üstelik
// SRS/Öğren sayfaları eğitmene TUTOR_NAV render ettiğinden kenar çubuğunda
// hub'a dönüş bile yoktu (çıkışsız ekran). "Route var" ≠ "kullanıcı ulaşıyor".
//
// Test yalnız diziyi yoklamakla yetinmez: `resolveSurface` render edilen
// listeyi üreten fonksiyondur (DashboardHeader onu çağırır), bu yüzden
// görünürlük ondan geçirilerek doğrulanır — öğe listede olup varsayılan
// gizliyse kullanıcı yine göremezdi.
describe("TUTOR_NAV — Öğren hub'ı", () => {
  it("eğitmen menüsünde /ogren linki bulunur", () => {
    const hedef = TUTOR_NAV.find((i) => i.to === ROUTES.learn);
    expect(hedef, "TUTOR_NAV'da ROUTES.learn yok").toBeDefined();
    expect(hedef?.label).toBe("Öğren");
  });

  it.each(["navbar", "sidebar"] as const)(
    "tercih yokken %s yüzeyinde görünür olur",
    (surface) => {
      const cozulen = resolveSurface(TUTOR_NAV, undefined, surface);
      const ogren = cozulen.find((i) => i.to === ROUTES.learn);
      expect(ogren, `${surface}: öğe hiç yok`).toBeDefined();
      expect(ogren?.visible, `${surface}: öğe var ama gizli`).toBe(true);
    }
  );

  // Öğrencide zaten vardı; eklerken kaybolmadığını da sabitle.
  it("öğrenci menüsündeki /ogren linki korunur", () => {
    expect(STUDENT_NAV.some((i) => i.to === ROUTES.learn)).toBe(true);
  });

  // Karar kaydı: "Tekrar" (SRS) kenar çubuğuna DOĞRUDAN eklenmez — dokuz
  // aracın dokuzu da hub'ın altında yaşar, birini yukarı çekmek menü
  // enflasyonu başlatır. Erişim hub üzerinden iki tıkla sağlanır.
  it("SRS doğrudan menüye eklenmez (hub deseni korunur)", () => {
    for (const [ad, menu] of [
      ["STUDENT_NAV", STUDENT_NAV],
      ["TUTOR_NAV", TUTOR_NAV],
      ["OPERATOR_NAV", OPERATOR_NAV],
    ] as const) {
      expect(
        menu.some((i) => i.to === ROUTES.srs),
        `${ad}: SRS menüye doğrudan eklenmiş`
      ).toBe(false);
    }
  });
});
