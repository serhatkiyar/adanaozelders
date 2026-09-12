/**
 * İP-A7d5 · Görev 2 — **tembel modül yükleyen test** nöbetçisi.
 *
 * ## Ölçtüğü kusur sınıfı ve neden nöbetçi gerekiyor
 *
 * Bir test dosyası ağır bir modülü çalışma zamanında yüklerse (`import()` ya da
 * `import.meta.glob` yükleyicisi), transform + değerlendirme maliyeti TOPLAMA
 * (collect) evresinde değil **koşum evresinde** ödenir: ya testin kendi
 * `testTimeout`unu ya da o an bekleyen bir `findBy*` sorgusunun
 * `asyncUtilTimeout` bütçesini yer. Ölçülen davranışla hiç ilgisi yoktur.
 *
 * Proje bu sınıfı ÜÇ ayrı pakette yaşadı ve her seferinde tek tek bulundu:
 *   • A7d2 — `PackagesPage` yüklemesi 10.093 ms, `OperatorSessions` 11.235 ms;
 *     `packingScreens`in İLK testi o ekranı hiç kullanmadığı hâlde düştü.
 *   • A7d3 — `PackageLabel`, `ip19Filo` ve `PackingLabelSheet`te ÜÇ zaman
 *     aşımı; üçü de dosyanın ilk testiydi.
 *   • A7d5 — kalan on iki dosya bu nöbetçiyle **tek seferde** bulundu.
 *
 * Karışık tohum koşumu bu sınıfı GÜVENİLİR biçimde bulamaz: kusur yalnız
 * yükleme ile paralel yük çakıştığında kırmızıya döner. A7d5'te 12 tohumun
 * hiçbiri kalan on iki dosyayı göstermedi (rapor · Görev 2). Statik tarama
 * ise hepsini deterministik bulur.
 *
 * ## Sözleşme
 *
 * Bir test dosyasında çalışma zamanında yüklenen her modül, AYNI dosyada
 * **statik** olarak da import edilmiş olmalıdır (yan etki importu yeter) — ya
 * da aşağıdaki gerekçeli listede adıyla yazılı olmalıdır.
 *
 * Tarama AST iledir: yorumda/dizede geçen `import(` yanlış pozitif üretmez.
 */
import { describe, expect, it } from "vitest";

import { korumasizTembeller, tabanTaramasi } from "../../scripts/tembel-modul.mjs";

/**
 * Gerekçeli istisnalar — **kimlikle** sabit, sayıyla değil.
 *
 * İkisinde de tembel yükleme testin KONUSUDUR; statik import onu ölçülemez
 * hâle getirirdi:
 *
 *   • `calismaZamaniKapisi` — 88 ekranı ekran başına ayrı testte mount eder;
 *     hangi ekranların ölçüleceği `import.meta.glob` ile ağaçtan türetilir.
 *     Statik liste yazmak kapıyı elle bakımı yapılan bir listeye indirger ve
 *     "yeni ekran sessizce ölçüm dışı kaldı" kusurunu geri getirir.
 *   • `zodTurkce` — `vi.resetModules()` sonrası `form.tsx`i TAZE
 *     değerlendirmek testin ta kendisidir (yan etkinin kimin tarafından
 *     kurulduğunu ölçer). Statik import bu iddiayı yok eder.
 */
