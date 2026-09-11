/**
 * PANEL AKSAN RENGİ nöbetçisi.
 *
 * ## Neden bu dosya var
 *
 * `panel/theme.ts` AntD'ye somut bir hex renk vermek ZORUNDA (çalışma
 * zamanında CSS değişkeni okuyamaz, jsdom'da `--marka` zaten boş gelir) —
 * bu yüzden `panel/theme.ts` içinde `--marka` ve `--marka-fg`nin SABİT bir
 * kopyası tutuluyor. İki kopya arasında ikinci bir doğruluk kaynağı
 * doğmasın diye bu nöbetçi her koşuda `index.css`'teki GERÇEK değeri okur ve
 * `panelTheme`nin gerçekte ihraç ettiği değerle KARŞILAŞTIRIR.
 *
 * `markaAksani.test.ts` (bu dizinde) `index.css`'in KENDİ İÇİNDEKİ
 * tutarlılığını (`--panel-accent: var(--marka)` vb.) sınar; o dosya AntD'yi
 * hiç bilmez çünkü panel'in kendi ayrı bir sabiti olduğunu varsaymaz. Bu
 * dosya köprünün DIŞARIDAN (index.css → theme.ts) hâlâ doğru kurulduğunu
 * sınar — geçmişte tam bunun tersi oldu: panel `#C2410C` adında, markanın
 * terk edilmiş ilk taslağına takılı kalmış bir sabit taşıyordu ve hiçbir
 * test bunu yakalamıyordu.
 *
 * Sapma olduğunda mesaj NE YAPILACAĞINI söyler: `index.css`'teki `--marka`
 * (veya `--marka-fg`) değişti, `panel/theme.ts` içindeki sabiti güncelle.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { panelTheme } from "@/panel/theme";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);

const css = readFileSync(join(KOK, "src", "index.css"), "utf8");

/** `:root` bloğundan bir token'ın HAM değerini okur (boşluklu RGB üçlüsü). */
function hamKok(ad: string): string {
  const govde = css.match(/:root\s*\{([\s\S]*?)\n  \}/m)?.[1] ?? "";
  if (!govde) throw new Error("index.css içinde `:root` bloğu bulunamadı");
  const deger = govde.match(new RegExp(`--${ad}:\\s*([^;]+);`))?.[1];
  if (!deger) throw new Error(`:root içinde --${ad} yok`);
  return deger.trim();
}

/** "255 153 0" biçimindeki boşluklu RGB üçlüsünü "#FF9900"e çevirir. */
function ucluDenHex(uclu: string): string {
  const parcalar = uclu.split(/\s+/).map(Number);
  if (
    parcalar.length !== 3 ||
    parcalar.some((n) => !Number.isFinite(n) || n < 0 || n > 255)
  ) {
    throw new Error(`RGB üçlüsü değil: "${uclu}"`);
  }
  return (
    "#" +
    parcalar.map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()
  );
}

/**
 * Saf karşılaştırma — nöbetçinin "kendi kendine sınama" düğümü bu
 * fonksiyonu gerçek dosyalardan BAĞIMSIZ, uydurma girdilerle çağırıp
 * kırmızıya döndüğünü kanıtlar.
 */
function eslesiyorMu(cssHex: string, temaDegeri: string | undefined): boolean {
  return typeof temaDegeri === "string" && temaDegeri.toUpperCase() === cssHex;
}

describe("panel aksan rengi · index.css ile theme.ts arasındaki köprü", () => {
  it("colorPrimary === --marka (panel kendi değerini TUTMAZ, markaya takma ad)", () => {
    const cssHex = ucluDenHex(hamKok("marka"));
    expect(
      eslesiyorMu(cssHex, panelTheme.token?.colorPrimary),
      `index.css'teki --marka değişti (şimdi ${cssHex}); panel/theme.ts içindeki MARKA sabitini güncelle`
    ).toBe(true);
  });

  it("colorTextLightSolid === --marka-fg (dolgu PARLAK + üstündeki yazı KOYU kuralı AntD birincil düğmede de geçerli)", () => {
    const cssHex = ucluDenHex(hamKok("marka-fg"));
    expect(
      eslesiyorMu(cssHex, panelTheme.token?.colorTextLightSolid),
      `index.css'teki --marka-fg değişti (şimdi ${cssHex}); panel/theme.ts içindeki MARKA_USTU_YAZI sabitini güncelle`
    ).toBe(true);
  });

  it("kendi kendine sınama: uydurma bir sapma bu kıyası KIRMIZIYA döndürür", () => {
    const cssHex = ucluDenHex(hamKok("marka"));
    // Uydurma yanlış değer → eşleşmemeli.
    expect(eslesiyorMu(cssHex, "#000000")).toBe(false);
    // Tanımsız tema değeri → eşleşmemeli.
    expect(eslesiyorMu(cssHex, undefined)).toBe(false);
    // Büyük/küçük harf farkı gerçek bir sapma SAYILMAZ.
    expect(eslesiyorMu(cssHex, cssHex.toLowerCase())).toBe(true);
  });

  it("tarama gerçekten index.css'e bakıyor (yalancı yeşil kapısı)", () => {
    expect(css.length).toBeGreaterThan(1000);
    expect(css).toContain("--marka:");
    expect(css).toContain("--marka-fg:");
  });
});
