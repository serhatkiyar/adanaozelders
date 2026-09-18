// @vitest-environment node
/**
 * İlan sihirbazı SİTENİN rengini kullanır — nöbetçi.
 *
 * ## Değişen karar (kullanıcı, 7 Eyl 2026)
 *
 * Bu dosya 5 Eyl'de TERSİNİ çıpalıyordu: sihirbaz mercan bir hex ailesi
 * (`#F2695E`) taşıyordu ve nöbetçinin işi o rengin sihirbaz DIŞINA
 * sızmamasıydı. Kullanıcı ekranı görüp *"orada renkler turuncu değil kırmızı"*
 * dedi. İtiraz haklıydı: ilan oluşturma markanın en kritik akışı ve orada
 * başka bir marka rengi görünüyordu.
 *
 * Ham hex'lerin tamamı kalktı; sihirbaz artık marka token'larını kullanıyor.
 * İstisna kapanınca nöbetçinin işi de tersine döndü: eskiden "renk dışarı
 * sızmasın" diyordu, şimdi "sihirbazda ham renk KALMASIN" diyor.
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * Sessizce yanlış gidebilecek iki şey var:
 *
 *   1. Biri sihirbaza yeniden ham bir hex yazar ("burası zaten ayrı rejimdi").
 *      O gün sihirbaz ton değişimlerinden kopar ve site yarım turuncu kalır.
 *   2. Dolgunun üstüne `text-white` yazılır. Marka turuncusu PARLAK dolgudur;
 *      beyaz yazı 2,4 verir ve okunmaz (ÜK-1). Eski mercan koyu olduğu için
 *      beyaz yazı ORADA doğruydu — göç sırasında kalan bir `text-white`
 *      hiçbir derleme hatası üretmez, sadece okunmaz.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * KAYNAK SÖZLEŞMESİ testidir: "ekran gerçekten turuncu çiziyor" iddiasını
 * jsdom kanıtlayamaz (Tailwind sınıfı burada hesaplanan renge dönüşmez).
 * Çalışma zamanı kanıtı gerçek Chrome turundadır.
 */import { readFileSync, readdirSync, statSync } from "node:fs";
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

describe("sihirbaz sitenin rengini kullanır", () => {
  it("sihirbaz ağacında ham mercan hex'i KALMADI", () => {
    const kalan = mercanBulgulari().filter((y) => y.startsWith(`${IZINLI}/`));
    expect(
      kalan,
      "sihirbazda ham hex var — marka token'ı kullanılmalı (ÜK-1)",
    ).toEqual([]);
  });

  it("hex sitenin HİÇBİR yerinde yok", () => {
    // Eski istisna kapandı: artık ne içeride ne dışarıda.
    expect(mercanBulgulari()).toEqual([]);
  });

  it("tema marka token'larına bağlı (DOLULUK)", () => {
    // Boş bir tema dosyası yukarıdaki iki "yok" iddiasını bedava geçirirdi.
    const tema = readFileSync(join(KOK, IZINLI, "tema.ts"), "utf8");
    for (const beklenen of [
      '"bg-marka"',
      '"hover:bg-marka-hover"',
      '"text-marka-metin"',
      '"bg-marka-soft"',
      '"text-marka-fg"',
    ]) {
      expect(tema, `tema '${beklenen}' taşımıyor`).toContain(beklenen);
    }
    // Sınıflar TAM DİZE: parçalanmış `bg-[${x}]` Tailwind tarayıcısınca
    // görülmez ve sessizce hiçbir şey üretmez.
    expect(yorumsuz(tema)).not.toMatch(/bg-\[\$\{/);
  });

  it("PARLAK dolgunun üstüne beyaz yazı yazılmaz (ÜK-1)", () => {
    // Göç tuzağı: eski mercan koyuydu, `text-white` orada doğruydu. Kalan bir
    // tane hiçbir derleme hatası üretmez, sadece okunmaz.
    const kacaklar: string[] = [];
    for (const dosya of kaynakDosyalari()) {
      const kisa = relative(KOK, dosya).split(sep).join("/");
      if (!kisa.startsWith(`${IZINLI}/`)) continue;
      readFileSync(dosya, "utf8")
        .split(SATIR_SONU)
        .forEach((satir, i) => {
          if (/bg-marka/.test(satir) && /text-white/.test(satir)) {
            kacaklar.push(`${kisa}:${i + 1}`);
          }
        });
    }
    expect(kacaklar, "marka dolgusunun üstünde beyaz yazı").toEqual([]);
  });

  it("tarama gerçekten `src/` ağacına bakıyor (yalancı yeşil kapısı)", () => {
    // Boş bir dosya listesi de `[]` bulgu üretirdi. Kapsam hem SAYIYLA hem
    // KİMLİKLE çıpalanır.
    const dosyalar = kaynakDosyalari().map((d) =>
      relative(KOK, d).split(sep).join("/"),
    );
    expect(dosyalar.length).toBeGreaterThan(200);
    expect(dosyalar).toContain("src/index.css");
    expect(dosyalar).toContain(`${IZINLI}/tema.ts`);
  });
});
