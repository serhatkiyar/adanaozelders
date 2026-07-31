// Stok hareket defteri — sunum tarafı saf mantık.
//
// Bu dosya `lib/stockMovements.ts`'in sözleşmesini yazar. Paketin ilk commit'i
// olduğu için modül henüz yoktur: koşum kırmızıdır.
//
// Neden saf: hareket satırının nasıl OKUNDUĞU (işaret, tür etiketi, gerekçe
// metni, tutarlılık rozeti) üç yerde kullanılacak — geçmiş penceresi, ürün
// satırı özeti ve gerekçe formu. Kuralları tek yerde tutmak, üçünün zamanla
// birbirinden ayrışmasını engeller (F26'da `orderItems.ts` ile aynı gerekçe).
import { describe, expect, it } from "vitest";

import {
  ADMIN_REASON_OPTIONS,
  consistencyBadge,
  formatDelta,
  movementTypeLabel,
  reasonLabel,
  requiresNote,
  validateStockEdit,
} from "./stockMovements";

describe("formatDelta", () => {
  it("artışta + işareti taşır", () => {
    expect(formatDelta(15)).toBe("+15");
  });

  it("azalışta − işareti taşır (eksi işareti tek kaynaktan)", () => {
    expect(formatDelta(-2)).toBe("−2");
  });

  it("sıfır delta işaretsiz gösterilir (yalnız açılış bakiyesinde görülür)", () => {
    expect(formatDelta(0)).toBe("0");
  });
});

describe("movementTypeLabel", () => {
  it("altı türün hepsi Türkçe etiketli", () => {
    const türler = [
      "OPENING_BALANCE",
      "INITIAL",
      "SALE",
      "SALE_CANCEL",
      "RETURN",
      "ADMIN_ADJUSTMENT",
    ] as const;
    for (const t of türler) {
      const etiket = movementTypeLabel(t);
      expect(etiket).toBeTruthy();
      // Ham enum adı ekrana basılmaz.
      expect(etiket).not.toContain("_");
    }
  });

  it("bilinmeyen tür ham enum yerine anlaşılır bir metne düşer", () => {
    // Sunucu yeni bir tür eklerse ekran "undefined" yazmamalı.
    expect(movementTypeLabel("HAYALI" as never)).toBe("Bilinmeyen hareket");
  });
});

describe("reasonLabel", () => {
  it("sistem gerekçeleri Türkçeleşir", () => {
    expect(reasonLabel("ORDER_PAID")).toBeTruthy();
    expect(reasonLabel("ORDER_PAID")).not.toContain("_");
    expect(reasonLabel("MIGRATION_OPENING")).toBeTruthy();
    expect(reasonLabel("RETURN_ACCEPTED")).toBeTruthy();
  });

  it("admin gerekçeleri Türkçeleşir", () => {
    for (const opt of ADMIN_REASON_OPTIONS) {
      expect(opt.label).toBeTruthy();
      expect(reasonLabel(opt.value)).toBe(opt.label);
    }
  });

  it("gerekçe kodu her hareketde vardır; boş gelirse dürüstçe söylenir", () => {
    expect(reasonLabel("")).toBe("Gerekçe kayıtlı değil");
  });
});

describe("ADMIN_REASON_OPTIONS", () => {
  it("backend beyaz listesiyle birebir aynı", () => {
    // Ayrışırsa kullanıcı seçtiği gerekçeyle 400 alır.
    expect(ADMIN_REASON_OPTIONS.map((o) => o.value)).toEqual([
      "SAYIM_FARKI",
      "HASAR",
      "KAYIP",
      "HATALI_GIRIS",
      "TEDARIK",
      "DIGER",
    ]);
  });
});

describe("requiresNote", () => {
  it("DIGER seçilince not zorunlu", () => {
    expect(requiresNote("DIGER")).toBe(true);
  });

  it("diğer gerekçelerde not isteğe bağlı", () => {
    expect(requiresNote("SAYIM_FARKI")).toBe(false);
    expect(requiresNote("TEDARIK")).toBe(false);
  });
});

