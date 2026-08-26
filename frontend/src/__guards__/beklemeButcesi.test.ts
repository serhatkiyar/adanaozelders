/**
 * İP-A7d5 · Görev 3 — **bekleme bütçesi nöbetçisi**.
 *
 * ## Neden bir nöbetçi gerekiyor
 *
 * İP-A6b (BULGU-10) global `asyncUtilTimeout: 4000`ı bilerek KALDIRDI: gerçek
 * bir performans regresyonu 117 dosyanın hepsinde dört saniye boyunca
 * gizlenebiliyordu. Karar doğruydu ama YAZIYLA korunuyordu — ve A7d5'te
 * ölçüldü ki aynı ayar iki dosyada `configure({ asyncUtilTimeout: 5_000 })`
 * biçiminde YAN KAPIDAN geri gelmişti.
 *
 * Üstelik daha kötü bir biçimde: RTL'in `configure`u modül düzeyinde
 * globaldir ve `@testing-library/dom` bir node_modules bağımlılığı olduğu için
 * vitest işçisinin ESM önbelleğinde **dosyalar arasında paylaşılır** (aynı
 * sızıntı sınıfı `ui2/zodTurkce.test.ts`te zod yereli için belgeli). Ölçüm:
 *
 *   `vitest run --pool=forks --poolOptions.forks.singleFork
 *      src/pages/operatorBalance.acceptance.test.tsx  src/__sonda.test.ts`
 *   → sonda `asyncUtilTimeout = 5000` okuyor; sonda TEK BAŞINA koşunca 1000.
 *
 * Yani o iki satır "yalnız kendi dosyasının bütçesi" değildi: aynı işçide
 * sonra gelen HER dosyanın bütçesini beş katına çıkarıyordu ve hangi dosyaların
 * etkilendiği karışık tohumda değişiyordu. Maskeleme KARARSIZDI.
 *
 * ## Sözleşme
 *
 *   1. Test dosyalarında `configure({ asyncUtilTimeout })` YOKTUR (sızıntı).
 *   2. Test dosyalarında `vi.setConfig({ testTimeout | hookTimeout })` YOKTUR
 *      (`vitest.config.ts`'in yazılı kuralı).
 *   3. Çağrı yerindeki `{ timeout: N }` MEŞRUDUR — yalnız o çağrıyı etkiler —
 *      ama envanteri KİMLİKLE sabittir: yeni bir bütçe, ölçümüyle birlikte
 *      rapora girmeden doğamaz.
 */
import { describe, expect, it } from "vitest";

import { butceOlcumu, tabanTaramasi } from "../../scripts/bekleme-butcesi.mjs";
import { butceKapisi } from "@/test-utils/beklemeButcesi";

/**
 * DOSYA kapsamlı bütçeler — `test-utils/beklemeButcesi.ts::dosyaBeklemeButcesi`.
 *
 * Ham `configure` yasak (sızıntı); bu yardımcı ise bütçeyi `beforeAll`da kurup
 * `afterAll`da ÖNCEKİ değerine döndürdüğü için aynı işçide sonra koşan
 * dosyalara taşmaz. Yine de envanteri kimlikle sabittir:
 *
 *   • `operatorPanel` 5000 — DAVRANIŞLA kanıtlandı: ezme kaldırılınca 12
 *     tohumun ÜÇÜNDE kırmızı düştü (5001/5041 "Adres & Konum — düzenle",
 *     5059 "/Kütüphanem/"). Ölçülen tepe bekleme 3.578 ms (üst sınır).
 *   • `operatorBalance` 3000 — kırmızı tohum GÖRÜLMEDİ; ölçülen tepe 1.184 ms
 *     (üst sınır) varsayılanın üstünde olduğu için ölçülmüş bir değerle
 *     bırakıldı (eski 5000'den indirildi).
 */
const DOSYA_BUTCELERI = [
  "src/pages/dashboards/operatorPanel.acceptance.test.tsx:98 5000",
  "src/pages/operatorBalance.acceptance.test.tsx:66 3000",
];

