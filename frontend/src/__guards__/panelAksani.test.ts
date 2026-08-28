/**
 * İP-B2 · Ç-3 — marka aksanı nöbetçisi.
 *
 * ## Karar
 *
 * Panel aksanı `indigo-600` değil, marka lacivertidir (`#1A365D`). Zemin,
 * kenarlık ve metin NÖTR kalır (slate ailesi); marka yalnız üç yerde görünür:
 * etkin gezinme öğesi, birincil düğme, odak halkası. Turuncu (`#F6AD55`)
 * aksan DEĞİL **dikkat rengidir** ve yalnız uyarı/bekleyen iş rozetlerinde
 * yaşar.
 *
 * ## Bu nöbetçi neden var
 *
 * İP-B1 aksanı bilerek çevirmedi ve gerekçesini yazdı: "aksanı yalnız kabukta
 * çevirmek paneli yarı lacivert yarı indigo bırakırdı." Aynı risk göç
 * sırasında da geçerli — 22 liste ekranından yalnız biri bu pakette göç
 * ediyor. Eğer aksan yalnız göç eden ekranlarda çevrilseydi, panelin geri
 * kalanı indigo kalırdı ve kimse fark etmezdi.
 *
 * Bu yüzden değişiklik **token katmanında** yapıldı ve panel ağacındaki
 * `indigo-` sınıflarının tamamı süpürüldü. Aşağıdaki eşik `toEqual([])`, yani
 * bir TAVAN değil bir TABAN: panelde yeni bir `indigo-` sınıfı doğduğu gün CI
 * kırılır ve hangi dosyada doğduğu isimle görünür.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * KAYNAK SÖZLEŞMESİ testidir, düşük güçlüdür: "ekran gerçekten lacivert
 * çiziyor" iddiasını jsdom kanıtlayamaz (Tailwind sınıfları burada hesaplanan
 * bir renge dönüşmez). Davranış kanıtı gerçek Chrome turundadır
 * (`docs/ip-b2/kontrast.json`): iki temada hesaplanan `background-color` ve
 * kontrast oranları ölçülür.
 *
 * Buradaki işi tek: kararın **sessizce geri alınamaması** ve borcun sessizce
 * büyüyememesi.
 *
 * ## Kapsam neden `admin/` ağacıyla sınırlı
 *
 * `indigo` public sitede de kullanılıyor (`NavbarWidget`, `DashboardShell`,
 * pazaryeri kartları…). Marka kararı bu turda PANEL için verildi; public
 * yüzeyi aynı turda çevirmek, ölçülmemiş bir tasarım değişikliğini kaçak
 * yolcu olarak taşırdı. Kapsam bu yüzden isimle sınırlı ve sınırın kendisi
 * de aşağıda test ediliyor (public ağaç taranmadığı için "0 bulgu" iddiası
 * yanıltıcı olmasın).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const KOK = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");

/** Aksan kararının yürürlükte olduğu ağaçlar (public site DEĞİL). */
const PANEL_AGACLARI = ["src/components/admin", "src/pages/admin"];

function panelDosyalari(): string[] {
  const cikti: string[] = [];
  const yuru = (dizin: string) => {
    for (const ad of readdirSync(dizin).sort()) {
      const tam = join(dizin, ad);
      if (statSync(tam).isDirectory()) {
        yuru(tam);
        continue;
      }
      if (!/\.tsx?$/.test(ad) || /\.test\.tsx?$/.test(ad)) continue;
      cikti.push(tam);
    }
  };
  for (const agac of PANEL_AGACLARI) yuru(join(KOK, agac));
  return cikti;
}

/** `indigo-<n>` biçimindeki Tailwind sınıfları (yorumdaki geçişler dahil değil). */
function indigoBulgulari(): string[] {
  const bulgular: string[] = [];
  for (const dosya of panelDosyalari()) {
    const satirlar = readFileSync(dosya, "utf8").split(/\r?\n/);
    satirlar.forEach((satir, i) => {
      // Yorum satırları HARİÇ: bir yorumun "eskiden indigo-600'dü" demesi
      // borç değil, tarihtir. Kural sınıfın kendisine bakar.
      const kirpik = satir.trim();
      if (kirpik.startsWith("//") || kirpik.startsWith("*") || kirpik.startsWith("/*")) return;
      if (/indigo-\d/.test(satir)) {
        bulgular.push(`${relative(KOK, dosya).split(sep).join("/")}:${i + 1}`);
      }
    });
  }
  return bulgular;
}

