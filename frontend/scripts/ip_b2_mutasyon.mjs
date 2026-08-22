/**
 * İP-B2 · Mutasyon provası — liste ailesinin ters provası.
 *
 * Her koruma için sorulan tek soru: **koruma söküldüğünde nöbetçi gerçekten
 * kırılıyor mu.** Yeşil kapı bir kanıt değil, kanıtın ön koşuludur.
 *
 * Kümeler:
 *   A. **Ç-2 · D kuralı** — tavan, açıktaki yıkıcı, onay adımı.
 *   B. **İki boş durum** — seçim gerçekten `filtreli` bayrağına mı bakıyor.
 *   C. **Araç çubuğu** — gecikme, sayfa sıfırlama, çip kaldırma, temizleme.
 *   D. **Ç-5 · KVKK** — dış yazı tipi konağı ve self-host bildirimi.
 *   E. **Ç-3 · marka aksanı** — panelde indigo ve koyu tema metin rengi.
 *   F. **Kabuk bağları** — mobil kart, başlık portalı, menü odak dönüşü.
 *
 * GÜVENLİK (kök CLAUDE.md §D): sürücü `git checkout --` KULLANMAZ. Dosyanın
 * ham baytları bellekte tutulur ve aynen geri yazılır (CRLF korunur). Ek
 * olarak her dosyanın **SHA-256**'sı mutasyondan önce ve geri yüklemeden
 * sonra karşılaştırılır; ayrıca başlangıç/bitiş `git status --porcelain`
 * çıktıları birebir eşleşmelidir.
 *
 * Mutasyondan ÖNCE hedef testlerin YEŞİL olduğu doğrulanır — taban kırmızıyken
 * uygulanan bir mutasyon "yakalandı" görünürdü (A7d5'in eklediği kapı).
 *
 * Kullanım (frontend/ dizininden):  node scripts/ip_b2_mutasyon.mjs
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SATIR_AKSIYONLARI = "src/components/admin/ui2/liste/satirAksiyonlari.tsx";
const ARAC_CUBUGU = "src/components/admin/ui2/liste/aracCubugu.tsx";
const MENU = "src/components/admin/ui2/liste/menu.tsx";
const DATA_TABLE = "src/components/admin/data-table/DataTable.tsx";
const URUNLER = "src/components/admin/store/ProductsPanel.tsx";
const BASLIK_AKSIYONU = "src/components/admin/layout/baslikAksiyonu.tsx";
const INDEX_HTML = "index.html";
const CSS = "src/index.css";
const ROZET = "src/components/admin/ui/Badge.tsx";

const T_SATIR = "src/components/admin/ui2/liste/satirAksiyonlari.test.tsx";
const T_ARAC = "src/components/admin/ui2/liste/aracCubugu.test.tsx";
const T_MENU = "src/components/admin/ui2/liste/menu.test.tsx";
const T_BOS = "src/components/admin/data-table/bosDurumIkizi.test.tsx";
const T_FONT = "src/__guards__/disFont.test.ts";
const T_AKSAN = "src/__guards__/panelAksani.test.ts";
const T_KABUL = "src/pages/dashboards/urunListesiAnatomisi.acceptance.test.tsx";

/**
 * Satır sonu bağımsız arama/değiştirme (İP-A6 sürücüsünden devralındı).
 *
 * Bu depoda dosyaların bir kısmı CRLF: LF yazılmış bir desen sessizce
 * eşleşmez ve mutasyon "uygulanmadı" hâlde "yakalanmadı" gibi okunurdu.
 */
function degistir(kaynak, ara, koy) {
  if (kaynak.includes(ara)) return kaynak.replace(ara, koy);
  const araCrlf = ara.replace(/\n/g, "\r\n");
  const koyCrlf = koy.replace(/\n/g, "\r\n");
  if (kaynak.includes(araCrlf)) return kaynak.replace(araCrlf, koyCrlf);
  return kaynak;
}

