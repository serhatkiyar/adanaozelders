/**
 * Ç-4 — SİTE marka aksanı nöbetçisi.
 *
 * ## Karar
 *
 * Aksan turuncudur (`#C2410C`). Zemin, kenarlık ve gövde metni NÖTR kalır
 * (slate ailesi); marka aksan olarak girer — etkin gezinme öğesi, birincil
 * düğme, odak halkası — ve sıcak zemin `--marka-soft` (#FFF7ED) ile
 * sınırlıdır: hover, seçili satır, yumuşak bilgi kartı.
 *
 * ## TARİHÇE — bu dosya iki kez karar değiştirdi
 *
 * Ç-3 (İP-B2) tam TERSİNİ söylüyordu: aksan marka lacivertiydi (`#1A365D`) ve
 * turuncu `#F6AD55` "aksan DEĞİL dikkat rengi"ydi. Gerekçesi de yazılıydı:
 * *"birincil düğme turuncu olursa aynı ekranda hem 'yap' hem 'dikkat et'
 * anlamına gelir."* Bu nöbetçi o kararı korumak için yazılmıştı ve içindeki
 * `panel-attention !== panel-accent` düğümü tam olarak bugünkü değişikliği
 * engellemek içindi.
 *
 * Karar, gerekçesi kullanıcıya iletildikten SONRA kullanıcı tarafından
 * bilerek tersine çevrildi (Ç-4). Bu bir ölçüm düzeltmesi değil ÜRÜN
 * YARGISIdır ve `docs/tasarim-dili.md` §1.4 böyle yazar. Eski karar metni
 * silinmedi, tarihçe olarak orada durur.
 *
 * Ç-3'ün endişesi ortadan kalkmadı, ÇÖZÜM DEĞİŞTİ: aksan ile dikkat artık
 * HUE ile değil DEĞER ve BİÇİM ile ayrılır.
 *
 *     aksan  = KOYU dolgu + AÇIK metin      (#C2410C / beyaz — 5,18)
 *     dikkat = AÇIK zemin + KOYU metin      (#FEF3C7 / #78350F — 8,15)
 *
 * Uyarı asla dolgulu düğme olmaz. Aşağıdaki dört düğüm bu cümlenin makinece
 * okunabilir hâlidir; `!==` karşılaştırması onun yerini alamazdı çünkü iki
 * renk artık aynı ailedendir ve "farklı olmaları" hiçbir şey kanıtlamaz.
 *
 * ## Kapsam neden artık `src/**`
 *
 * Ç-3 kapsamı bilerek panelle sınırlamıştı; public site 151 dosyada 1.124 ham
 * `indigo-` sınıfı taşıyordu ve o turda ölçülmemiş bir tasarım değişikliğini
 * kaçak yolcu olarak taşımak istenmiyordu. Ç-4 turunda o borç kapatıldı:
 * sınıfların tamamı token'a süpürüldü, panel de `--marka`ya takma ad oldu.
 * Eşik bu yüzden `toEqual([])` ve TABAN'dır: sitede yeni bir `indigo-` doğduğu
 * gün CI kırılır ve hangi dosyada doğduğu isimle görünür.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * KAYNAK SÖZLEŞMESİ testidir, düşük güçlüdür: "ekran gerçekten turuncu
 * çiziyor" iddiasını jsdom kanıtlayamaz (Tailwind sınıfları burada hesaplanan
 * bir renge dönüşmez). Kontrast sayıları da kaynaktaki token değerlerinden
 * HESAPLANIR, ölçülmez — yani bir bileşen zemini saydamlıkla kırarsa buradaki
 * yeşil onu görmez. Davranış kanıtı gerçek Chrome turundadır.
 *
 * Buradaki işi tek: kararın sessizce geri alınamaması, AA sözünün yavaş
 * tarayıcı turundan ÖNCE hızlı CI'da kırılması, ve borcun sessizce büyümemesi.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);

const css = readFileSync(join(KOK, "src", "index.css"), "utf8");

/* ── token okuma ──────────────────────────────────────────────────────── */

/** `:root` bloğundan bir token'ın HAM değerini okur (`var(--x)` çözülmez). */
function ham(ad: string): string {
  const govde = css.match(/:root\s*\{([\s\S]*?)\n  \}/m)?.[1] ?? "";
  if (!govde) throw new Error("index.css içinde `:root` bloğu bulunamadı");
  const deger = govde.match(new RegExp(`--${ad}:\\s*([^;]+);`))?.[1];
  if (!deger) throw new Error(`:root içinde --${ad} yok`);
  return deger.trim();
}

/**
 * `var(--x)` zincirini çözer. Panel ailesi markaya TAKMA AD olduğu için
 * gerekli: `--panel-accent: var(--marka)` yazılıdır ve nöbetçi "panel gerçekten
 * markayı gösteriyor mu" sorusunu ancak çözerek sorabilir.
 */
function token(ad: string, derinlik = 0): string {
  if (derinlik > 5) throw new Error(`--${ad}: var() zinciri döngüde`);
  const d = ham(ad);
  const m = d.match(/^var\(--([a-z-]+)\)$/);
  return m ? token(m[1], derinlik + 1) : d;
}

