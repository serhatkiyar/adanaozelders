/**
 * ÜK-1 — SİTE marka aksanı nöbetçisi.
 *
 * ## Karar
 *
 * Aksan turuncudur (`#BD580C` — ton 26°, altın turuncu). Zemin, kenarlık ve gövde metni NÖTR kalır
 * (slate ailesi); marka aksan olarak girer — etkin gezinme öğesi, birincil
 * düğme, odak halkası — ve sıcak zemin `--marka-soft` (#FFF4E6) ile
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
 * bilerek tersine çevrildi (ÜK-1). Bu bir ölçüm düzeltmesi değil ÜRÜN
 * YARGISIdır ve `docs/tasarim-dili.md` §1.4 böyle yazar. Eski karar metni
 * silinmedi, tarihçe olarak orada durur.
 *
 * Ç-3'ün endişesi ortadan kalkmadı, ÇÖZÜM DEĞİŞTİ: aksan ile dikkat artık
 * HUE ile değil DEĞER ve BİÇİM ile ayrılır.
 *
 *     aksan  = KOYU dolgu + AÇIK metin      (#BD580C / beyaz — 4,60)
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
 * kaçak yolcu olarak taşımak istenmiyordu. ÜK-1 turunda o borç kapatıldı:
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

describe("ÜK-1 · sitede indigo kalmadı", () => {
  it("`src/**` içinde `indigo-` sınıfı SIFIR (tavan değil TABAN)", () => {
    expect(
      satirTara((s) => /indigo-\d/.test(s)),
      "site yarı turuncu yarı indigo — ÜK-1'ün açıkça yasakladığı hâl"
    ).toEqual([]);
  });

  it("ELLE YAZILMIŞ marka rengi yok (token atlatılamaz)", () => {
    // Bu düğüm, yukarıdaki sınıf taramasının GÖREMEDİĞİ kusur sınıfı için var.
    // ÜK-1 turunda gerçekten yaşandı: `indigo-` sınıfları süpürüldükten sonra
    // sitede hâlâ elle yazılmış marka renkleri kalmıştı —
    //   `StoreCategoryBar`  `bg-[#1a365d]`  (ESKİ LACİVERT, tek başına kalmıştı)
    //   `StoreSearch`       `bg-[#f8c27d]`  (ikinci bir turuncu arama düğmesi)
    //   `MapPicker.css`     `#4f46e5` ×14   (ayrı CSS dosyası, sınıf değil)
    //   harita işaretçileri `#6366f1`       (JS içinde satır içi stil dizesi)
    // Hiçbiri `indigo-\d` taramasına takılmıyordu ve build de yeşil geçiyordu.
    const ESKI: Record<string, string> = {
      "#4f46e5": "indigo-600", "#6366f1": "indigo-500", "#4338ca": "indigo-700",
      "#1a365d": "eski marka lacivert", "#eaf0f7": "eski lacivert-soft",
      "#f6ad55": "Ç-3 dikkat turuncusu", "#f8c27d": "eski mağaza turuncusu",
    };
    // Kullanıcının SEÇEBİLDİĞİ renk paletleri veri kalemidir, marka değil:
    // alışkanlık rengi, etiket rengi, grafik serisi. İsimle muaf tutulur ki
    // muafiyet sessizce genişlemesin.
    const MUAF = new Set([
      "src/pages/Grapher.tsx", "src/pages/Habits.tsx", "src/pages/Tasks.tsx",
    ]);
    const bulgular: string[] = [];
    const yuru = (dizin: string) => {
      for (const ad of readdirSync(dizin).sort()) {
        const tam = join(dizin, ad);
        if (statSync(tam).isDirectory()) {
          if (ad !== "node_modules") yuru(tam);
          continue;
        }
        if (!/\.(tsx?|css)$/.test(ad) || /\.test\.tsx?$/.test(ad)) continue;
        const kisa = kisaAd(tam);
        if (MUAF.has(kisa)) continue;
        readFileSync(tam, "utf8")
          .split(/\r?\n/)
          .forEach((satir, i) => {
            if (yorumMu(satir)) return;
            for (const [hex, etiket] of Object.entries(ESKI)) {
              if (satir.toLowerCase().includes(hex)) {
                bulgular.push(`${kisa}:${i + 1} → ${hex} (${etiket})`);
              }
            }
          });
      }
    };
    yuru(join(KOK, "src"));
    expect(bulgular, "elle yazılmış marka rengi token katmanını atlatır").toEqual([]);
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

describe("ÜK-1 · token değerleri kararın TA KENDİSİ", () => {
  it("dolgu `#FF9900` (Amazon turuncusu) ve panel ONA TAKMA AD (ikinci doğruluk kaynağı yok)", () => {
    expect(token("marka")).toBe("255 153 0");
    expect(ham("panel-accent")).toBe("var(--marka)");
    expect(token("panel-accent")).toBe(token("marka"));
    expect(ham("panel-accent-fg")).toBe("var(--marka-fg)");
    expect(ham("panel-accent-soft")).toBe("var(--marka-soft)");
    expect(ham("panel-accent-text")).toBe("var(--marka-metin)");
  });

  it("odak halkası tanımlı, markadan AYRI ve eşiği geçiyor", () => {
    expect(ham("panel-focus")).toBe("var(--marka-focus)");
    // Odak halkası dolgunun kendisi OLAMAZ: dolgu beyaza karşı 2,60 verir ve
    // ince bir halka olarak zayıf kalır. Ayrı, daha koyu bir adım kullanılır.
    expect(token("marka-focus")).not.toBe(token("marka"));
    expect(kontrast(token("marka-focus"), BEYAZ)).toBeGreaterThanOrEqual(3);
  });

  it("dikkat ailesi tanımlı ve panel ona takma ad", () => {
    expect(token("dikkat")).toBe("245 158 11");
    expect(ham("panel-attention")).toBe("var(--dikkat)");
    expect(ham("panel-attention-soft")).toBe("var(--dikkat-soft)");
    expect(ham("panel-attention-fg")).toBe("var(--dikkat-fg)");
  });

  it("değerler BOŞLUKLU RGB üçlüsü — hex yazılırsa saydamlık sessizce kırılır", () => {
    for (const ad of [
      "marka", "marka-hover", "marka-fg", "marka-metin", "marka-metin-hover",
      "marka-soft", "marka-line", "marka-mid", "marka-focus",
      "dikkat", "dikkat-soft", "dikkat-fg",
    ]) {
      expect(ham(ad), `--${ad} RGB üçlüsü değil`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
    // Bu ikisi bilerek takma ad: metin adımı tek yerde durur.
    expect(ham("marka-soft-fg")).toBe("var(--marka-metin)");
  });
});

/* ── 3. BİÇİM: dolgu PARLAK + yazı KOYU (ÜK-1 ikinci sürüm) ────────────── */

