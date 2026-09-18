// @vitest-environment node
/**
 * TB-71 · `<AuthModal />` TEK YERDE monte edilir.
 *
 * ## Neden nöbetçi gerekiyor
 *
 * Kusur "kaydırma kilidi bozuk" gibi görünüyordu ama kökü buydu: giriş
 * penceresi `App.tsx`te `<Routes>`un dışında (her rotada) **ve** ayrıca
 * `StoreLayout` ile `PublicShell` kabuklarında render ediliyordu. Üçü de aynı
 * URL parametresini (`?modal=login`) okuduğu için birlikte açılıyor, iki
 * `useModalA11y` örneği doğuyordu.
 *
 * Kilit artık sayaca bağlı (`hooks/kaydirmaKilidi.test.tsx`), yani ikinci bir
 * montaj kaydırmayı tek başına kilitlemez. Ama çift montaj kendi başına da
 * kusurdur: aynı formun iki kopyası DOM'da yaşar (`role="dialog"` sayısı 2),
 * ekran okuyucu iki "Giriş yap" penceresi görür ve odak tuzağı iki paneli
 * birden döngüye almaya çalışır. Kabuğa kopya eklemek ucuz ve doğal bir
 * hamledir — bu yüzden yasak KODLA yazılır, yorumla değil.
 *
 * ## Testin gücü ve SINIRI (CLAUDE.md §C)
 *
 * Bu bir KAYNAK SÖZLEŞMESİ testidir, yani düşük güçlüdür: "pencere gerçekten
 * açılıyor mu" sorusunu cevaplamaz. Sınır bilinçli olarak dar tutuldu — tek
 * iddiası "bu bileşen kaç yerde render ediliyor".
 *
 * Sayım AST ile yapılır (`ts.createSourceFile`): dosyaların başındaki
 * "burada AuthModal YOKTUR" açıklamaları metin taramasında **yanlış pozitif**
 * üretirdi — bu tuzağa düşmemek için yorumlar hiç görülmez. Bu dosyanın
 * kendisi de taranan ağacın dışındadır (`__guards__` hariç tutulmaz; test
 * dosyaları ayıklanır).
 *
 * Davranış yarısı: `hooks/kaydirmaKilidi.test.tsx` (gerçek DOM) ve gerçek
 * Chrome turu (`docs/ip-a9-rapor.md`).
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import fg from "fast-glob";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const KOK = join(__dirname, "..");

/** Bir dosyadaki `<AuthModal …>` JSX kullanımlarının sayısı (yorumlar HARİÇ). */
function montajSayisi(kaynak: string, dosya: string): number {
  const agac = ts.createSourceFile(dosya, kaynak, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let sayi = 0;
  const gez = (dugum: ts.Node) => {
    if (ts.isJsxSelfClosingElement(dugum) || ts.isJsxOpeningElement(dugum)) {
      if (dugum.tagName.getText(agac) === "AuthModal") sayi += 1;
    }
    ts.forEachChild(dugum, gez);
  };
  ts.forEachChild(agac, gez);
  return sayi;
}

describe("TB-71 · AuthModal tek montaj", () => {
  it("üretim ağacında YALNIZ `App.tsx` render ediyor", async () => {
    const dosyalar = await fg(["**/*.tsx"], {
      cwd: KOK,
      absolute: true,
      ignore: ["**/*.test.tsx", "**/__guards__/**", "**/__mocks__/**"],
    });

    const montajlar: Record<string, number> = {};
    for (const yol of dosyalar) {
      const sayi = montajSayisi(readFileSync(yol, "utf8"), yol);
      if (sayi > 0) montajlar[relative(KOK, yol).split(sep).join("/")] = sayi;
    }

    expect(montajlar).toEqual({ "App.tsx": 1 });
  });

  it("nöbetçi gerçekten sayıyor (kendi kendini doğrulama)", () => {
    // Ters prova bu testin İÇİNDE: sayaç bozuksa (ör. hep 0 dönüyorsa)
    // yukarıdaki iddia da sessizce geçerdi.
    expect(montajSayisi("const a = <AuthModal />;\n", "x.tsx")).toBe(1);
    expect(montajSayisi("const a = <AuthModal></AuthModal>;\n", "x.tsx")).toBe(1);
    // Yorumdaki kullanım SAYILMAZ — bu dosyanın var oluş sebebi olan tuzak.
    expect(montajSayisi("// <AuthModal /> burada yoktur\nconst a = 1;\n", "x.tsx")).toBe(0);
    expect(montajSayisi("/* <AuthModal /> */\nconst a = 1;\n", "x.tsx")).toBe(0);
    // Metindeki kullanım da sayılmaz.
    expect(montajSayisi('const s = "<AuthModal />";\n', "x.tsx")).toBe(0);
  });
});