/**
 * Çağrı yeri bütçelerinin TAM envanteri (dosya:satır değer).
 *
 * Her satırın ölçümü ve neden kaldırılamadığı `docs/ip-a7d5-rapor.md` ·
 * Görev 3'te tablodadır. Kısaca (tam suite yükü altında ÖLÇÜLEN tepe bekleme):
 *
 *   • `DamageDialog:43` 2000 — ürün arama debounce'u; ölçülen tepe 303 ms.
 *   • `adminKataloglarGoc:213` 3000 — **K-2**; ölçülen tepe 136 ms ama tohum
 *     5153'te kırmızı düştü. AK-1'in sızıntısı kalkınca görünen ikinci gizli
 *     borç (birincisi `sayimOturumlariGoc`).
 *   • `adminDenetimKayitlari:197` 4000 — hata yolu; ölçülen tepe 363 ms.
 *   • `sayimOturumlariGoc:360` 3000 — AK-2; ölçülen tepe 802 ms.
 *   • `adminHakedisGoc:53` 4000 (11 çağrı) — ölçülen tepe 554 ms; A7d2'de
 *     aynı sorgu tohum 2013'te **917 ms** ölçülmüştü (varsayılan 1000).
 *   • `adminStoreDalAdlari:235` 4000 (4 çağrı) — ölçülen tepe 885 ms.
 *   • `adminStoreVariants:188` 1500 — ölçülen tepe **1550 ms**.
 *   • `adminStoreVariants:422` 4000 — ölçülen tepe 439 ms.
 *   • `storeVariants:18` 4000 (6 çağrı) — ölçülen tepe **1124 ms**.
 *   • `ticketsPaymentGate:32` 4000 (6 çağrı) — ölçülen tepe 225 ms.
 *
 * P3 (vitrin blok editörü) ÜÇ çağrı yeri açtı; üçü de 4000.
 *
 * Önce ÖLÇÜLDÜ (`performance.now()`, dosya tek başına koşarken tepe değer):
 * blok seçim döngüsü 657 ms, autosave beklemesi 929 ms. Bu ölçüme dayanarak
 * bütçeler ilk turda 1500/2500 yazıldı ve dosya tek başına dört koşumda
 * kararlıydı.
 *
 * TAM SUITE'te KIRILDI (ölçüldü): `landingSemaSurucusu` HERO_CAROUSEL testi
 * "Unable to find button" ile düştü — paralel yük altında panelin İLK VERİ
 * YÜKLEMESİ 1500 ms'i aşıyor. Yani 657 ms'lik tepe yalıtılmış koşumun
 * gerçeğiydi, suite'in değil. Bütçeler bu yüzden panel-mount eden diğer
 * kabul testleriyle aynı hizaya (4000) çekildi.
 *
 * Kayıt önemli: burada bütçe "ne olur ne olmaz" diye değil, ÖLÇÜLEN bir
 * kırılmadan sonra yükseltildi.
 *
 * Sayfa kimliği düzenleme ÜÇ çağrı yeri açtı (`landingSayfaKimligi`
 * 120/141/163, hepsi 4000): panel montajı. Aynı gerekçe, aynı hiza.
 *
 * Mobil görsel alanı (tasarım turu) BEŞ çağrı yeri açtı
 * (`landingMobilGorsel` 167/177/190/195/203, hepsi 4000): panel montajı +
 * 900 ms'lik otomatik kayıt. Aynı gerekçe, aynı hiza.
 *
 * P5 önizleme çerçevesi ÜÇ çağrı yeri açtı (`landingOnizleme` 138/150/179,
 * hepsi 4000). Biri (179) otomatik kaydın 900 ms'lik debounce'unu + kaydın
 * tamamlanmasını + çerçeve adresinin tazelenmesini bekler. Diğer ikisi panel
 * MONTAJINI bekler: dosya tek başına geçerken TAM SUITE paralel yükünde
 * düştü (ölçüldü) — beş sorgu birden çözülürken varsayılan 1000 ms yetmiyor.
 *
 * P5 (yayın olayı) ÜÇ çağrı yeri daha açtı, üçü de 4000. Bunlar bir gecikme
 * değil bir OLAY bekliyor: `BroadcastChannel` mesajının başka bir kanal
 * örneğine ulaşması, ardından React Query'nin geçersiz kılıp yeniden
 * çekmesi. Beklenen şey milisaniyelerle değil olay sırasıyla ölçülür; kısa
 * bir bütçe burada gerçek bir regresyonu değil, yalnız makine yükünü
 * ölçerdi.
 *
 * A7d5'te İKİ çağrı yeri KAPANDI (`operatorPanel`, `operatorBalance`): ikisi de
 * bütçe değil, tembel modül yükleme sorunuydu (Görev 2) ve ikisi de yukarıdaki
 * sızıntıyı üretiyordu.
 */