describe("validateStockEdit", () => {
  it("stok değişmediyse gerekçe istenmez", () => {
    const r = validateStockEdit({ current: 10, next: 10, reason: null, note: null });
    expect(r.ok).toBe(true);
    expect(r.submitStock).toBe(false); // sunucuya stok alanı gönderilmez
  });

  it("stok değiştiyse gerekçe zorunlu", () => {
    const r = validateStockEdit({ current: 10, next: 25, reason: null, note: null });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Gerekçe");
  });

  it("DIGER gerekçesinde not zorunlu", () => {
    const bos = validateStockEdit({
      current: 10, next: 25, reason: "DIGER", note: "   ",
    });
    expect(bos.ok).toBe(false);
    const dolu = validateStockEdit({
      current: 10, next: 25, reason: "DIGER", note: "depo sayımı",
    });
    expect(dolu.ok).toBe(true);
  });

  it("gerekçeli geçerli düzenleme kabul edilir", () => {
    const r = validateStockEdit({
      current: 10, next: 25, reason: "TEDARIK", note: null,
    });
    expect(r.ok).toBe(true);
    expect(r.submitStock).toBe(true);
    // Delta sunucuda kilit altında hesaplanır; istemci yalnız HEDEFİ gönderir.
    expect(r.payload).toEqual({ stock: 25, stock_reason_code: "TEDARIK", stock_note: null });
  });

  it("negatif hedef istemcide de reddedilir", () => {
    // Sunucu 409 veriyor; kullanıcıyı boşa göndermemek için burada da kesilir.
    const r = validateStockEdit({ current: 10, next: -1, reason: "HASAR", note: null });
    expect(r.ok).toBe(false);
  });

  it("beyaz liste dışı gerekçe reddedilir", () => {
    const r = validateStockEdit({
      current: 10, next: 12, reason: "CANIM_ISTEDI" as never, note: null,
    });
    expect(r.ok).toBe(false);
  });
});

describe("consistencyBadge", () => {
  it("tutarlı defter sakin bir rozet gösterir", () => {
    const b = consistencyBadge({
      consistent: true, current_stock: 8, ledger_stock: 8, first_divergent_id: null,
    });
    expect(b.tone).toBe("neutral");
    expect(b.label).toContain("tutarlı");
  });

  it("sapmada uyarı verir ve iki sayıyı birlikte söyler", () => {
    const b = consistencyBadge({
      consistent: false, current_stock: 99, ledger_stock: 8, first_divergent_id: 12,
    });
    expect(b.tone).toBe("warning");
    // Operatörün ne ile ne arasında sapma olduğunu görmesi gerekir.
    expect(b.label).toContain("99");
    expect(b.label).toContain("8");
  });

  it("doğrulama yüklenemediyse sessiz kalmaz", () => {
    // Hata ≠ boş ekran: rozet "bilinmiyor" demek zorunda.
    const b = consistencyBadge(null);
    expect(b.tone).toBe("warning");
    expect(b.label).toBeTruthy();
  });
});

// ── F29 sonrası: defter beş yeni hareket türü taşıyor ──
//
// Commit 8 sırasında bulundu: sayım ve hasar işlemleri COUNT_ADJUSTMENT,
// DAMAGE_TRANSFER, DAMAGE_RECOVERY, DAMAGE_DISPOSAL ve SUPPLIER_RETURN
// yazıyor; mevcut "Stok hareketleri" ekranı bunların HEPSİNİ "Bilinmeyen
// hareket" diye gösteriyordu. Operatör kendi yaptığı sayımı defterde
// tanıyamaz hâldeydi.
describe("F29 hareket türleri ve gerekçeleri", () => {
  it("beş yeni tür de insan diline çevrilir", () => {
    const beklenen: [StockMovementType, RegExp][] = [
      ["COUNT_ADJUSTMENT", /sayım/i],
      ["DAMAGE_TRANSFER", /hasar/i],
      ["DAMAGE_RECOVERY", /kurtar|satılabilir/i],
      ["DAMAGE_DISPOSAL", /[İi]mha/],
      ["SUPPLIER_RETURN", /tedarikçi/i],
    ];
    for (const [tur, desen] of beklenen) {
      const etiket = movementTypeLabel(tur);
      expect(etiket, `"${tur}" çevrilmemiş`).not.toBe("Bilinmeyen hareket");
      expect(etiket).toMatch(desen);
    }
  });

  it("sayım ve hasar gerekçe kodları ham enum olarak basılmaz", () => {
    const kodlar = [
      "SAYIM_FAZLA",
      "SAYIM_EKSIK",
      "KIRIK",
      "ISLAK",
      "BASKI_HATASI",
      "MUSTERI_IADESI_HASARLI",
    ];
    for (const kod of kodlar) {
      expect(reasonLabel(kod), `"${kod}" ham kod olarak kaldı`).not.toBe(kod);
    }
  });
});
