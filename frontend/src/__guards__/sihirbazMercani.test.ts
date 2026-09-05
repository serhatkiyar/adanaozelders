/**
 * İlan sihirbazının mercan aksanı — SIZMA nöbetçisi.
 *
 * ## Karar
 *
 * `/ilanini-olustur` Superprof'un görünüşünü alıyor (mercan aksan, dolgulu
 * bilgi kartı, kalın başlık). Bu, `docs/tasarim-dili.md`nin iki kuralını bu
 * ekranlar için bilerek deliyor ve kapsamı TEK SAYFAYLA sınırlı.
 *
 * ## Bu nöbetçi neden var
 *
 * Kapsamı yazılı bir kararla sınırlamak yetmiyor: bir sonraki oturum "sihirbazda
 * böyle yapılmış" diyerek aynı rengi başka bir ekrana taşıyabilir ve kimse fark
 * etmez. Sitenin geri kalanı indigo; iki aksanın karışması, marka kararının
 * sessizce buharlaşması demek olurdu.
 *
 * Aşağıdaki eşik bir TAVAN değil TABAN: mercan hex'i `tutorOnboarding` dışında
 * bir dosyada doğduğu gün CI kırılır ve dosya adıyla görünür.
 *
 * ## Gücü ve sınırı
 *
 * KAYNAK SÖZLEŞMESİ testidir: "ekran gerçekten mercan çiziyor" iddiasını jsdom
 * kanıtlayamaz (Tailwind sınıfı burada hesaplanan bir renge dönüşmez). İşi tek:
 * kapsamın sessizce genişleyememesi.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  "..",
);

/** Temanın kullandığı hex'ler — `pages/tutorOnboarding/tema.ts` ile aynı küme. */
const MERCAN_HEX = /#(F2695E|E05548|FDEFEE|FBDCD9|B33A2E|7A3B34)\b/i;

const SATIR_SONU = new RegExp("\r?\n");

/** İstisnanın geçerli olduğu TEK ağaç. */
const IZINLI = "src/pages/tutorOnboarding";

/** Yorum satırlarını atar: bir yorumun rengi anması tarihtir, borç değil. */
function yorumsuz(metin: string): string {
  return metin
    .split(/\r?\n/)
    .filter((satir) => {
      const k = satir.trim();
      return !k.startsWith("//") && !k.startsWith("*") && !k.startsWith("/*");
    })
    .join("\n");
}

function kaynakDosyalari(): string[] {
  const cikti: string[] = [];
  const yuru = (dizin: string) => {
    for (const ad of readdirSync(dizin).sort()) {
      const tam = join(dizin, ad);
      if (statSync(tam).isDirectory()) {
        yuru(tam);
        continue;
      }
      if (!/\.(tsx?|css)$/.test(ad)) continue;
      cikti.push(tam);
    }
  };
  yuru(join(KOK, "src"));
  return cikti;
}

function mercanBulgulari(): string[] {
  const bulgular: string[] = [];
  for (const dosya of kaynakDosyalari()) {
    // Nöbetçinin kendisi hex'i tanımı gereği taşır.
    if (dosya.endsWith("sihirbazMercani.test.ts")) continue;
    const satirlar = readFileSync(dosya, "utf8").split(/\r?\n/);
    satirlar.forEach((satir, i) => {
      // Yorum satırları HARİÇ: bir yorumun rengi anması tarihtir, borç değil.
      const kirpik = satir.trim();
      if (
        kirpik.startsWith("//") ||
        kirpik.startsWith("*") ||
        kirpik.startsWith("/*")
      )
        return;
      if (MERCAN_HEX.test(satir)) {
        bulgular.push(`${relative(KOK, dosya).split(sep).join("/")}:${i + 1}`);
      }
    });
  }
  return bulgular;
}

describe("sihirbaz mercanı yalnız sihirbazda", () => {
  it("mercan hex'i `pages/tutorOnboarding` DIŞINA çıkmaz", () => {
    const disarida = mercanBulgulari().filter(
      (y) => !y.startsWith(`${IZINLI}/`),
    );
    expect(
      disarida,
      "mercan aksan sihirbaz dışına sızmış — istisnanın kapsamı tek sayfaydı",
    ).toEqual([]);
  });

  it("tarama gerçekten `src/` ağacına bakıyor (yalancı yeşil kapısı)", () => {
    // Boş bir dosya listesi de `[]` bulgu üretirdi. Kapsam hem SAYIYLA hem
    // KİMLİKLE çıpalanır.
    const dosyalar = kaynakDosyalari().map((d) =>
      relative(KOK, d).split(sep).join("/"),
    );
    expect(dosyalar.length).toBeGreaterThan(200);
    expect(dosyalar).toContain("src/index.css");
    expect(dosyalar).toContain("src/components/NavbarWidget.tsx");
    expect(dosyalar).toContain(`${IZINLI}/tema.ts`);
  });

  it("renk Tailwind token'ı DEĞİL — config mercanı tanımıyor", () => {
    // Token eklemek rengi tüm siteden erişilebilir kılar ve panel token
    // ailesiyle karışırdı; kapsam kilidi bu yüzden config'te de sınanıyor.
    const cfg = readFileSync(join(KOK, "tailwind.config.js"), "utf8");
    expect(MERCAN_HEX.test(cfg)).toBe(false);
  });

  it("tema dosyası sınıfları TAM DİZE olarak yazıyor", () => {
    // Parçalanmış `bg-[${x}]` Tailwind'in tarayıcısı tarafından görülmez ve
    // sessizce hiçbir şey üretmez — düğme şeffaf kalır, kimse fark etmez.
    // Yorumlar elenir: tema dosyasının kendi açıklaması, kaçınılması gereken
    // biçimi örnek olarak anıyor.
    const tema = readFileSync(join(KOK, IZINLI, "tema.ts"), "utf8");
    expect(tema).toContain('"bg-[#F2695E]"');
    expect(tema).toContain('"bg-[#FDEFEE]"');
    expect(yorumsuz(tema)).not.toMatch(/bg-\[\$\{/);
  });
});
