/**
 * F30 saf paketleme mantığı — Vitest (DOM'suz).
 *
 * Ölçülen: izin kademeleri, paket durumu etiketleri, ilerleme aritmetiği,
 * tarama sonucu tonlaması, tamamlama engelleri ve idempotency anahtarı.
 *
 * `src/lib/packing.ts` henüz yazılmadığı için her düğüm KIRMIZIDIR. Dinamik
 * import kullanılır: statik import tüm dosyayı collection'da düşürür ve
 * ~20 ayrı kabul kriteri tek satırlık bir hataya iner.
 */
import { describe, expect, it } from "vitest";

// `import.meta.glob` kullanılıyor, düz `await import()` değil: Vite dinamik
// import'u DERLEME anında çözer ve dosya yoksa transform hatası verir — bütün
// dosya collection'da düşer, "no tests" görünür. Glob, olmayan dosya için boş
// eşleşme döndürür; böylece her düğüm kendi mesajıyla ayrı ayrı kırmızı olur.
const MODULLER = import.meta.glob("./packing.ts");

async function paketleme(): Promise<Record<string, any>> {
  const yukle = MODULLER["./packing.ts"];
  if (!yukle) throw new Error("HENÜZ YAZILMADI: src/lib/packing.ts");
  return (await yukle()) as Record<string, any>;
}

const satir = (over: Record<string, unknown> = {}) => ({
  order_item_id: 1,
  product_id: 10,
  sku: "FZK-000001",
  barcode: "8690000000001",
  title: "Test Kitabı",
  expected_qty: 2,
  scanned_qty: 0,
  ...over,
});

describe("izin kademeleri", () => {
  it("manage, pack ve view'ı ima eder", async () => {
    const { packingAccess } = await paketleme();
    expect(packingAccess(["packing.manage"])).toEqual({
      canView: true,
      canPack: true,
      canManage: true,
    });
  });

  it("pack, view'ı ima eder ama manage'i etmez", async () => {
    const { packingAccess } = await paketleme();
    expect(packingAccess(["packing.pack"])).toEqual({
      canView: true,
      canPack: true,
      canManage: false,
    });
  });

  it("view tek başına yazma yetkisi vermez", async () => {
    const { packingAccess } = await paketleme();
    expect(packingAccess(["packing.view"]).canPack).toBe(false);
  });

  it("ilgisiz izin hiçbir şey açmaz", async () => {
    const { packingAccess } = await paketleme();
    expect(packingAccess(["orders.view"]).canView).toBe(false);
  });

  it("izin listesi bilinmiyorsa FAIL-OPEN davranır", async () => {
    // `lib/adminAccess.ts:1-6` ile aynı sözleşme: eski persist edilmiş oturumda
    // `admin_permissions` undefined olabilir; kesin karar backend'dedir.
    const { packingAccess } = await paketleme();
    expect(packingAccess(undefined).canView).toBe(true);
  });
});

describe("fiziksel anlam", () => {
  it("durum etiketleri Türkçe ve eksiksizdir", async () => {
    const { PACKAGE_STATUS_LABEL } = await paketleme();
    for (const durum of [
      "OPEN",
      "PACKED",
      "HANDED_OVER",
      "RETURN_PENDING",
      "RETURNED",
      "DELIVERED",
      "VOID",
    ]) {
      expect(PACKAGE_STATUS_LABEL[durum], `etiket eksik: ${durum}`).toBeTruthy();
    }
  });

  it("işletmede sayılan durumlar backend tablosuyla aynıdır", async () => {
    // Sözleşme §3.2. İki taraf ayrışırsa ekran "depoda" derken envanter
    // "kuryede" der — kullanıcının gördüğü sayı yalan olur.
    const { isOnPremise } = await paketleme();
    expect(isOnPremise("PACKED")).toBe(true);
    expect(isOnPremise("RETURNED")).toBe(true);
    expect(isOnPremise("HANDED_OVER")).toBe(false);
    expect(isOnPremise("RETURN_PENDING")).toBe(false);
  });
});