const CAGRI_BUTCELERI = [
  "src/components/admin/inventory/DamageDialog.test.tsx:43 2000",
  "src/components/admin/store/landingBlockEditor.characterization.test.tsx:220 4000",
  "src/components/admin/store/landingBlockEditor.characterization.test.tsx:227 4000",
  "src/components/admin/store/landingMobilGorsel.test.tsx:167 4000",
  "src/components/admin/store/landingMobilGorsel.test.tsx:177 4000",
  "src/components/admin/store/landingMobilGorsel.test.tsx:190 4000",
  "src/components/admin/store/landingMobilGorsel.test.tsx:195 4000",
  "src/components/admin/store/landingMobilGorsel.test.tsx:203 4000",
  "src/components/admin/store/landingOnizleme.test.tsx:138 4000",
  "src/components/admin/store/landingOnizleme.test.tsx:150 4000",
  "src/components/admin/store/landingOnizleme.test.tsx:179 4000",
  "src/components/admin/store/landingSayfaKimligi.test.tsx:120 4000",
  "src/components/admin/store/landingSayfaKimligi.test.tsx:141 4000",
  "src/components/admin/store/landingSayfaKimligi.test.tsx:163 4000",
  "src/components/admin/store/landingSemaSurucusu.test.tsx:139 4000",
  "src/hooks/vitrinYayinOlayi.test.tsx:134 4000",
  "src/hooks/vitrinYayinOlayi.test.tsx:150 4000",
  "src/hooks/vitrinYayinOlayi.test.tsx:177 4000",
  "src/pages/admin/adminDenetimKayitlari.acceptance.test.tsx:197 4000",
  "src/pages/admin/adminHakedisGoc.acceptance.test.tsx:53 4000",
  "src/pages/admin/inventory/sayimOturumlariGoc.acceptance.test.tsx:360 3000",
  "src/pages/dashboards/adminKataloglarGoc.acceptance.test.tsx:213 3000",
  "src/pages/dashboards/adminStoreDalAdlari.acceptance.test.tsx:251 4000",
  "src/pages/dashboards/adminStoreVariants.acceptance.test.tsx:188 1500",
  "src/pages/dashboards/adminStoreVariants.acceptance.test.tsx:422 4000",
  "src/pages/store/storeVariants.acceptance.test.tsx:18 4000",
  "src/pages/ticketsPaymentGate.test.tsx:32 4000",
];