describe("İP-B2 · Ç-3 · panelde indigo kalmadı", () => {
  it("panel ağacında `indigo-` sınıfı SIFIR (tavan değil TABAN)", () => {
    expect(
      indigoBulgulari(),
      "panel yarı lacivert yarı indigo — Ç-3 kararının açıkça yasakladığı hâl"
    ).toEqual([]);
  });

  it("tarama gerçekten panel ağacına bakıyor (yalancı yeşil kapısı)", () => {
    // Boş bir dosya listesi de `[]` bulgu üretirdi. Kapsamın ayakta olduğu
    // hem sayıyla hem KİMLİKLE çıpalanır.
    const dosyalar = panelDosyalari().map((d) => relative(KOK, d).split(sep).join("/"));
    expect(dosyalar.length).toBeGreaterThan(40);
    expect(dosyalar).toContain("src/components/admin/ui/Button.tsx");
    expect(dosyalar).toContain("src/components/admin/data-table/DataTable.tsx");
    expect(dosyalar).toContain("src/pages/admin/AdminDashboardPage.tsx");
  });
});

describe("İP-B2 · Ç-3 · token değerleri kararın TA KENDİSİ", () => {
  const css = readFileSync(join(KOK, "src", "index.css"), "utf8");

  /** `:root` bloğundan tek bir token değerini okur. (`.dark` bloğu dark mode sökümüyle kalktı.) */
  function token(blok: ":root", ad: string): string {
    const desen = new RegExp(`${blok.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\n  \\}`, "m");
    const govde = css.match(desen)?.[1] ?? "";
    const deger = govde.match(new RegExp(`--${ad}:\\s*([^;]+);`))?.[1];
    if (!deger) throw new Error(`${blok} içinde --${ad} yok`);
    return deger.trim();
  }

  it("açık temada aksan MARKA LACİVERTİ (#1A365D)", () => {
    // Değer testte yazılı olmasaydı, aksanın sessizce başka bir renge
    // kaymasını hiçbir şey tutmazdı: "token kullanılıyor" iddiası rengin ne
    // olduğunu söylemez.
    expect(token(":root", "panel-accent")).toBe("26 54 93");
    expect(token(":root", "panel-focus")).toBe("26 54 93");
    // Üstündeki metin beyaz (ölçülen kontrast 12,14).
    expect(token(":root", "panel-accent-fg")).toBe("255 255 255");
  });

  // (Tarihçe: "koyu temada aksan açık uç" testi vardı; dark mode CMS turunda
  // söküldü — `.dark` token bloğu yok, tek tema nöbetçisi `tekTema.test.ts`.)

  it("dikkat rengi (#F6AD55) TANIMLI ve aksandan AYRI", () => {
    expect(token(":root", "panel-attention")).toBe("246 173 85");
    // Aksan ile dikkat rengi AYNI olamaz: aynı olsalardı birincil düğme ile
    // "bekleyen iş" rozeti aynı rengi taşırdı ve renk anlamını kaybederdi.
    expect(token(":root", "panel-attention")).not.toBe(token(":root", "panel-accent"));
  });

  it("Tailwind köprüsü üç dikkat token'ını da sınıfa çeviriyor", () => {
    // Token tanımlı ama köprülenmemişse `bg-panel-attention-soft` sessizce
    // HİÇBİR ŞEY üretmez — rozet şeffaf kalır ve kimse fark etmez.
    const cfg = readFileSync(join(KOK, "tailwind.config.js"), "utf8");
    for (const ad of ["--panel-attention", "--panel-attention-soft", "--panel-attention-fg"]) {
      expect(cfg, `${ad} Tailwind'e köprülenmemiş`).toContain(`rgb(var(${ad}) / <alpha-value>)`);
    }
  });
});