describe("ilerleme", () => {
  it("okutulan/beklenen toplamını sayar", async () => {
    const { packageProgress } = await paketleme();
    const p = packageProgress([
      satir({ expected_qty: 2, scanned_qty: 2 }),
      satir({ order_item_id: 2, expected_qty: 3, scanned_qty: 1 }),
    ]);
    expect(p.scanned).toBe(3);
    expect(p.expected).toBe(5);
    expect(p.complete).toBe(false);
  });

  it("hepsi tam olunca complete olur", async () => {
    const { packageProgress } = await paketleme();
    expect(packageProgress([satir({ expected_qty: 2, scanned_qty: 2 })]).complete).toBe(
      true,
    );
  });

  it("boş paket complete SAYILMAZ", async () => {
    // Aksi hâlde kalemsiz bir paket "hazır" görünür ve boş kutu yola çıkardı.
    const { packageProgress } = await paketleme();
    expect(packageProgress([]).complete).toBe(false);
  });
});

describe("tarama sonucu", () => {
  it("OK başarı tonundadır", async () => {
    const { scanResultTone } = await paketleme();
    expect(scanResultTone("OK")).toBe("success");
    expect(scanResultTone("OK_MANUAL")).toBe("warning");
  });

  it("red sonuçları HATA tonundadır", async () => {
    // Kullanıcı ilkesi: red sessizce yutulmaz. Uç 200 döndüğü için (sözleşme §6)
    // tonlama tek görünür uyarıdır.
    const { scanResultTone } = await paketleme();
    for (const r of ["WRONG_SKU", "OVER_QTY", "UNSCANNABLE"]) {
      expect(scanResultTone(r), `ton yanlış: ${r}`).toBe("error");
    }
  });

  it("her sonuç kodunun Türkçe mesajı vardır", async () => {
    const { scanResultMessage } = await paketleme();
    for (const r of ["OK", "OK_MANUAL", "WRONG_SKU", "OVER_QTY", "UNSCANNABLE"]) {
      expect(scanResultMessage(r), `mesaj eksik: ${r}`).toBeTruthy();
    }
  });

  it("bilinmeyen sonuç kodu SESSİZ GEÇMEZ", async () => {
    // Backend yeni bir red kodu eklerse ekran onu "başarılı" göstermemeli.
    const { scanResultTone } = await paketleme();
    expect(scanResultTone("YENI_BILINMEYEN_KOD")).toBe("error");
  });
});

describe("tamamlama engelleri", () => {
  it("eksik kalemi gerekçesiyle listeler", async () => {
    const { completeBlockers } = await paketleme();
    const engeller = completeBlockers({
      status: "OPEN",
      items: [
        satir({ expected_qty: 2, scanned_qty: 2 }),
        satir({ order_item_id: 2, title: "İkinci", expected_qty: 3, scanned_qty: 1 }),
      ],
    });
    expect(engeller.length).toBe(1);
    expect(engeller[0]).toContain("İkinci");
  });

  it("tam pakette engel yoktur", async () => {
    const { completeBlockers } = await paketleme();
    expect(
      completeBlockers({ status: "OPEN", items: [satir({ scanned_qty: 2 })] }),
    ).toEqual([]);
  });

  it("OPEN olmayan paket tamamlanamaz", async () => {
    const { completeBlockers } = await paketleme();
    expect(
      completeBlockers({ status: "PACKED", items: [satir({ scanned_qty: 2 })] }).length,
    ).toBeGreaterThan(0);
  });
});

describe("idempotency anahtarı", () => {
  it("her çağrıda benzersizdir", async () => {
    const { newIdempotencyKey } = await paketleme();
    const kumesi = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(kumesi.size).toBe(50);
  });

  it("backend sınırına (80 karakter) sığar", async () => {
    const { newIdempotencyKey } = await paketleme();
    expect(newIdempotencyKey().length).toBeLessThanOrEqual(80);
  });
});

describe("QR payload", () => {
  it("paket payload'unu tanır", async () => {
    const { isPackagePayload } = await paketleme();
    expect(isPackagePayload("PKG1:42:abc")).toBe(true);
  });

  it("durak payload'unu paket sanmaz", async () => {
    // Denetçi notu 3: iki QR uzayı ayrık kalmalı.
    const { isPackagePayload } = await paketleme();
    expect(isPackagePayload("42:abc")).toBe(false);
  });
});
