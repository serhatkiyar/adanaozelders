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
describe("Öğren hub'ı — donduruldu", () => {
  // 5 Eyl 2026: Öğren DONDURULDU (bkz. lib/ozellikBayraklari.ts::OGREN_ACIK).
  // Yukarıdaki karar kaydı TARİH olarak duruyor — eğitmenin hub'a ulaşamaması
  // bir kusurdu ve düzeltilmişti; bugün bölümün tamamı kapalı.
  //
  // İddia terse döndü ama SÖZLEŞME aynı: menüde görünen her şey tıklanabilir
  // ve gerçek bir yere gitmeli. Donmuş bir bölümü menüde tutmak, kullanıcıya
  // tutulmayacak bir söz vermektir.
  //
  // Bayrak açılınca eski davranışın tamamı geri gelir; bunun nöbetçisi
  // `__guards__/bolumDondurmaBayrakAcik.test.tsx`.
  it("donmuşken HİÇBİR menüde /ogren linki yok", () => {
    for (const [ad, menu] of [
      ["STUDENT_NAV", STUDENT_NAV],
      ["TUTOR_NAV", TUTOR_NAV],
      ["OPERATOR_NAV", OPERATOR_NAV],
    ] as const) {
      expect(
        menu.some((i) => i.to === ROUTES.learn),
        `${ad}: donmuş Öğren bölümü menüde duruyor`
      ).toBe(false);
    }
  });

  // DOLULUK NÖBETÇİSİ: menüler boşalmış ya da import kırılmış olsaydı
  // yukarıdaki "yok" iddiası bedava geçerdi.
  it("menüler dolu ve çözümlenen yüzey çalışıyor", () => {
    expect(TUTOR_NAV.length).toBeGreaterThan(3);
    expect(STUDENT_NAV.some((i) => i.to === ROUTES.messages)).toBe(true);
    const cozulen = resolveSurface(TUTOR_NAV, undefined, "navbar");
    const mesajlar = cozulen.find((i) => i.to === ROUTES.messages);
    expect(mesajlar?.visible, "navbar: Mesajlar görünür değil").toBe(true);
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
