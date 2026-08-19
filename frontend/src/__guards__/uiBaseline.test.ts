/**
 * İP-A1/A2 nöbetçi eşikleri.
 *
 * Bu test bir KAYNAK SÖZLEŞMESİ testidir (CLAUDE.md §C: düşük güçlü sayılır).
 * Amacı davranışı kanıtlamak değil; Medusa UI geçişi boyunca erişilebilirlik ve
 * mimari borcun SESSİZCE BÜYÜMESİNİ engellemektir. Son iki eşik sıfır/sabit
 * olduğu için gerçek bekçidir: ihlal doğduğu gün CI kırılır.
 *
 * Sayacın kendi doğruluğu ayrı bir dosyada sınanır (`sayim.test.ts`): eşiği
 * ölçen alet bozulursa bu dosya sessizce yeşil kalırdı.
 *
 * ## Eşikler İP-A2'de yeniden ölçüldü
 *
 * | Ölçüm | İP-A1 (regex) | İP-A2 (AST) | Neden değişti |
 * |---|---|---|---|
 * | dosya | 78 | 64 | test dosyaları ölçüm dışına alındı |
 * | ham `<button` | 126 | 126 | değişmedi |
 * | `<label>` | 59 | 55 | −1 yorumdaki yanlış sayım, −4 pilot göçü, +1 `Form.Label` |
 * | `htmlFor`lu | 3 | 4 | +1 `Form.Label` (tek yerden tüm formlara) |
 *
 * Dördü de mutasyonla sınandı (`docs/ip-a2-rapor.md` → Görev 6).
 */
import { describe, expect, it } from "vitest";
import { sayim, UNLABELED_OVERLAY_FILES } from "../../scripts/ui-baseline-sayim.mjs";

const olcum = sayim();

describe("İP-A1 nöbetçi eşikleri", () => {
  it("ölçüm tabanı boş değil (yanlış yeşil koruması)", () => {
    // Taban çökerse tüm sayımlar 0'a düşer ve her eşik 'geçer'. Önce tabanı doğrula.
    expect(olcum.files).toBeGreaterThanOrEqual(60);
  });

  it("ham <button sayısı artamaz (taban 126)", () => {
    // İP-A2 pilotu bu sayıyı DÜŞÜRMEDİ ve düşürmesi de beklenmiyordu:
    // `DamageDialog` zaten `admin/ui`'nin `Button`'ını kullanıyordu, tek bir
    // ham `<button>`ı yoktu. Sayı A6-A7'de düşecek.
    expect(olcum.rawButton).toBeLessThanOrEqual(126);
  });

  it("<label htmlFor oranı azalamaz (taban 4/55)", () => {
    // İP-A1'de 3/59 idi. Payda iki kez düzeldi: sayaç yorumdaki bir `<label>`
    // sözcüğünü sayıyordu (−1) ve pilot dört ham etiketi `Form.Label`'a
    // devretti (−4, +1). Pay `Form.Label` sayesinde arttı — bundan sonra
    // `Form.*`'a geçen her form oranı otomatik yukarı çeker.
    expect(olcum.labels).toBeGreaterThan(0);
    expect(olcum.labelsWithHtmlFor / olcum.labels).toBeGreaterThanOrEqual(
      4 / 55
    );
  });

  it("ui2/ dışında @medusajs/ui import eden dosya yok", () => {
    // Kalıcı kural: ekran dosyaları Medusa'yı doğrudan import etmez.
    expect(olcum.medusaDirectImports).toEqual([]);
  });

  it("role=dialog/aria-modal taşımayan overlay sayısı artamaz (taban 5)", () => {
    expect(olcum.unlabeledOverlays).toBeLessThanOrEqual(5);
  });

  it("etiketsiz overlay'i olan dosya listesi sabittir", () => {
    // Yeni bir dosya listeye girerse test kırılır — borç sessizce yayılamaz.
    expect(olcum.overlayOffenders).toEqual([...UNLABELED_OVERLAY_FILES].sort());
  });
});
