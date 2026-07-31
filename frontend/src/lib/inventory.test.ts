// F29 envanter — sunum tarafı saf kuralların SÖZLEŞMESİ (kabul matrisi, bölüm A).
//
// Paketin ilk commit'i olduğu için `lib/inventory.ts` henüz YOKTUR: bu dosyanın
// ilk koşumu kırmızıdır. `stockMovements.test.ts` ile aynı disiplin.
//
// Buradaki kurallar ekranın "neyi neyle karıştırmadığını" tanımlar. DOM tarafı
// `pages/admin/inventory/inventoryScreens.acceptance.test.tsx`'te ölçülür —
// saf kural yeşilken arayüzün onu kullanmaması hâlâ mümkündür, o yüzden ikisi
// birlikte gerekir.
import { describe, expect, it } from "vitest";

import {
  DAMAGE_KINDS,
  DAMAGE_REASON_OPTIONS,
  allowedCountActions,
  applyBlockers,
  bucketLabel,
  damageEffect,
  damageKindLabel,
  expectedPhysical,
  formatCountedQty,
  formatDifference,
  inventoryAccess,
  lineDifference,
  lineStatusBadge,
  newIdempotencyKey,
  requiresDamageNote,
  reservedDisplay,
  sessionStatusBadge,
  validateDamageForm,
  type CountLineLike,
} from "./inventory";

const SATIR = (over: Partial<CountLineLike> = {}): CountLineLike => ({
  bucket: "SALEABLE",
  status: "COUNTED",
  system_qty_snapshot: 8,
  reserved_qty_snapshot: 2,
  counted_qty: 8,
  ...over,
});

describe("inventoryAccess — üç kademeli izin", () => {
  it("izinler bilinmiyorsa fail-open (backend nihai otorite)", () => {
    // adminAccess.ts ile AYNI sözleşme: /me henüz tazelenmediyse ekran kilitlenmez.
    expect(inventoryAccess(undefined)).toEqual({
      canView: true,
      canCount: true,
      canApply: true,
    });
  });

  it("yalnız view: okur, sayamaz, uygulayamaz", () => {
    expect(inventoryAccess(["inventory.view"])).toEqual({
      canView: true,
      canCount: false,
      canApply: false,
    });
  });

  it("count APPLY'i İMA ETMEZ — görev ayrılığının kapısı", () => {
    const a = inventoryAccess(["inventory.view", "inventory.count"]);
    expect(a.canCount).toBe(true);
    expect(a.canApply).toBe(false);
  });

  it("apply görüntülemeyi ima eder (view'suz apply rol tanımına karşı)", () => {
    const a = inventoryAccess(["inventory.apply"]);
    expect(a.canView).toBe(true);
    expect(a.canApply).toBe(true);
  });

  it("alakasız izin envanteri açmaz", () => {
    expect(inventoryAccess(["products.manage", "delivery.manage"])).toEqual({
      canView: false,
      canCount: false,
      canApply: false,
    });
  });
});

describe("allowedCountActions — FSM", () => {
  it("DRAFT: ürün ekle, başlat, iptal", () => {
    expect(allowedCountActions("DRAFT").sort()).toEqual(
      ["cancel", "products", "start"].sort()
    );
  });

  it("IN_PROGRESS: say, gönder, iptal — apply YOK", () => {
    const a = allowedCountActions("IN_PROGRESS");
    expect(a).toContain("count");
    expect(a).toContain("submit");
    expect(a).toContain("cancel");
    expect(a).not.toContain("apply");
  });

  it("REVIEW: uygula, geri al, iptal — sayım da açık (yeniden sayım hakkı)", () => {
    const a = allowedCountActions("REVIEW");
    expect(a).toContain("apply");
    expect(a).toContain("reopen");
    expect(a).toContain("cancel");
    expect(a).toContain("count");
  });

  it("APPLIED ve CANCELLED terminal: hiçbir eylem yok", () => {
    expect(allowedCountActions("APPLIED")).toEqual([]);
    expect(allowedCountActions("CANCELLED")).toEqual([]);
  });
});