const MUTASYONLAR = [
  /* ── A · Ç-2 · D kuralı ───────────────────────────────────────────── */
  {
    ad: "A1 · açık düğme TAVANI kaldırılırsa (3. düğme sessizce kabul edilir)",
    dosya: SATIR_AKSIYONLARI,
    hedef: T_SATIR,
    uygula: (s) => degistir(s, "if (acikOlanlar.length > ACIK_AKSIYON_TAVANI) {", "if (false) {"),
    // Desen ASCII: yakalanan çıktı Windows konsol kod sayfasından geçtiği için
    // Türkçe karakterler eşleşmiyordu (ilk yazımda "teşhis zayıf" çıktı — kusur
    // mutasyonda değil, sürücünün desenindeydi).
    beklenen: /AssertionError|toMatch|toThrow/,
  },
  {
    ad: "A2 · açıktaki YIKICI aksiyon denetimi kaldırılırsa",
    dosya: SATIR_AKSIYONLARI,
    hedef: T_SATIR,
    uygula: (s) => degistir(s, "if (acikYikici.length > 0) {", "if (false) {"),
    beklenen: /yıkıcı aksiyon açıkta olamaz|Ç-2 ihlali/,
  },
  {
    ad: "A3 · yıkıcı aksiyonun ONAY adımı atlanırsa (doğrudan siler)",
    dosya: SATIR_AKSIYONLARI,
    hedef: T_SATIR,
    uygula: (s) =>
      degistir(
        s,
        [
          "    if (aksiyon.yikici) onayYuzeyi.ac(indeks);",
          "    else aksiyon.onSec(onayYuzeyi.kapat);",
        ].join(String.fromCharCode(10)),
        [
          "    aksiyon.onSec(onayYuzeyi.kapat);",
          "    void indeks;",
        ].join(String.fromCharCode(10))
      ),
    beklenen: /menüden seçmek doğrudan sildi|Kaydı sil/,
  },
  {
    ad: "A4 · kural ihlali SESSİZ kabul edilirse (throw + console.error kalkarsa)",
    dosya: SATIR_AKSIYONLARI,
    hedef: T_SATIR,
    uygula: (s) =>
      degistir(
        s,
        '    console.error(`[SatirAksiyonlari] ${ihlal}`);\n    if (import.meta.env.DEV) throw new Error(ihlal);',
        "    void ihlal;"
      ),
    beklenen: /Ç-2 ihlali|toThrow/,
  },

  {
    ad: "A5 · onay penceresi aksiyondan ÖNCE kapatılırsa (çift tıklama koruması ölür)",
    dosya: SATIR_AKSIYONLARI,
    hedef: T_SATIR,
    // Bu, bu paketin ÜRETTİĞİ gerçek regresyondu ve mevcut bir kabul testi
    // (`adminSafetyStates` · C-2) yakaladı; sözleşme ortak bileşene taşındı.
    uygula: (s) =>
      degistir(
        s,
        "          onConfirm={() => onaylananAksiyon.onSec(onayYuzeyi.kapat)}",
        [
          "          onConfirm={() => {",
          "            onayYuzeyi.kapat();",
          "            onaylananAksiyon.onSec(() => {});",
          "          }}",
        ].join(String.fromCharCode(10))
      ),
    beklenen: /AssertionError|Unable to find|devre dışı/,
  },

  /* ── B · İki boş durum ────────────────────────────────────────────── */
  {
    ad: "B1 · boş durum seçimi `filtreli` bayrağını YOK SAYARSA",
    dosya: DATA_TABLE,
    hedef: T_BOS,
    uygula: (s) => degistir(s, "bos.filtreli ? bos.sonucYok : bos.kayitYok", "bos.kayitYok"),
    beklenen: /Eşleşen kayıt yok/,
  },
  {
    ad: "B2 · yüklenirken boş durum basılırsa ('veri yok' ile 'gelmedi' karışır)",
    dosya: DATA_TABLE,
    hedef: T_BOS,
    uygula: (s) => degistir(s, "const yukleniyor = isLoading && data.length === 0;", "const yukleniyor = false;"),
    beklenen: /Henüz kayıt yok|Yükleniyor/,
  },

  /* ── C · Araç çubuğu ──────────────────────────────────────────────── */
  {
    ad: "C1 · arama GECİKMESİ kalkarsa (her tuşta istek)",
    dosya: ARAC_CUBUGU,
    hedef: T_ARAC,
    uygula: (s) => degistir(s, "const ARAMA_GECIKMESI_MS = 300;", "const ARAMA_GECIKMESI_MS = 0;"),
    beklenen: /her tuş vuruşunda URL yazılıyor|q=kalem/,
  },
  {
    ad: "C2 · filtre değişince SAYFA sıfırlanmazsa",
    dosya: ARAC_CUBUGU,
    hedef: T_ARAC,
    uygula: (s) => degistir(s, "          sonraki.delete(sayfaAnahtari);", "          void sayfaAnahtari;"),
    beklenen: /sayfa/,
  },
  {
    ad: "C3 · çip kaldırma filtreyi silmezse (çip dekoratif olur)",
    dosya: ARAC_CUBUGU,
    hedef: T_ARAC,
    uygula: (s) =>
      degistir(
        s,
        "              onClick={() => yaz({ [cip.tanim.anahtar]: undefined })}",
        "              onClick={() => {}}"
      ),
    beklenen: /stok|filtre/i,
  },
  {
    ad: "C4 · 'Tümünü temizle' SIRALAMAYI da silerse",
    dosya: ARAC_CUBUGU,
    hedef: T_ARAC,
    uygula: (s) =>
      degistir(
        s,
        "      for (const anahtar of korunacakAnahtarlar) {",
        "      for (const anahtar of []) {"
      ),
    beklenen: /sirala=price|sıralama/i,
  },
  {
    ad: "C5 · uygulanmış kriter menüde TEKRAR sunulursa",
    dosya: ARAC_CUBUGU,
    hedef: T_ARAC,
    uygula: (s) =>
      degistir(
        s,
        "  const uygulanabilirFiltreler = filtreler.filter((f) => !params.get(f.anahtar));",
        "  const uygulanabilirFiltreler = filtreler;"
      ),
    beklenen: /Stok durumu/,
  },

  /* ── D · Ç-5 · KVKK ───────────────────────────────────────────────── */
  {
    ad: "D1 · index.html'e yeniden dış yazı tipi bağlantısı eklenirse",
    dosya: INDEX_HTML,
    hedef: T_FONT,
    uygula: (s) =>
      degistir(
        s,
        '    <link rel="icon" type="image/png" href="/favicon.png" />',
        '    <link rel="stylesheet" href="https://fonts.' +
          ["goog", "leapis"].join("") +
          '.com/css2?family=Inter" />\n    <link rel="icon" type="image/png" href="/favicon.png" />'
      ),
    beklenen: /üçüncü tarafa gidiyor|KVKK/,
  },
  {
    ad: "D2 · @font-face'in `font-display: swap`ı düşerse (FOIT)",
    dosya: CSS,
    hedef: T_FONT,
    uygula: (s) => degistir(s, "  font-display: swap;\n  src: url(\"/fonts/inter-latin.woff2\")", '  src: url("/fonts/inter-latin.woff2")'),
    beklenen: /font-display|swap/,
  },
  {
    ad: "D3 · latin-ext altkümesi düşerse (Türkçe ş/ğ/İ yedek yazı tipiyle çizilir)",
    dosya: CSS,
    hedef: T_FONT,
    // ⚠️ Mutasyon `src:` SATIRINI hedefler, çıplak dosya adını DEĞİL.
    //
    // İlk yazımda `degistir(s, "/fonts/inter-latin-ext.woff2", ...)` yazıyordu
    // ve `String.replace` İLK eşleşmeyi değiştirir — o da dosyanın başındaki
    // AÇIKLAMA YORUMUYDU. Yani mutasyon bildirimi hiç bozmadı, nöbetçi haklı
    // olarak yeşil kaldı ve sürücü "YAKALANMADI" dedi.
    //
    // Bu yanlış alarm gerçek bir kusuru da açığa çıkardı: nöbetçi o gün
    // `css.toContain(...)` diyordu, yani bildirim silinse bile YORUMUN
    // varlığı testi geçirirdi. İkisi de düzeltildi (nöbetçi artık
    // `@font-face` bloklarının içindeki `url()` kümesine bakıyor).
    uygula: (s) =>
      degistir(
        s,
        'src: url("/fonts/inter-latin-ext.woff2") format("woff2");',
        'src: url("/fonts/inter-latin.woff2") format("woff2");'
      ),
    beklenen: /AssertionError|toEqual/,
  },

  /* ── E · Ç-3 · marka aksanı ───────────────────────────────────────── */
  {
    ad: "E1 · panel ağacına yeniden `indigo-` sınıfı girerse",
    dosya: ROZET,
    hedef: T_AKSAN,
    uygula: (s) => degistir(s, 'info: "bg-panel-accent-soft text-panel-accent",', 'info: "bg-indigo-50 text-indigo-700",'),
    beklenen: /yarı lacivert yarı indigo|Badge/,
  },
  {
    ad: "E2 · aksan lacivertten başka bir renge kayarsa",
    dosya: CSS,
    hedef: T_AKSAN,
    uygula: (s) => degistir(s, "    --panel-accent: 26 54 93;", "    --panel-accent: 79 70 229;"),
    beklenen: /26 54 93/,
  },
  {
    ad: "E3 · koyu temada aksan üstündeki metin BEYAZ yapılırsa (1,35 kontrast)",
    dosya: CSS,
    hedef: T_AKSAN,
    uygula: (s) =>
      degistir(
        s,
        "    --panel-accent-fg: 2 6 23;          /* slate-950 · 8,98 */",
        "    --panel-accent-fg: 255 255 255;"
      ),
    beklenen: /2 6 23/,
  },
  {
    ad: "E4 · dikkat rengi ile aksan AYNI yapılırsa (renk anlamını kaybeder)",
    dosya: CSS,
    hedef: T_AKSAN,
    uygula: (s) =>
      degistir(
        s,
        "    --panel-attention: 246 173 85;      /* #F6AD55 — düz hâl (şerit, nokta) */",
        "    --panel-attention: 26 54 93;"
      ),
    beklenen: /246 173 85|attention/,
  },

  /* ── F · Kabuk bağları ────────────────────────────────────────────── */
  {
    ad: "F1 · mobil kart bağı sökülürse (`renderMobileRow` verilmezse)",
    dosya: URUNLER,
    hedef: T_KABUL,
    uygula: (s) =>
      degistir(
        s,
        "        renderMobileRow={(p) => (\n          <UrunKarti product={p} esik={esik} canManage={canManage} onChange={invalidate} />\n        )}",
        ""
      ),
    beklenen: /mobil kart bölümü yok|renderMobileRow/,
  },
  {
    ad: "F2 · başlık portalı sökülürse (aksiyon içerikte kalır)",
    dosya: BASLIK_AKSIYONU,
    hedef: T_KABUL,
    uygula: (s) => degistir(s, "  if (!hedef) return <>{children}</>;", "  return <>{children}</>;"),
    beklenen: /Yeni ürün|başlıkta hem içerikte/,
  },
  {
    ad: "F3 · menü ESC'te odağı tetikleyiciye DÖNDÜRMEZSE",
    dosya: MENU,
    hedef: T_MENU,
    uygula: (s) =>
      degistir(
        s,
        "    if (odakDon) tetikleyiciRef.current?.focus();",
        "    void odakDon;"
      ),
    beklenen: /activeElement|odak/i,
  },
  {
    ad: "F4 · menü kapalıyken içeriğini DOM'da tutarsa (gizli değil, görünmez)",
    dosya: MENU,
    hedef: T_MENU,
    uygula: (s) => degistir(s, "      {acik && (\n        <div", "      {true && (\n        <div"),
    beklenen: /menu|menuitem/i,
  },
];

