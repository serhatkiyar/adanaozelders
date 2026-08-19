/**
 * İP-A1 nöbetçi eşikleri.
 *
 * Bu test bir KAYNAK SÖZLEŞMESİ testidir (CLAUDE.md §C: düşük güçlü sayılır).
 * Amacı davranışı kanıtlamak değil; Medusa UI geçişi boyunca erişilebilirlik ve
 * mimari borcun SESSİZCE BÜYÜMESİNİ engellemektir. Son iki eşik sıfır/sabit
 * olduğu için gerçek bekçidir: ihlal doğduğu gün CI kırılır.
 */
import { describe, expect, it } from "vitest";
import { sayim, UNLABELED_OVERLAY_FILES } from "../../scripts/ui-baseline-sayim.mjs";

const olcum = sayim();

describe("İP-A1 nöbetçi eşikleri", () => {
  it("ölçüm tabanı boş değil (yanlış yeşil koruması)", () => {
    // Taban çökerse tüm sayımlar 0'a düşer ve her eşik 'geçer'. Önce tabanı doğrula.
    expect(olcum.files).toBeGreaterThanOrEqual(70);
  });

  it("ham <button sayısı artamaz (taban 126)", () => {
    expect(olcum.rawButton).toBeLessThanOrEqual(126);
  });

  it("<label htmlFor oranı azalamaz (taban 3/59)", () => {
    expect(olcum.labels).toBeGreaterThan(0);
    expect(olcum.labelsWithHtmlFor / olcum.labels).toBeGreaterThanOrEqual(
      3 / 59
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