describe("miktar kavramları birbirine karışmaz", () => {
  it("SALEABLE beklenen fiziksel = sistem + rezerve", () => {
    // Rezerve = ödenmiş ama işletmeden çıkmamış: RAFTA DURUYOR.
    expect(expectedPhysical(SATIR({ system_qty_snapshot: 8, reserved_qty_snapshot: 2 }))).toBe(10);
  });

  it("DAMAGED beklenen fiziksel = yalnız sistem (rezerve UYGULANMAZ)", () => {
    expect(
      expectedPhysical(SATIR({ bucket: "DAMAGED", system_qty_snapshot: 3, reserved_qty_snapshot: null }))
    ).toBe(3);
  });

  it("DAMAGED satırda DOLU gelen rezerve bile hesaba katılmaz", () => {
    // Düşman fixture: `null` ile test etmek yetmez — `?? 0` yüzünden yanlış
    // uygulama da doğru sonucu verir ve mutasyon görünmez kalır. Sunucu
    // sözleşmeyi ihlal edip dolu bir sayı gönderse bile ekran onu beklenen
    // fizikselə EKLEMEMELİ; hasarlı kovada rezerve kavramı yoktur.
    expect(
      expectedPhysical(SATIR({ bucket: "DAMAGED", system_qty_snapshot: 3, reserved_qty_snapshot: 4 }))
    ).toBe(3);
    expect(reservedDisplay(SATIR({ bucket: "DAMAGED", reserved_qty_snapshot: 4 }))).toBe(
      "Uygulanmaz"
    );
  });

  it("DAMAGED satırda rezerve 'uygulanmaz' der — 0 YAZMAZ", () => {
    // "0 rezerve" iş anlamı taşır ("rezerve edilebilir ama edilmemiş");
    // hasarlı kovada rezerve kavramı hiç YOKTUR.
    expect(reservedDisplay(SATIR({ bucket: "DAMAGED", reserved_qty_snapshot: null }))).toBe(
      "Uygulanmaz"
    );
    expect(reservedDisplay(SATIR({ bucket: "SALEABLE", reserved_qty_snapshot: 0 }))).toBe("0");
  });

  it("fark = sayılan − (sistem + rezerve) — backend formülüyle birebir", () => {
    // Çalışılmış örnek: satılabilir 8, rezerve 2, sayılan 8 → beklenen 10 → −2.
    expect(lineDifference(SATIR({ counted_qty: 8 }))).toBe(-2);
    expect(lineDifference(SATIR({ counted_qty: 10 }))).toBe(0);
    expect(lineDifference(SATIR({ counted_qty: 12 }))).toBe(2);
  });

  it("sayılmamış satırın farkı 0 DEĞİL, bilinmiyor", () => {
    const bos = SATIR({ status: "PENDING", counted_qty: null });
    expect(lineDifference(bos)).toBeNull();
    expect(formatDifference(bos)).toBe("Henüz sayılmadı");
    expect(formatCountedQty(bos)).toBe("Henüz sayılmadı");
  });

  it("sayılmış sıfır ile hiç sayılmamış aynı görünmez", () => {
    const sifir = SATIR({ status: "COUNTED", counted_qty: 0, system_qty_snapshot: 0, reserved_qty_snapshot: 0 });
    expect(formatCountedQty(sifir)).toBe("0");
    expect(formatDifference(sifir)).toBe("0");
  });

  it("fark eksi işaretini U+2212 ile yazar (defterle aynı)", () => {
    expect(formatDifference(SATIR({ counted_qty: 8 }))).toBe("−2");
    expect(formatDifference(SATIR({ counted_qty: 12 }))).toBe("+2");
  });
});

