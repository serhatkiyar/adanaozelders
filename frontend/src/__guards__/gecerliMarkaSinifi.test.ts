/**
 * Marka/dikkat token sınıflarının GERÇEKTEN CSS ürettiğinin nöbetçisi.
 *
 * ## Bu nöbetçi neden var — ölçülmüş bir kaza
 *
 * 1.104 `indigo-` sınıfı token'lara süpürülürken eşleme `shadow-indigo-500`i
 * `shadow-marka/20`ye çeviriyordu. Ama beş çağrı yerinde sınıfın ZATEN kendi
 * saydamlığı vardı (`shadow-indigo-500/20`) ve sonuç `shadow-marka/20/20`
 * oldu — Tailwind'de geçersiz bir sınıf.
 *
 * Kaza şuydu: **`npm run build` bunu yakalamadı ve YEŞİL geçti.** Tailwind
 * tanımadığı bir sınıfı hata saymaz, sessizce hiçbir kural üretmez. Yani
 * gölge tümüyle kayboluyordu ve ne tsc, ne ESLint, ne 2200 birim testi bunu
 * görebilirdi; yalnız ekrana bakan bir insan görebilirdi.
 *
 * Aynı sessizlik daha kötü bir biçimde de gelir: `bg-marka-sof` (harf düşmesi)
 * ya da C3'te silinmiş bir token adı. Sınıf "geçerli görünür", build geçer,
 * düğme ZEMİNSİZ çizilir.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * KAYNAK SÖZLEŞMESİ testidir. "Ekranda gölge gerçekten çıkıyor" iddiasını
 * kanıtlamaz; iddiası daha dar ve tam olarak kazanın sınıfını kapsar:
 * yazılan her `marka`/`dikkat` sınıfının karşılığı Tailwind köprüsünde VARDIR
 * ve saydamlık sözdizimi bozuk DEĞİLDİR. Davranış kanıtı gerçek Chrome
 * turundadır.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);

function kaynakDosyalari(): string[] {
  const cikti: string[] = [];
  const yuru = (dizin: string) => {
    for (const ad of readdirSync(dizin).sort()) {
      const tam = join(dizin, ad);
      if (statSync(tam).isDirectory()) {
        if (ad === "node_modules") continue;
        yuru(tam);
        continue;
      }
      if (!/\.tsx?$/.test(ad) || /\.test\.tsx?$/.test(ad)) continue;
      cikti.push(tam);
    }
  };
  yuru(join(KOK, "src"));
  return cikti;
}

const kisaAd = (dosya: string) => relative(KOK, dosya).split(sep).join("/");

/**
 * `tailwind.config.js`ten `marka` ve `dikkat` renk ailelerinin GERÇEK
 * anahtarlarını okur. Liste teste elle yazılsaydı, köprüden bir anahtar
 * silindiğinde nöbetçi hâlâ yeşil kalırdı.
 */
function kopruAnahtarlari(aile: "marka" | "dikkat"): Set<string> {
  const cfg = readFileSync(join(KOK, "tailwind.config.js"), "utf8");
  const blok = cfg.match(new RegExp(`\\n        ${aile}: \\{([\\s\\S]*?)\\n        \\},`))?.[1];
  if (!blok) throw new Error(`tailwind.config.js içinde \`${aile}\` ailesi yok`);
  const anahtarlar = new Set<string>();
  for (const m of blok.matchAll(/^\s*(?:"([a-z-]+)"|([A-Za-z]+)):/gm)) {
    anahtarlar.add(m[1] ?? m[2]);
  }
  return anahtarlar;
}

/** Kaynakta geçen tüm `<yardımcı>-<aile>[-<anahtar>][/<saydamlık>]` jetonları. */
function markaSiniflari(): { dosya: string; satir: number; sinif: string }[] {
  const bulgular: { dosya: string; satir: number; sinif: string }[] = [];
  const desen = /(?<![\w-])[a-z]+(?:-[a-z]+)*-(?:marka|dikkat)(?:-[a-z-]+)?(?:\/\d+)*/g;
  for (const dosya of kaynakDosyalari()) {
    readFileSync(dosya, "utf8")
      .split(/\r?\n/)
      .forEach((satir, i) => {
        const k = satir.trim();
        if (k.startsWith("//") || k.startsWith("*") || k.startsWith("/*")) return;
        for (const m of satir.matchAll(desen)) {
          bulgular.push({ dosya: kisaAd(dosya), satir: i + 1, sinif: m[0] });
        }
      });
  }
  return bulgular;
}

describe("marka/dikkat sınıfları gerçekten CSS üretir", () => {
  const bulgular = markaSiniflari();

  it("tarama gerçekten sınıf buluyor (yalancı yeşil kapısı)", () => {
    // Boş bir liste aşağıdaki iki iddiayı da BEDAVA geçirirdi.
    expect(bulgular.length).toBeGreaterThan(900);
    const dosyalar = new Set(bulgular.map((b) => b.dosya));
    expect(dosyalar.size).toBeGreaterThan(100);
    expect(dosyalar).toContain("src/pages/Marketplace.tsx");
    expect(dosyalar).toContain("src/components/AuthModal.tsx");
  });

  it("hiçbir sınıfta ÇİFT saydamlık yok (`shadow-marka/20/20`)", () => {
    // Süpürmenin gerçek kazası buydu: eşleme kendi `/20`sini eklerken çağrı
    // yerinin kendi saydamlığı zaten oradaydı. Tailwind sessizce hiçbir kural
    // üretmedi ve gölge tümüyle kayboldu.
    const bozuk = bulgular
      .filter((b) => (b.sinif.match(/\//g) ?? []).length > 1)
      .map((b) => `${b.dosya}:${b.satir} → ${b.sinif}`);
    expect(bozuk, "çift saydamlık = Tailwind'in sessizce yuttuğu geçersiz sınıf").toEqual([]);
  });

  it("her sınıfın karşılığı Tailwind köprüsünde TANIMLI", () => {
    const aileler = { marka: kopruAnahtarlari("marka"), dikkat: kopruAnahtarlari("dikkat") };
    // Köprü gerçekten okunabildi mi (dosya biçimi değişirse boş küme dönerdi).
    expect(aileler.marka.has("DEFAULT")).toBe(true);
    expect(aileler.marka.size).toBeGreaterThan(5);
    expect(aileler.dikkat.size).toBeGreaterThan(2);

    const tanimsiz: string[] = [];
    for (const b of bulgular) {
      const govde = b.sinif.split("/")[0];
      const m = govde.match(/-(marka|dikkat)(?:-([a-z-]+))?$/);
      if (!m) continue;
      const aile = m[1] as "marka" | "dikkat";
      const anahtar = m[2] ?? "DEFAULT";
      if (!aileler[aile].has(anahtar)) {
        tanimsiz.push(`${b.dosya}:${b.satir} → ${b.sinif} (\`${aile}.${anahtar}\` köprüde yok)`);
      }
    }
    expect(
      tanimsiz,
      "köprüde karşılığı olmayan sınıf: build YEŞİL geçer, ekranda hiçbir şey çizilmez"
    ).toEqual([]);
  });
});
