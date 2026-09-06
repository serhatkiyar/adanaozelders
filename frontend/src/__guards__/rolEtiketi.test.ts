/**
 * Rol etiketi TEK KAYNAKTAN gelir — nöbetçi.
 *
 * ## Karar
 *
 * "Öğrenci" bir ROL ADI değildir. Talep tarafındaki hesap sahibi öğrenci
 * olmak zorunda değil ve çoğu zaman değil de:
 *
 *  - `backend/core/flags.py:145` — 18 yaş altı rezervasyon KAPALI, gerekçesi
 *    kodda yazılı: *"Veli (Guardian) modeli yazılana kadar."* Yani hesap
 *    sahibi tanım gereği ödeyen YETİŞKİN; dersi alan kişi olmak zorunda değil.
 *  - `lib/legalContent.ts` (Mesafeli Satış · Taraflar) tek ad seçememiş:
 *    `"ALICI: … öğrenci/müşteri"`.
 *  - Aynı kişi ders alıyor, kitap satın alıyor, kütüphane rezerve ediyor.
 *
 * Rol adı artık **"Üye"** ve tek yerde yaşıyor: `lib/roles.ts`.
 *
 * ## Bu nöbetçi neden var
 *
 * Değişiklikten önce etiket **yedi ayrı dosyada elle yazılıydı** — üstelik
 * ikisi çelişiyordu (`AdminAuditLogsPage` rol 1 için "Admin", diğer iki ekran
 * "Yönetici"). Merkezî kaynak o çelişkiyi kapattı; bu düğüm de sekizincisinin
 * sessizce doğmasını engelliyor.
 *
 * Sessizce yanlış gidebilecek şey şu: biri yeni bir ekranda `"Öğrenci"` yazar,
 * hiçbir test kırılmaz, ürün yarısı "Üye" yarısı "Öğrenci" der ve bunu ancak
 * ekrana bakan bir insan fark eder.
 *
 * ## Kapsam sınırı — kelime YASAK DEĞİL
 *
 * "Öğrenci" hedef kitleyi anlatan metinde KALIR ("öğrenciler seni aramada
 * bulur") çünkü orada gerçekten öğrenci kastediliyor. Bu yüzden nöbetçi
 * kelimenin kendisini değil, **ETİKET BİÇİMİNDE** kullanılmasını arar:
 * JSX metin düğümü, `title=`/`header=`/`label=` gibi öznitelikler ve tek
 * başına dize sabiti.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * KAYNAK SÖZLEŞMESİ testidir. "Ekranda ne yazıyor" iddiasını kanıtlamaz;
 * yalnız etiketin ikinci bir doğruluk kaynağı edinmesini engeller.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { ADSIZ_UYE, ROL_ETIKETI, rolEtiketi } from "@/lib/roles";
import { ROLE_IDS } from "@/types";

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

const kisaAd = (d: string) => relative(KOK, d).split(sep).join("/");

/**
 * Etiketin TEK KAYNAĞI. Muafiyet listesi TEK ÖĞEYE indi.
 *
 * (Tarihçe: kayıt ekranları `Register` ve `AuthModal` rol SEÇTİRDİĞİ için
 * muaftı. Artık kimlik değil NİYET soruyorlar — "Ders almak" / "Ders vermek" —
 * ve muafiyete ihtiyaçları kalmadı. Muafiyetin daralması kapsamın
 * genişlemesidir: o iki ekran da artık taranıyor.)
 */
const MUAF = new Set(["src/lib/roles.ts"]);

/** Etiket BİÇİMİNDE kullanım: dize sabiti ya da etiket özniteliği. */
const ETIKET_BICIMI = [
  /"Öğrenci"/,
  /'Öğrenci'/,
  /`Öğrenci`/,
  />\s*Öğrenci\s*</,
  /(?:title|header|label|aria-label|placeholder)=\{?"Öğrenci/,
];

function etiketBicimindeGecenler(kelime: RegExp[]): string[] {
  const bulgular: string[] = [];
  for (const dosya of kaynakDosyalari()) {
    const kisa = kisaAd(dosya);
    if (MUAF.has(kisa)) continue;
    readFileSync(dosya, "utf8")
      .split(/\r?\n/)
      .forEach((satir, i) => {
        const k = satir.trim();
        // Yorumdaki "eskiden Öğrenci yazıyordu" borç değil TARİHtir.
        if (k.startsWith("//") || k.startsWith("*") || k.startsWith("/*")) return;
        if (kelime.some((d) => d.test(satir))) bulgular.push(`${kisa}:${i + 1}`);
      });
  }
  return bulgular;
}

describe("rol etiketi tek kaynaktan gelir", () => {
  it("`ROL_ETIKETI` beş rolü de kapsıyor (DOLULUK)", () => {
    // Boş/eksik bir tablo, aşağıdaki "elle yazılmamış" iddiasını bedava
    // geçirirdi: etiket hiç yoksa kopyası da olmaz.
    for (const [ad, id] of Object.entries(ROLE_IDS)) {
      expect(ROL_ETIKETI[id], `${ad} için etiket yok`).toBeTruthy();
    }
    expect(Object.keys(ROL_ETIKETI)).toHaveLength(5);
  });

  it("talep tarafının adı ÖĞRENCİ DEĞİL", () => {
    // Kararın kendisi. Değer testte yazılı olmasaydı, etiketin sessizce geri
    // dönmesini hiçbir şey tutmazdı.
    expect(rolEtiketi(ROLE_IDS.CLIENT)).toBe("Üye");
    expect(rolEtiketi(ROLE_IDS.TUTOR)).toBe("Eğitmen");
    expect(ADSIZ_UYE).toBe("Üye");
  });

  it("bilinmeyen rolde UYDURMAZ", () => {
    // Sessiz bir varsayılan ("Üye" dönmek) yanlış rolü doğru göstermiş olurdu.
    expect(rolEtiketi(99)).toBe("");
    expect(rolEtiketi(null)).toBe("");
    expect(rolEtiketi(undefined)).toBe("");
  });

  it("`\"Öğrenci\"` etiket olarak HİÇBİR ekranda elle yazılmıyor", () => {
    expect(
      etiketBicimindeGecenler(ETIKET_BICIMI),
      "rol etiketi ikinci bir doğruluk kaynağı edindi — `lib/roles.ts` kullan"
    ).toEqual([]);
  });

  it("tarama gerçekten siteye bakıyor (yalancı yeşil kapısı)", () => {
    // Boş bir dosya listesi de `[]` bulgu üretirdi.
    const dosyalar = kaynakDosyalari().map(kisaAd);
    expect(dosyalar.length).toBeGreaterThan(400);
    expect(dosyalar).toContain("src/pages/Profile.tsx");
    expect(dosyalar).toContain("src/pages/admin/AdminUsersPage.tsx");
    // Muafiyet listesi gerçek dosyaları işaret ediyor mu (bayat muafiyet
    // sessizce kapsamı daraltır).
    for (const m of MUAF) expect(dosyalar, `muaf dosya yok: ${m}`).toContain(m);
  });

  it("KELİME yasak değil: hedef kitle metninde geçebilir", () => {
    // Kapsamın kendisi de çıpalanır, yoksa bir sonraki tur "öğrenci geçmesin"
    // diye anlar ve pazarlama metnini de bozar.
    const hedefKitle = 'İlanını gören öğrenciler sana ulaşır';
    expect(ETIKET_BICIMI.some((d) => d.test(hedefKitle))).toBe(false);
  });
});