describe("durum gösterimi renge bağlı değildir", () => {
  it("oturum durumu metin taşır", () => {
    expect(sessionStatusBadge("DRAFT").label).toMatch(/taslak/i);
    expect(sessionStatusBadge("IN_PROGRESS").label).toMatch(/sayım sürüyor|sayiliyor|sürüyor/i);
    expect(sessionStatusBadge("REVIEW").label).toMatch(/[İi]nceleme/);
    expect(sessionStatusBadge("APPLIED").label).toMatch(/uygulandı/i);
    expect(sessionStatusBadge("CANCELLED").label).toMatch(/[İi]ptal/);
  });

  it("STALE dikkat ister ve bunu metinle söyler", () => {
    const b = lineStatusBadge("STALE");
    expect(b.needsAction).toBe(true);
    expect(b.label).toMatch(/belirsiz|yeniden say/i);
    expect(b.tone).toBe("danger");
  });

  it("RESOLVED 'çözüldü' diye SUNULMAZ — hâlâ uygulanamaz", () => {
    // Yalnız açıklama yazmak belirsizliği gidermez; tek çıkış yeniden sayımdır.
    const b = lineStatusBadge("RESOLVED");
    expect(b.needsAction).toBe(true);
    expect(b.label).toMatch(/yeniden say/i);
  });

  it("bucket etiketleri açık Türkçe", () => {
    expect(bucketLabel("SALEABLE")).toMatch(/satılabilir/i);
    expect(bucketLabel("DAMAGED")).toMatch(/hasarlı/i);
  });
});

describe("applyBlockers — APPLY'i ne engeller", () => {
  it("STALE satır engeller ve sebebini söyler", () => {
    const b = applyBlockers([SATIR(), SATIR({ status: "STALE" })]);
    expect(b.length).toBe(1);
    expect(b[0]).toMatch(/yeniden say/i);
  });

  it("RESOLVED satır da engeller", () => {
    expect(applyBlockers([SATIR({ status: "RESOLVED" })]).length).toBe(1);
  });

  it("sayılmamış satır engeller", () => {
    expect(applyBlockers([SATIR({ status: "PENDING", counted_qty: null })]).length).toBe(1);
  });

  it("hepsi sayılmışsa engel yok", () => {
    expect(applyBlockers([SATIR(), SATIR({ bucket: "DAMAGED", reserved_qty_snapshot: null })])).toEqual([]);
  });
});

describe("hasar işlemleri — kullanıcı API enum'unu bilmez", () => {
  it("dört işlem fiil olarak sunulur", () => {
    expect(DAMAGE_KINDS.map((k) => k.value)).toEqual([
      "TRANSFER",
      "RECOVERY",
      "DISPOSAL",
      "SUPPLIER_RETURN",
    ]);
    expect(damageKindLabel("TRANSFER")).toMatch(/hasara ayır/i);
    expect(damageKindLabel("RECOVERY")).toMatch(/satılabilir duruma döndür/i);
    expect(damageKindLabel("DISPOSAL")).toMatch(/[İi]mha/);
    expect(damageKindLabel("SUPPLIER_RETURN")).toMatch(/tedarikçiye iade/i);
  });

  it("hasara ayırmada iki kovanın etkisi de yazılır", () => {
    const e = damageEffect("TRANSFER", 3);
    expect(e.from).toBe("SALEABLE");
    expect(e.to).toBe("DAMAGED");
    expect(e.text).toMatch(/satılabilir/i);
    expect(e.text).toMatch(/hasarlı/i);
    expect(e.text).toContain("3");
    expect(e.irreversible).toBe(false);
  });

  it("kurtarma yönü TERSİ olarak gösterilir", () => {
    const e = damageEffect("RECOVERY", 2);
    expect(e.from).toBe("DAMAGED");
    expect(e.to).toBe("SALEABLE");
  });

  it("imha geri dönüşsüzdür ve satılabilir kovaya dokunmaz", () => {
    const e = damageEffect("DISPOSAL", 1);
    expect(e.from).toBe("DAMAGED");
    expect(e.to).toBeNull();
    expect(e.irreversible).toBe(true);
  });

  it("tedarikçi iadesinde kaynak kova SEÇİLİR, tahmin edilmez", () => {
    expect(damageEffect("SUPPLIER_RETURN", 4, "DAMAGED").from).toBe("DAMAGED");
    expect(damageEffect("SUPPLIER_RETURN", 4, "SALEABLE").from).toBe("SALEABLE");
    // Kova seçilmemişken etki metni sayı uydurmaz.
    expect(damageEffect("SUPPLIER_RETURN", 4, null).from).toBeNull();
  });

  it("gerekçe listesi backend beyaz listesiyle BİREBİR", () => {
    expect(DAMAGE_REASON_OPTIONS.map((o) => o.value)).toEqual([
      "KIRIK",
      "ISLAK",
      "BASKI_HATASI",
      "MUSTERI_IADESI_HASARLI",
      "DIGER",
    ]);
  });

  it("DIGER açıklama ister, diğerleri istemez", () => {
    expect(requiresDamageNote("DIGER")).toBe(true);
    expect(requiresDamageNote("KIRIK")).toBe(false);
  });
});