const sha = (yol) => createHash("sha256").update(readFileSync(yol)).digest("hex");

function gitDurumu() {
  return execFileSync("git", ["status", "--porcelain"], { cwd: "..", encoding: "utf8" });
}

function testKos(hedef) {
  try {
    const cikti = execFileSync("npx", ["vitest", "run", hedef, "--reporter=basic"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    return { gecti: true, cikti };
  } catch (e) {
    return { gecti: false, cikti: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const baslangicDurumu = gitDurumu();
const baslangicOzetleri = new Map();
for (const dosya of new Set(MUTASYONLAR.map((m) => m.dosya))) {
  baslangicOzetleri.set(dosya, sha(dosya));
}

// ── YEŞİL TABAN KAPISI ──
const hedefler = [...new Set(MUTASYONLAR.map((m) => m.hedef))];
for (const h of hedefler) {
  const ilk = testKos(h);
  if (!ilk.gecti) {
    console.error(`HATA: ${h} mutasyondan ÖNCE zaten kırmızı. Prova anlamsız.`);
    process.exit(1);
  }
}
console.log(`Taban: ${hedefler.length} hedef dosyanın hepsi YEŞİL.\n`);

let hepsiYakalandi = true;

for (const m of MUTASYONLAR) {
  const orijinal = readFileSync(m.dosya, "utf8");
  const bozuk = m.uygula(orijinal);
  if (bozuk === orijinal) {
    console.error(`✗ ${m.ad}: mutasyon UYGULANAMADI (desen bulunamadı).`);
    hepsiYakalandi = false;
    continue;
  }
  writeFileSync(m.dosya, bozuk, "utf8");
  const sonuc = testKos(m.hedef);
  writeFileSync(m.dosya, orijinal, "utf8");

  // Geri yükleme HER MUTASYONDAN SONRA doğrulanır: bir dosyanın bozuk hâlde
  // kalması, sonraki provaların hepsini geçersiz kılar.
  if (sha(m.dosya) !== baslangicOzetleri.get(m.dosya)) {
    console.error(`✗✗ ${m.dosya}: geri yükleme SHA-256 doğrulamasından geçemedi — DURULDU`);
    process.exit(2);
  }

  const yakalandi = !sonuc.gecti && m.beklenen.test(sonuc.cikti);
  hepsiYakalandi &&= yakalandi;
  console.log(
    `${yakalandi ? "✓" : "✗"} ${m.ad}: mutasyon ${
      sonuc.gecti ? "YAKALANMADI (nöbetçi geçti!)" : "yakalandı"
    }`
  );
  if (!yakalandi && !sonuc.gecti) {
    console.log("    (kırmızı düştü ama beklenen mesaj çıkmadı — teşhis zayıf)");
  }
}

const bitisDurumu = gitDurumu();
console.log(`\nÇalışma ağacı: ${bitisDurumu === baslangicDurumu ? "BAŞLANGIÇTAKİ HÂLİ" : "DEĞİŞMİŞ (!)"}`);
if (bitisDurumu !== baslangicDurumu) {
  console.log("--- başlangıç ---\n" + baslangicDurumu);
  console.log("--- bitiş ---\n" + bitisDurumu);
}
console.log("\nSHA-256 doğrulaması (mutasyondan önce ↔ sonra):");
for (const [dosya, ozet] of baslangicOzetleri) {
  const simdiki = sha(dosya);
  console.log(`  ${simdiki === ozet ? "OK " : "BOZUK"} ${simdiki.slice(0, 16)}  ${dosya}`);
  if (simdiki !== ozet) hepsiYakalandi = false;
}
console.log(hepsiYakalandi ? "\nTÜM MUTASYONLAR YAKALANDI." : "\nEKSİK VAR.");
process.exitCode = hepsiYakalandi && bitisDurumu === baslangicDurumu ? 0 : 1;