describe("İP-A7d5 · bekleme bütçesi nöbetçisi", () => {
  const taban = tabanTaramasi();

  it("hiçbir test dosyası `configure({ asyncUtilTimeout })` ÇAĞIRMIYOR", () => {
    // Bu bir TAVAN değil TABANDIR: bir tane bile doğduğu gün CI kırılır,
    // çünkü etkisi o dosyayla sınırlı kalmaz. Meşru ihtiyacın yolu
    // `test-utils/beklemeButcesi.ts::dosyaBeklemeButcesi`tir (kurar VE geri
    // alır) ya da çağrı yerine yazılan `{ timeout: N }`dir.
    expect(taban.sizinti).toEqual([]);
  });

  it("hiçbir test dosyası `vi.setConfig` ile test bütçesini EZMİYOR", () => {
    expect(taban.ezme).toEqual([]);
  });

  it("dosya kapsamlı bütçelerin envanteri KİMLİKLE sabittir", () => {
    expect(taban.dosyaButceleri).toEqual(DOSYA_BUTCELERI);
  });

  it("çağrı yeri bütçelerinin envanteri KİMLİKLE sabittir", () => {
    // Sayı değil kimlik: biri kapanıp yenisi açılırsa sayı sabit kalır ve
    // envanter sessizce başka bir kümeye kayardı (A6c · Görev 7'nin dersi).
    expect(taban.butceler).toEqual(CAGRI_BUTCELERI);
  });

  /* ── Dedektörün kendi ters provaları ── */

  it("YORUMDA geçen `configure({ asyncUtilTimeout: 5000 })` sayılmaz (AST)", () => {
    // Bu gerçek bir tuzaktır: `operatorPanel`/`operatorBalance` dosyalarının
    // YORUMLARINDA tam olarak bu metin duruyor (kaldırma gerekçesi olarak).
    const kaynak = `
      // configure({ asyncUtilTimeout: 5_000 });
      const s = "vi.setConfig({ testTimeout: 20_000 })";
      s;
    `;
    const o = butceOlcumu(kaynak, "a.ts");
    expect(o.sizanConfigure).toEqual([]);
    expect(o.testTimeoutEzmesi).toEqual([]);
  });

  it("GERÇEK `configure({ asyncUtilTimeout })` YAKALANIR", () => {
    const kaynak = `import { configure } from "@testing-library/react";\nconfigure({ asyncUtilTimeout: 5_000 });`;
    expect(butceOlcumu(kaynak, "a.ts").sizanConfigure).toEqual([2]);
  });

  it("GERÇEK `vi.setConfig({ testTimeout })` YAKALANIR", () => {
    const kaynak = `vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });`;
    expect(butceOlcumu(kaynak, "a.ts").testTimeoutEzmesi).toEqual([1]);
  });

  it("`configure({ testIdAttribute })` sayılmaz — yalnız bekleme bütçesi", () => {
    const kaynak = `configure({ testIdAttribute: "data-x" });`;
    expect(butceOlcumu(kaynak, "a.ts").sizanConfigure).toEqual([]);
  });

  it("çağrı yeri bütçesi değeriyle birlikte okunur", () => {
    const kaynak = `await screen.findByText("x", undefined, { timeout: 4000 });`;
    expect(butceOlcumu(kaynak, "a.ts").cagriButceleri).toEqual([{ satir: 1, deger: 4000 }]);
  });

  it("dosya kapsamlı bütçe yardımcısı da değeriyle okunur", () => {
    const kaynak = `dosyaBeklemeButcesi(5_000);`;
    expect(butceOlcumu(kaynak, "a.ts").dosyaButceleri).toEqual([{ satir: 1, deger: 5000 }]);
  });
});

/* ══════════════ Yardımcının kendi davranışı ══════════════ */

describe("İP-A7d5 · `dosyaBeklemeButcesi` geri alma sözleşmesi", () => {
  it("kur/geriAl çifti ÖNCEKİ değeri geri yükler (sızıntı yok)", () => {
    let deger = 1000;
    const kapi = butceKapisi(5000, () => deger, (d) => { deger = d; });
    kapi.kur();
    expect(deger, "bütçe kurulmadı").toBe(5000);
    kapi.geriAl();
    expect(deger, "geri alma çalışmadı — yardımcı sızıntıya dönüştü").toBe(1000);
  });

  it("varsayılanı VARSAYMAZ: geri alınan değer okunan değerdir", () => {
    // Sabit 1000 yazmak sinsi bir kusur olurdu: başka bir dosya bütçeyi
    // meşru biçimde değiştirmişse, geri alma onu SESSİZCE ezerdi.
    let deger = 2500;
    const kapi = butceKapisi(5000, () => deger, (d) => { deger = d; });
    kapi.kur();
    kapi.geriAl();
    expect(deger).toBe(2500);
  });

  it("geriAl İKİ KEZ çağrılırsa ikinci çağrı bir şey bozmaz", () => {
    let deger = 1000;
    const kapi = butceKapisi(5000, () => deger, (d) => { deger = d; });
    kapi.kur();
    kapi.geriAl();
    deger = 4000; // araya başka bir dosya girdi
    kapi.geriAl();
    expect(deger).toBe(4000);
  });
});