describe("validateDamageForm", () => {
  const TEMEL = {
    productId: 5,
    kind: "TRANSFER" as const,
    qty: 2,
    reason: "KIRIK" as const,
    note: "",
    bucket: null,
    idempotencyKey: "k-1",
  };

  it("geçerli formda sunucu gövdesini üretir", () => {
    const r = validateDamageForm(TEMEL);
    expect(r.ok).toBe(true);
    expect(r.payload).toEqual({
      product_id: 5,
      kind: "TRANSFER",
      qty: 2,
      reason_code: "KIRIK",
      note: null,
      idempotency_key: "k-1",
    });
  });

  it("miktar pozitif tam sayı olmalı", () => {
    expect(validateDamageForm({ ...TEMEL, qty: 0 }).ok).toBe(false);
    expect(validateDamageForm({ ...TEMEL, qty: -1 }).ok).toBe(false);
    expect(validateDamageForm({ ...TEMEL, qty: 1.5 }).ok).toBe(false);
  });

  it("DIGER'de açıklama boşsa reddeder", () => {
    const r = validateDamageForm({ ...TEMEL, reason: "DIGER", note: "   " });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/açıklama/i);
  });

  it("DIGER'de açıklama gövdeye GİRER", () => {
    const r = validateDamageForm({ ...TEMEL, reason: "DIGER", note: " kapak yırtık " });
    expect(r.ok).toBe(true);
    expect(r.payload?.note).toBe("kapak yırtık");
  });

  it("tedarikçi iadesinde kaynak kova zorunlu", () => {
    const eksik = validateDamageForm({ ...TEMEL, kind: "SUPPLIER_RETURN", bucket: null });
    expect(eksik.ok).toBe(false);
    expect(eksik.error).toMatch(/kova/i);

    const tam = validateDamageForm({ ...TEMEL, kind: "SUPPLIER_RETURN", bucket: "DAMAGED" });
    expect(tam.ok).toBe(true);
    expect(tam.payload?.bucket).toBe("DAMAGED");
  });

  it("transfer/kurtarma/imha gövdeye bucket KOYMAZ", () => {
    // Sunucu bu üçünde kaynağı işlem türünden bilir; fazladan alan
    // `extra=forbid` yüzünden 422 üretirdi.
    expect(validateDamageForm({ ...TEMEL, kind: "DISPOSAL" }).payload).not.toHaveProperty("bucket");
  });

  it("idempotency anahtarı olmadan gönderim yapılmaz", () => {
    const r = validateDamageForm({ ...TEMEL, idempotencyKey: "" });
    expect(r.ok).toBe(false);
  });
});

describe("newIdempotencyKey", () => {
  it("her çağrıda farklı anahtar üretir", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
    // Backend sınırı: 80 karakter.
    expect(a.length).toBeLessThanOrEqual(80);
  });
});
