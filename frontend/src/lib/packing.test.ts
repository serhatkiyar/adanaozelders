// @vitest-environment node
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

import type { PackageStatus } from "@/types/packing";

// İP-A7d5 · Görev 2: modül STATİK import ediliyor. Eski `import.meta.glob`
// red-first idiomuydu (dosya HENÜZ YOKKEN her düğüm ayrı kırmızı olsun diye);
// dosya yazıldığı gün gerekçesi bitti. Statik import ayrıca daha katıdır:
// dosya silinirse collection'da net bir hata verir, sessizce boş küme değil.
import * as paketlemeModulu from "./packing";

// Dönüş tipi `Record<string, any>` DEĞİL, modülün kendi tipi: `any` ile
// yeniden adlandırılmış ya da silinmiş bir export testte sessizce `undefined`
// olur ve "fonksiyon değil" diye çalışma anında patlardı; tiplenince derleme
// anında yakalanır. Glob'un kendisi korunuyor (dosya yoksa düğüm bazında
// kırmızı) — `typeof import(...)` yalnız tip düzeyinde bir referanstır.
type PaketlemeModulu = typeof import("./packing");

async function paketleme(): Promise<PaketlemeModulu> {
  return paketlemeModulu;
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
  // ⚠️ SÖZLEŞME DEĞİŞİKLİĞİ (bilinçli): bu blokta iki iddia TERSİNE çevrildi.
  //
  // Eskiden burada "manage, pack ve view'ı ima eder" ve "pack, view'ı ima eder"
  // testleri vardı; ikisi de üst kademenin alt kademeyi otomatik açtığını
  // KORUYORDU. O sözleşme backend'le ayrışıyordu: `require_admin_permission`
  // kapalı bir küme içinde tam kodu arar (`api/deps.py`), kademe sıralaması
  // tanımaz. Sonuç somut bir hataydı — yalnız `packing.manage` verilmiş bir
  // role ekran "Paketle" butonunu gösteriyor, uç 403 döndürüyordu.
  //
  // Eski testler silinmedi, ters yönde yeniden yazıldı: aynı girdiler hâlâ
  // ölçülüyor, beklenen sonuç değişti. Böylece ima zinciri geri gelirse (birisi
  // "kullanışsız" diye tekrar eklerse) bu iki düğüm kırılır.
  it("manage TEK BAŞINA görüntülemeyi de paketlemeyi de AÇMAZ (eski 'ima eder' sözleşmesi kaldırıldı)", async () => {
    const { packingAccess } = await paketleme();
    expect(packingAccess(["packing.manage"])).toEqual({
      canView: false,
      canPack: false,
      canManage: true,
    });
  });

  it("pack TEK BAŞINA görüntülemeyi AÇMAZ (okuma uçlarının hepsi packing.view ister)", async () => {
    // `api/routers/packing.py`: queue · packages · packages/{id} · return-queue
    // → hepsi `Depends(VIEW)`. Kabuğu açıp her sorguyu 403'e göndermek yerine
    // dürüst "yetkiniz yok" ekranı gösterilir (PackingLayout).
    const { packingAccess } = await paketleme();
    expect(packingAccess(["packing.pack"])).toEqual({
      canView: false,
      canPack: true,
      canManage: false,
    });
  });

  it("view tek başına yazma yetkisi vermez", async () => {
    const { packingAccess } = await paketleme();
    expect(packingAccess(["packing.view"])).toEqual({
      canView: true,
      canPack: false,
      canManage: false,
    });
  });

  it("view+pack — gerçek OPERATIONS_MANAGER kombinasyonu — yönetimi açmaz", async () => {
    // `migrations/versions/f30_paketleme_semasi.py::ROLE_GRANTS`: dağıtım
    // sorumlusu `view`+`pack` alır, `manage` ALMAZ (görev ayrılığı: paketi
    // toplayan kişi onu tek başına çözemez). İma zinciri geri gelirse bu satır
    // değil, üstteki iki satır kırılır; bu düğüm katalogla eşleşmeyi korur.
    const { packingAccess } = await paketleme();
    expect(packingAccess(["packing.view", "packing.pack"])).toEqual({
      canView: true,
      canPack: true,
      canManage: false,
    });
  });

  it("pack+manage, view'sız hâlde görüntülemeyi açmaz", async () => {
    const { packingAccess } = await paketleme();
    expect(packingAccess(["packing.pack", "packing.manage"])).toEqual({
      canView: false,
      canPack: true,
      canManage: true,
    });
  });

  it("üç izin birlikte üç kademeyi açar (SUPER_ADMIN / COMMERCE_MANAGER)", async () => {
    const { packingAccess } = await paketleme();
    expect(
      packingAccess(["packing.view", "packing.pack", "packing.manage"]),
    ).toEqual({ canView: true, canPack: true, canManage: true });
  });

  it("ilgisiz izin hiçbir şey açmaz", async () => {
    const { packingAccess } = await paketleme();
    expect(packingAccess(["orders.view", "delivery.manage"])).toEqual({
      canView: false,
      canPack: false,
      canManage: false,
    });
  });

  it("boş liste = izin yok (fail-open ile karıştırılmaz)", async () => {
    // `[]` "izinleri bilmiyorum" değil, "hiç izni yok" demektir. `!permissions`
    // kontrolü boş diziyi fail-open'a düşürseydi (`.length` ile yazılsaydı)
    // izinsiz admin bütün paketleme ekranlarını açardı.
    const { packingAccess } = await paketleme();
    expect(packingAccess([])).toEqual({
      canView: false,
      canPack: false,
      canManage: false,
    });
  });

  it("izin listesi bilinmiyorsa FAIL-OPEN davranır", async () => {
    // `lib/adminAccess.ts:1-6` ile aynı sözleşme: eski persist edilmiş oturumda
    // `admin_permissions` undefined olabilir; kesin karar backend'dedir.
    const { packingAccess } = await paketleme();
    expect(packingAccess(undefined)).toEqual({
      canView: true,
      canPack: true,
      canManage: true,
    });
  });
});