const GEREKCELI = [
  // Manuel vitrin sökümü 593'e, YakindaRozeti kayıtlarının silinmesi 581'e,
  // eğitmen ön başvuru ekranının kapı kayıtları 592'ye taşıdı; merge sonrası
  // gerçek değer aşağıdaki koşuyla doğrulanır.
  //
  // 753: yeni panel dosyalarının (`MedyaSekmesi`, `MusteriListesi`) kapı
  // kayıtları satırı 705'ten 753'e kaydırdı. Dördüncü kayma: 685 → 701 → 705
  // → 753. Satır numarası kimliğin parçası çünkü aynı dosyada ikinci bir
  // `import.meta.glob` doğduğunda hangisinin gerekçeli olduğu ayırt edilemez;
  // bedeli her kaymada bu yorumu elle güncellemek —
  // bu satırın KENDİSİ hâlâ gerekçeli: `import.meta.glob` burada testin
  // KONUSUDUR. (Önceki kaydırma: 685 → 701, FormPage/TipSecimi'nin TOPLAMA
  // evresinde statik import edilmesi.)
  // 768: `UrunAracCubugu.tsx` kapı kayıtları (KAPI_KAPSAMI +
  // KONTROLSUZ_EKRANLAR) satırı 753'ten 768'e; 775: `GostergePaneli.tsx`
  // kayıtları 768'den 770'e; 776: `StokSayimiListesi`/`YeniSayimCekmecesi` kayıtları 770'den 779'a; sayım detayı kayıtları 779'dan 787'e; stok hareketleri kaydı 787'den 789'a; envanter genel bakış kaydı 789'dan 793'e; hasarlı stok kayıtları 793'ten 798'e; kategori kayıtları 798'den 803'e; iade kayıtları 803'ten 808'e; müşteri detayı kayıtları 808'den 815'e; tedarikçi/tanımlamalar kayıtları 815'ten 823'e kaydırdı.
  "src/__guards__/calismaZamaniKapisi.test.tsx:823 /src/**/*.tsx",
  "src/components/admin/ui2/zodTurkce.test.ts:49 ./form",
];

describe("İP-A7d5 · tembel modül nöbetçisi", () => {
  it("test ağacında gerekçesiz tembel modül yüklemesi YOK", () => {
    // Kimlik karşılaştırması: yeni bir tembel yükleme doğarsa da, listedeki
    // biri kaybolursa da kırılır. İkincisi doğru davranıştır — istisna
    // kapandığında listeden elle çıkarılır ve düşüş rapora yazılır.
    expect(tabanTaramasi()).toEqual(GEREKCELI);
  });

  /* ── Dedektörün kendi ters provaları (yalancı yeşile karşı) ── */

  it("statik karşılığı OLMAYAN `import()` YAKALANIR", () => {
    const kaynak = `
      import { it } from "vitest";
      it("x", async () => {
        const { default: Ekran } = await import("./Ekran");
        Ekran;
      });
    `;
    expect(korumasizTembeller(kaynak, "a.tsx").map((t) => t.belirtec)).toEqual(["./Ekran"]);
  });

  it("statik karşılığı OLAN aynı `import()` GEÇER (maliyet collect'te)", () => {
    const kaynak = `
      import "./Ekran";
      import { it } from "vitest";
      it("x", async () => { await import("./Ekran"); });
    `;
    expect(korumasizTembeller(kaynak, "a.tsx")).toEqual([]);
  });

  it("uzantı farkı kaçış yolu DEĞİLDİR (`./E.tsx` ≡ `./E`)", () => {
    const kaynak = `
      import E from "./E";
      const G = import.meta.glob("./E.tsx");
      G;
      E;
    `;
    expect(korumasizTembeller(kaynak, "a.tsx")).toEqual([]);
  });

  it("`import.meta.glob` dizi biçimi de sayılır", () => {
    const kaynak = `const G = import.meta.glob(["./A.tsx", "./B.tsx"]); G;`;
    expect(korumasizTembeller(kaynak, "a.tsx").map((t) => t.belirtec)).toEqual([
      "./A.tsx",
      "./B.tsx",
    ]);
  });

  it("YORUMDA ve DİZEDE geçen `import(` sayılmaz (AST, metin değil)", () => {
    const kaynak = `
      // await import("./Yorum")
      const s = 'await import("./Dize")';
      s;
    `;
    expect(korumasizTembeller(kaynak, "a.tsx")).toEqual([]);
  });

  it("yalnız TİP düzeyindeki `typeof import(...)` sayılmaz (maliyeti yoktur)", () => {
    const kaynak = `type M = typeof import("./Modul"); export type { M };`;
    expect(korumasizTembeller(kaynak, "a.ts")).toEqual([]);
  });
});