describe("ÜK-1 · dolgu PARLAK, üstündeki yazı KOYU", () => {
  it("kural TERSİNE çevrildi ve değerler onu doğruluyor", () => {
    // İlk sürüm "koyu dolgu + beyaz yazı"ydı. Beyaz yazıyı taşıyabilmek için
    // turuncuyu 4,6 kontrasta kadar koyulaştırmak gerekiyordu ve o noktada
    // renk kahveye/yanığa kayıyordu — kullanıcı "bok rengi" dedi, haklıydı.
    // Turuncu markaların hepsi (Amazon, Trendyol) koyu yazı kullanır.
    expect(parlaklik(token("marka"))).toBeGreaterThan(0.25); // dolgu PARLAK
    expect(parlaklik(token("marka-fg"))).toBeLessThan(0.1); // yazı KOYU
  });

  it("AA sözü kaynakta çıpalı (yavaş tarayıcı turundan ÖNCE kırılır)", () => {
    expect(kontrast(token("marka-fg"), token("marka"))).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(token("marka-fg"), token("marka-hover"))).toBeGreaterThanOrEqual(4.5);
    // Açık zeminde marka YAZISI ayrı bir adımdır ve her üç zeminde de okunur.
    expect(kontrast(token("marka-metin"), BEYAZ)).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(token("marka-metin"), token("marka-soft"))).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(token("marka-metin"), token("marka-line"))).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(token("marka-metin-hover"), BEYAZ)).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(token("dikkat-fg"), token("dikkat-soft"))).toBeGreaterThanOrEqual(4.5);
  });

  it("dolgu beyaz sayfadan AYIRT EDİLİR (SC 1.4.11 · gevşetilmiş eşik)", () => {
    // ── DEĞİŞEN KABUL ÖLÇÜTÜ (kullanıcı kararı, 7 Eyl 2026) ──
    //
    // Bu düğüm `>= 3` istiyordu ve `#E37200` tam 3,15 ile geçiyordu. Kullanıcı
    // rengi daha açık istedi; ölçüm alternatiflerin tükendiğini gösterdi:
    // bir adım açmak 2,95, ton kaydırmak (28°–44°) daha parlak bir çözüm
    // ÜRETMİYOR, dolguya kenarlık eklemek 336 çağrı yerini etkiliyor.
    //
    // 7 Eyl 2026 · ikinci iniş: renk Amazon'un kendi turuncusuna (#FF9900)
    // sabitlendi ve eşik 2,1'e indi. Bu bir "biraz daha aç" kaydırması DEĞİL,
    // sektörde yerleşik bir değere DEMİRLEME: Amazon aynı rengi birincil
    // düğmede koyu yazıyla kullanıyor ve bizim ölçtüğümüz yazı kontrastı da
    // 8,33 (eşik 4,5). Alt eşik artık o değerin hemen altında duruyor;
    // bir sonraki "biraz daha aç" isteği bu düğümü KIRAR ve yeniden karar
    // verilmesini zorlar.
    //
    // Eşik bilerek indi ve bu bir ÜRÜN KARARIDIR, kaçamak değil:
    // eşiğin tamamen kaldırılması hâlinde dolgu beyaza kadar açılabilir ve
    // düğme sayfadan hiç ayrılmazdı. Metin okunurluğu (aşağıdaki 4,5 kuralı)
    // TARTIŞMAYA AÇIK DEĞİLDİR ve olduğu gibi duruyor.
    const olculen = kontrast(token("marka"), BEYAZ);
    expect(olculen).toBeGreaterThanOrEqual(2.1);
    // Üst kapı: eşiği gevşetmek "sınırsız açılabilir" demek değil. Renk
    // 3'ün üstüne geri çıkarsa bu yorum bayatlar — o gün eşik geri yükselir.
    expect(olculen).toBeLessThan(3);
  });

  it("DOLGU METİN OLARAK KULLANILAMAZ — bu sürümün asıl kusur sınıfı", () => {
    // `--marka` beyaz zeminde 2,60 verir; gövde metni eşiği 4,5'tir. Kural
    // tersine çevrilirken 169 `text-marka` çağrı yeri `text-marka-metin`e
    // taşındı. Biri geri yazarsa metin okunmaz olur ve BUNU hiçbir tip
    // kontrolü, hiçbir build yakalayamaz — sınıf geçerlidir, sadece soluktur.
    expect(
      satirTara((l) => /(?<![\w-])text-marka(?![\w-])/.test(l)),
      "`text-marka` beyaz zeminde 3,15 — metin için `text-marka-metin` var"
    ).toEqual([]);
    expect(
      satirTara((l) => /(?<![\w-])text-panel-accent(?![\w-])/.test(l)),
      "panelde de aynı: metin için `text-panel-accent-text` var"
    ).toEqual([]);
  });

  it("`--marka-mid` ve `--dikkat` METİN TAŞIYAMAZ — sınır yazılı", () => {
    expect(kontrast(token("marka-mid"), BEYAZ)).toBeGreaterThanOrEqual(3);
    expect(kontrast(token("marka-mid"), BEYAZ)).toBeLessThan(4.5);
    expect(kontrast(token("dikkat"), BEYAZ)).toBeLessThan(4.5);
  });

  it("aksan ile uyarı DOYGUNLUK ve PARLAKLIK farkıyla ayrılır", () => {
    // İlk sürümde ayrım DEĞERdeydi (koyu dolgu ↔ açık çip) ve 3:1 kontrastla
    // ölçülüyordu. Dolgu parlaklaşınca o ölçüt anlamını yitirdi: ikisi de artık
    // açık turuncu ailesinden. Ayrım ŞİMDİ dolgunun DOYGUN, çipin SOLUK
    // olmasıdır — parlaklık farkı bunu ölçer. Eşiği düşürmek yerine ölçütü
    // değiştirdim; sayıyı teste uydurmak, sözleşmeyi sessizce zayıflatmaktır.
    const fark = parlaklik(token("dikkat-soft")) - parlaklik(token("marka"));
    expect(fark, "uyarı çipi dolgudan belirgin biçimde SOLUK olmalı").toBeGreaterThan(0.4);
  });

  it("uyarı ASLA dolgulu düğme değil (biçim kuralı)", () => {
    expect(
      satirTara((s) => /bg-[a-z-]*dikkat/.test(s) && /text-white(?![\w-])/.test(s)),
      "dolgulu dikkat + beyaz metin: hem 2,15 kontrast hem yanlış anlam"
    ).toEqual([]);
  });
});

/* ── 4. Köprü ─────────────────────────────────────────────────────────── */

describe("ÜK-1 · Tailwind köprüsü", () => {
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