/* ── renk matematiği (WCAG 2.x) ───────────────────────────────────────── */

function rgb(uclu: string): [number, number, number] {
  const p = uclu.split(/\s+/).map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) {
    throw new Error(`RGB üçlüsü değil: "${uclu}"`);
  }
  return [p[0], p[1], p[2]];
}

/** WCAG bağıl parlaklık (0 = siyah, 1 = beyaz). */
function parlaklik(uclu: string): number {
  const [r, g, b] = rgb(uclu).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontrast(a: string, b: string): number {
  const [x, y] = [parlaklik(a), parlaklik(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

const BEYAZ = "255 255 255";

/* ── kaynak taraması ──────────────────────────────────────────────────── */

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

const kisaAd = (d: string) => relative(KOK, d).split(sep).join("/");

/** Yorum satırı: "eskiden indigo-600'dü" borç değil TARİHtir. */
const yorumMu = (satir: string) => {
  const k = satir.trim();
  return k.startsWith("//") || k.startsWith("*") || k.startsWith("/*");
};

function satirTara(kural: (satir: string) => boolean): string[] {
  const bulgular: string[] = [];
  for (const dosya of kaynakDosyalari()) {
    readFileSync(dosya, "utf8")
      .split(/\r?\n/)
      .forEach((satir, i) => {
        if (yorumMu(satir)) return;
        if (kural(satir)) bulgular.push(`${kisaAd(dosya)}:${i + 1}`);
      });
  }
  return bulgular;
}

/* ── 1. Kapsam: sitede indigo kalmadı ─────────────────────────────────── */

describe("Ç-4 · sitede indigo kalmadı", () => {
  it("`src/**` içinde `indigo-` sınıfı SIFIR (tavan değil TABAN)", () => {
    expect(
      satirTara((s) => /indigo-\d/.test(s)),
      "site yarı turuncu yarı indigo — Ç-4'ün açıkça yasakladığı hâl"
    ).toEqual([]);
  });

  it("tarama gerçekten siteye bakıyor (yalancı yeşil kapısı)", () => {
    // Boş bir dosya listesi de `[]` bulgu üretirdi. Kapsam hem SAYIYLA hem
    // KİMLİKLE çıpalanır; üçü de aksanın en yoğun geçtiği ağaçlardan seçildi.
    const dosyalar = kaynakDosyalari().map(kisaAd);
    expect(dosyalar.length).toBeGreaterThan(400);
    expect(dosyalar).toContain("src/pages/Marketplace.tsx");
    expect(dosyalar).toContain("src/pages/Tasks.tsx");
    expect(dosyalar).toContain("src/components/admin/ui/Button.tsx");
    expect(dosyalar).toContain("src/pages/tutorOnboarding/kabuk.tsx");
  });
});

/* ── 2. Değer: kararın TA KENDİSİ ─────────────────────────────────────── */

describe("Ç-4 · token değerleri kararın TA KENDİSİ", () => {
  it("aksan `#C2410C` ve panel ONA TAKMA AD (ikinci doğruluk kaynağı yok)", () => {
    // Değer testte yazılı olmasaydı aksanın sessizce kaymasını hiçbir şey
    // tutmazdı: "token kullanılıyor" iddiası rengin ne olduğunu söylemez.
    expect(token("marka")).toBe("194 65 12");
    // Panel kendi değerini TUTMAMALI. `token()` çözer; `ham()` çözmez —
    // ikisini birlikte iddia etmek "panel gerçekten takma ad" demektir.
    expect(ham("panel-accent")).toBe("var(--marka)");
    expect(token("panel-accent")).toBe(token("marka"));
    expect(ham("panel-accent-fg")).toBe("var(--marka-fg)");
    expect(ham("panel-accent-soft")).toBe("var(--marka-soft)");
  });

  it("odak halkası tanımlı, markaya bağlı ve eşiği geçiyor", () => {
    expect(ham("panel-focus")).toBe("var(--marka-focus)");
    // SC 1.4.11 metin dışı eşiği 3. Bilerek `--marka-mid` DEĞİL: mid beyaza
    // karşı 3,56 verir ve B-11 denetimi tam bu eksende 2,98 ile yanmıştı.
    expect(kontrast(token("marka-focus"), BEYAZ)).toBeGreaterThanOrEqual(3);
  });

  it("dikkat ailesi tanımlı ve panel ona takma ad", () => {
    expect(token("dikkat")).toBe("245 158 11");
    expect(ham("panel-attention")).toBe("var(--dikkat)");
    expect(ham("panel-attention-soft")).toBe("var(--dikkat-soft)");
    expect(ham("panel-attention-fg")).toBe("var(--dikkat-fg)");
  });

  it("değerler BOŞLUKLU RGB üçlüsü — hex yazılırsa saydamlık sessizce kırılır", () => {
    // `rgb(var(--x) / <alpha-value>)` köprüsü ancak bu biçimde çalışır.
    // Hex yazılsaydı `bg-marka/20` HİÇBİR ŞEY üretmezdi ve build yeşil geçerdi.
    for (const ad of [
      "marka", "marka-hover", "marka-fg", "marka-soft", "marka-soft-fg",
      "marka-line", "marka-mid", "marka-focus",
      "dikkat", "dikkat-soft", "dikkat-fg",
    ]) {
      expect(ham(ad), `--${ad} RGB üçlüsü değil`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
  });
});

/* ── 3. K5: aksan ile dikkat DEĞER ve BİÇİMle ayrılır ─────────────────── */

describe("Ç-4 · aksan ≠ dikkat (hue ile değil, DEĞER ve BİÇİMle)", () => {
  it("iki yüzey birbirinden ayırt edilebilir", () => {
    // Ç-3'ün `attention !== accent` düğümünün yerini alan iddia. `!==` artık
    // hiçbir şey kanıtlamaz: ikisi de turuncu ailesindendir.
    expect(kontrast(token("marka"), token("dikkat-soft"))).toBeGreaterThanOrEqual(3);
  });

  it("aksan KOYU dolgu + AÇIK metin; dikkat AÇIK zemin + KOYU metin", () => {
    // Karar cümlesinin makinece okunabilir hâli. Biri ters çevrilirse birincil
    // düğme ile "bekleyen iş" rozeti aynı biçimi taşır ve renk anlamını yitirir.
    expect(parlaklik(token("marka-fg"))).toBeGreaterThan(0.5);
    expect(parlaklik(token("marka"))).toBeLessThan(0.2);
    expect(parlaklik(token("dikkat-soft"))).toBeGreaterThan(0.5);
    expect(parlaklik(token("dikkat-fg"))).toBeLessThan(0.2);
  });

  it("AA sözü kaynakta çıpalı (yavaş tarayıcı turundan ÖNCE kırılır)", () => {
    expect(kontrast(token("marka-fg"), token("marka"))).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(token("marka-fg"), token("marka-hover"))).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(token("dikkat-fg"), token("dikkat-soft"))).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(token("marka-soft-fg"), token("marka-soft"))).toBeGreaterThanOrEqual(4.5);
    // Aksan metin olarak beyaz zeminde de okunabilir olmalı (`text-marka`,
    // sitede en çok geçen tek sınıf: 200 çağrı yeri).
    expect(kontrast(token("marka"), BEYAZ)).toBeGreaterThanOrEqual(4.5);
  });

  it("`--marka-mid` ve `--dikkat` METİN TAŞIYAMAZ — sınır yazılı", () => {
    // Bu ikisi bilerek AA'yı geçmez; rolleri kenarlık/halka ve düz şerit.
    // Sınırın kendisi çıpalanmazsa, ileride biri "metin de olsun" der ve
    // hiçbir şey itiraz etmez.
    expect(kontrast(token("marka-mid"), BEYAZ)).toBeGreaterThanOrEqual(3);
    expect(kontrast(token("marka-mid"), BEYAZ)).toBeLessThan(4.5);
    expect(kontrast(token("dikkat"), BEYAZ)).toBeLessThan(4.5);
  });

  it("uyarı ASLA dolgulu düğme değil (biçim kuralı)", () => {
    // §1.3 madde 2. Dolgulu dikkat + beyaz metin hem kontrastı düşürür
    // (amber-500 / beyaz = 2,15) hem de uyarıyı birincil aksiyon gibi gösterir.
    expect(
      satirTara((s) => /bg-[a-z-]*dikkat/.test(s) && /text-white(?![\w-])/.test(s)),
      "dolgulu dikkat + beyaz metin: hem 2,15 kontrast hem yanlış anlam"
    ).toEqual([]);
  });
});

/* ── 4. Köprü ─────────────────────────────────────────────────────────── */

describe("Ç-4 · Tailwind köprüsü", () => {
  const cfg = readFileSync(join(KOK, "tailwind.config.js"), "utf8");

  it("her marka/dikkat token'ı sınıfa çevriliyor", () => {
    // Token tanımlı ama köprülenmemişse `bg-marka-soft` sessizce HİÇBİR ŞEY
    // üretir — zemin şeffaf kalır ve kimse fark etmez.
    for (const ad of [
      "--marka", "--marka-hover", "--marka-fg", "--marka-soft", "--marka-soft-fg",
      "--marka-line", "--marka-mid", "--marka-focus",
      "--dikkat", "--dikkat-soft", "--dikkat-fg",
    ]) {
      expect(cfg, `${ad} Tailwind'e köprülenmemiş`).toContain(`rgb(var(${ad}) / <alpha-value>)`);
    }
  });

  it("panel köprüsü DURUYOR (244 sınıf ona bağlı)", () => {
    // Panel ağacı hiç değişmeden turuncuya geçti; köprü kaldırılırsa panelin
    // tamamı renksiz kalır ve bunu yalnız gerçek tarayıcı görür.
    for (const ad of ["--panel-accent", "--panel-focus", "--panel-attention"]) {
      expect(cfg, `${ad} köprüsü kayboldu`).toContain(`rgb(var(${ad}) / <alpha-value>)`);
    }
  });
});
