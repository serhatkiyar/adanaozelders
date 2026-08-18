// PK-1 kabul testleri — istemci tarafında ürün kolu bazlı ödeme uygunluğu.
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
//
// İki kural test ediliyor:
//   1. Kollar bağımsızdır — pazaryeri kapalıyken mağaza satın alma yüzeyi
//      çalışmaya devam eder.
//   2. İstemci de FAIL-CLOSED'dır — uygunluk bilgisi yüklenmediyse veya
//      isteği patladıysa ödeme butonu GÖSTERİLMEZ. "Bilmiyorum" hâlinde
//      ödeme akışı başlatmak, backend 503 dönse bile kötü bir vaattir.
import { describe, expect, it } from "vitest";

import {
  blockedBranchesForCart,
  canPromiseEscrow,
  closedBranchMessage,
  digitalProductsOpen,
  isBranchOpen,
  type PaymentAvailability,
} from "./paymentAvailability";

const acik = (...branches: string[]): PaymentAvailability => ({
  branches: [
    { branch: "store", open: branches.includes("store"), flag_enabled: true, blockers: [] },
    {
      branch: "tutor_marketplace",
      open: branches.includes("tutor_marketplace"),
      flag_enabled: true,
      blockers: branches.includes("tutor_marketplace") ? [] : ["provider_marketplace_support"],
    },
    {
      branch: "library_marketplace",
      open: branches.includes("library_marketplace"),
      flag_enabled: true,
      blockers: branches.includes("library_marketplace") ? [] : ["provider_marketplace_support"],
    },
  ],
});

describe("isBranchOpen", () => {
  it("pazaryeri kapalıyken mağaza kolu açık kalır", () => {
    const a = acik("store");
    expect(isBranchOpen(a, "store")).toBe(true);
    expect(isBranchOpen(a, "tutor_marketplace")).toBe(false);
    expect(isBranchOpen(a, "library_marketplace")).toBe(false);
  });

  it("mağaza kapalıyken pazaryeri kolu açık kalabilir", () => {
    const a = acik("tutor_marketplace");
    expect(isBranchOpen(a, "store")).toBe(false);
    expect(isBranchOpen(a, "tutor_marketplace")).toBe(true);
  });

  it("uygunluk bilgisi yoksa (yükleniyor/hata) KAPALI sayılır", () => {
    expect(isBranchOpen(undefined, "store")).toBe(false);
    expect(isBranchOpen(null, "tutor_marketplace")).toBe(false);
  });

  it("bilinmeyen kol KAPALI sayılır", () => {
    // Sunucu yeni bir kol eklerse eski istemci onu açık varsaymamalı.
    expect(isBranchOpen({ branches: [] }, "store")).toBe(false);
  });
});

describe("blockedBranchesForCart", () => {
  it("karışık sepette engelli kolu bildirir", () => {
    const a = acik("store");
    expect(blockedBranchesForCart(a, ["PLATFORM", "TUTOR"])).toEqual(["tutor_marketplace"]);
  });

  it("yalnız platform malı varsa engel yoktur", () => {
    expect(blockedBranchesForCart(acik("store"), ["PLATFORM"])).toEqual([]);
  });

  it("boş sepette engel yoktur", () => {
    expect(blockedBranchesForCart(acik("store"), [])).toEqual([]);
  });

  it("uygunluk bilgisi yoksa sepetteki tüm kollar engelli sayılır", () => {
    expect(blockedBranchesForCart(undefined, ["PLATFORM", "TUTOR"])).toEqual([
      "store",
      "tutor_marketplace",
    ]);
  });

  it("bilinmeyen satıcı tipi PAZARYERİ sayılır (fail-safe)", () => {
    // Sunucu yeni bir satıcı tipi eklerse ve eşleme güncellenmezse kalem
    // sessizce kapısız kalmamalı; en kısıtlı kola atanır. Backend'de aynı kural
    // (`branches_for_seller_types`) test edilmişti, istemcide edilmemişti —
    // guard mutasyon provası bu boşluğu buldu.
    expect(blockedBranchesForCart(acik("store"), ["YENI_SATICI_TIPI"])).toEqual([
      "tutor_marketplace",
    ]);
    // Bilinen tip yanlış eşlenmesin (küçük/büyük harf + boşluk normalize).
    expect(blockedBranchesForCart(acik("store"), [" platform "])).toEqual([]);
  });
});

describe("canPromiseEscrow", () => {
  it("pazaryeri kolu açıkken emanet ifadesi kullanılabilir", () => {
    expect(canPromiseEscrow(acik("tutor_marketplace"), "tutor_marketplace")).toBe(true);
  });

  it("pazaryeri kolu kapalıyken emanet ifadesi KULLANILAMAZ", () => {
    // iyzico Pazaryeri devreye girmeden "paranız emanette" demek yanlış vaattir.
    expect(canPromiseEscrow(acik("store"), "tutor_marketplace")).toBe(false);
    expect(canPromiseEscrow(acik("store"), "library_marketplace")).toBe(false);
  });

  it("mağaza kolu için emanet ifadesi hiçbir zaman kullanılmaz", () => {
    // Kendi malının satışı doğrudan satıştır; para platformun kendi cirosudur.
    expect(canPromiseEscrow(acik("store"), "store")).toBe(false);
  });

  it("uygunluk bilgisi yoksa emanet ifadesi kullanılamaz", () => {
    expect(canPromiseEscrow(undefined, "tutor_marketplace")).toBe(false);
  });
});

describe("closedBranchMessage", () => {
  it("her kol için kullanıcıya gösterilebilir nötr bir metin verir", () => {
    for (const branch of ["store", "tutor_marketplace", "library_marketplace"] as const) {
      const msg = closedBranchMessage(branch);
      expect(msg.length).toBeGreaterThan(10);
      // Kapalı kolun mesajı emanet/escrow vaadi İÇERMEZ.
      expect(msg.toLowerCase()).not.toContain("emanet");
      expect(msg.toLowerCase()).not.toContain("escrow");
    }
  });
});

describe("digitalProductsOpen", () => {
  // Kollardan BAĞIMSIZ bir kapı: platformun kendi dijital ürünü `store` koluna
  // düşer ve o kol varsayılan olarak AÇIKTIR — yani kol durumu bu soruyu
  // cevaplamaz. Admin ürün formu DIGITAL seçeneğini buna göre kapatır.
  it("sunucu açık dediyse açıktır", () => {
    expect(digitalProductsOpen({ branches: [], digital_products_open: true })).toBe(true);
  });

  it("sunucu kapalı dediyse kapalıdır", () => {
    expect(digitalProductsOpen({ branches: [], digital_products_open: false })).toBe(false);
  });

  it("bilgi YOKSA kapalı sayılır (fail-closed)", () => {
    // Uç düşerse ya da alan gelmezse DIGITAL seçeneğini açık bırakmak,
    // yöneticiye satılamayan ve türü DEĞİŞTİRİLEMEYEN bir ürün açtırırdı.
    expect(digitalProductsOpen(undefined)).toBe(false);
    expect(digitalProductsOpen(null)).toBe(false);
    expect(digitalProductsOpen({ branches: [] })).toBe(false);
  });

  it("mağaza kolunun açık olması dijital ürünü AÇMAZ", () => {
    // Tuzağın kökü tam olarak buydu: kol kapısı dijital ürünü hiç durdurmuyor.
    expect(
      digitalProductsOpen({
        branches: [{ branch: "store", open: true, flag_enabled: true, blockers: [] }],
      })
    ).toBe(false);
  });
});