describe("fiziksel anlam", () => {
  it("durum etiketleri Türkçe ve eksiksizdir", async () => {
    const { PACKAGE_STATUS_LABEL } = await paketleme();
    // Liste `PackageStatus` olarak tiplendi: backend'e yeni bir durum eklenip
    // birlik genişlediğinde derleme burada patlar. (Modül `Record<string, any>`
    // yerine kendi tipiyle yüklendiği için mümkün oldu.)
    const DURUMLAR: PackageStatus[] = [
      "OPEN",
      "PACKED",
      "HANDED_OVER",
      "RETURN_PENDING",
      "RETURNED",
      "DELIVERED",
      "VOID",
    ];
    for (const durum of DURUMLAR) {
      expect(PACKAGE_STATUS_LABEL[durum], `etiket eksik: ${durum}`).toBeTruthy();
    }
    // Tablo listeden BÜYÜK de olmamalı: yalnız listedekileri gezen bir döngü,
    // tabloya sessizce eklenmiş fazladan bir anahtarı görmezdi.
    expect(Object.keys(PACKAGE_STATUS_LABEL).sort()).toEqual([...DURUMLAR].sort());
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

  // Aşağıdaki tabloların beklenen değerleri `services/packing_rules.py::
  // parse_package_qr` GERÇEKTEN koşularak ölçüldü (CPython 3.12), tahminle
  // yazılmadı. "backend" sütunu o ölçümdür; ayrışan satırlar ayrı bir düğümde
  // ayrıca ve gerekçesiyle sabitlenir.

  const KABUL: [string, string][] = [
    ["PKG1:1:abc", "en küçük geçerli kimlik"],
    ["PKG1:42:abc", "tipik etiket"],
    ["PKG1:999999:uzunToken", "büyük kimlik + uzun token"],
    ["PKG1:007:abc", "baştaki sıfır — backend int('007')=7 kabul ediyor"],
    [" PKG1:5:abc ", "dış boşluk — backend .strip() ile aynı"],
    ["PKG1:5:a b", "token içinde boşluk: token serbest metindir"],
    ["PKG1:5:abc-DEF_123", "token'da tire/alt çizgi/büyük harf"],
  ];

  it.each(KABUL)("kabul: %s (%s)", async (payload) => {
    const { isPackagePayload } = await paketleme();
    expect(isPackagePayload(payload)).toBe(true);
  });

  const RED: [string, string][] = [
    // ——— Bağımsız denetim bulgusu: `Number()` bunları SAYIYA çeviriyordu ———
    ["PKG1:1e3:abc", "bilimsel gösterim — Number('1e3')=1000 idi, kabul ediliyordu"],
    ["PKG1:1e2:abc", "bilimsel gösterim (küçük harf e), aynı sınıf"],
    ["PKG1:0x10:abc", "onaltılık — Number('0x10')=16 idi"],
    ["PKG1:0b11:abc", "ikilik — Number('0b11')=3 idi"],
    ["PKG1:5.0:abc", "ondalık nokta — Number('5.0')=5, Number.isInteger TRUE idi"],
    ["PKG1:+5:abc", "artı işareti — Number('+5')=5 idi (backend int() KABUL EDER)"],
    ["PKG1: 5 :abc", "kimlikte boşluk — Number(' 5 ')=5 idi (backend KABUL EDER)"],
    // ——— İki tarafın da reddettikleri ———
    ["PKG1:-5:abc", "eksi işaretli kimlik"],
    ["PKG1:5,0:abc", "virgüllü ondalık"],
    ["PKG1:Infinity:abc", "Infinity tam sayı değildir"],
    ["PKG1:NaN:abc", "NaN"],
    ["PKG1:0:abc", "kimlik sıfır — paket kimliği 1'den başlar"],
    ["PKG1:000:abc", "sıfır dolgulu sıfır"],
    ["PKG1:5:", "boş token — token'sız hiçbir şey doğrulanamaz"],
    ["PKG1::abc", "boş kimlik"],
    ["PKG1:5:abc:def", "fazla parça — token içinde ':' YOKTUR"],
    ["PKG1:5", "eksik parça"],
    ["42:abc", "çıplak DURAK yükü"],
    ["42", "çıplak kimlik"],
    ["PKG2:5:abc", "gelecek sürüm öneki bu ayrıştırıcıya ait değil"],
    ["pkg1:5:abc", "önek büyük/küçük harfe duyarlıdır"],
    ["PKG1 :5:abc", "önekte boşluk"],
    ["", "boş dizgi"],
    ["   ", "yalnız boşluk"],
    [":::", "yalnız ayraç"],
    ["PKG1:abc:def", "harf kimlik"],
    ["PKG1:12abc:def", "parseInt tuzağı — '12abc' 12 SAYILMAZ"],
  ];

  it.each(RED)("red: %s (%s)", async (payload) => {
    const { isPackagePayload } = await paketleme();
    expect(isPackagePayload(payload)).toBe(false);
  });

  it("null/undefined güvenli reddedilir", async () => {
    const { isPackagePayload } = await paketleme();
    expect(isPackagePayload(null)).toBe(false);
    expect(isPackagePayload(undefined)).toBe(false);
  });

  it("backend'den DAHA KATI olduğumuz yükler açıkça sabitlenir", async () => {
    // Python `int()` beklenenden cömerttir; ölçülen değerler:
    //   int("+5")=5 · int(" 5 ")=5 · int("5_0")=50 (alt çizgili sayı literali)
    //   int("５")=5 (tam genişlik) · int("۵")=5 (Arap-Hint) · int("৪")=4 (Bengal)
    // Yani bu yükleri backend PAKET yükü sayar, biz saymayız.
    //
    // Yön bilinçli: `false` dediğimizde yük mevcut durak yoluna düşer ve
    // `delivery_service.scan_qr` payload'u KENDİSİ yeniden ayrıştırır — paket
    // yüküyse yine paket olarak çözülür, karar kaybolmaz. Tersi (gevşek taraf)
    // ise pakete özel bir uca bozuk yük göndermek olurdu ve hata mesajı yanlış
    // yeri işaret ederdi. Ayrıca "５" gibi bir görsel ikizin sessizce 5 numaralı
    // pakete gitmesi, elle kod girişinde yanlış paketi açtırabilirdi.
    const { isPackagePayload } = await paketleme();
    for (const payload of [
      "PKG1:+5:abc",
      "PKG1: 5 :abc",
      "PKG1:5_0:abc",
      "PKG1:５:abc",
      "PKG1:۵:abc",
      "PKG1:৪:abc",
    ]) {
      expect(isPackagePayload(payload), `katılık kaçağı: ${payload}`).toBe(false);
    }
  });

  it("kimlik alanı SAYIYA çevrilmez: 20 basamaklı kimlik biçim olarak geçerlidir", async () => {
    // Kayan nokta hassasiyetine hiç girilmediğinin kanıtı: `Number` ile
    // yazılsaydı bu değer 1e20'ye yuvarlanır, "aynı" iki farklı kimlik ayırt
    // edilemezdi. Biçim doğru olduğu için burada TRUE beklenir — kimliğin
    // gerçekten var olup olmadığına backend karar verir (404).
    const { isPackagePayload } = await paketleme();
    expect(isPackagePayload("PKG1:99999999999999999999:abc")).toBe(true);
  });
});
