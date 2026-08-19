/**
 * İP-A3c · Mutasyon provası — nöbetçiler ve yeni koruma katmanı.
 *
 * İki kümeden oluşur:
 *
 *   A. **Eşik nöbetçileri** (`src/__guards__/`). İP-A3a sürücüsünün devamı;
 *      taban genişledi (65 → 71 dosya) ve eşikler yeniden ölçüldü, ayrıca
 *      taban artık dosya listesiyle sabitlendi. Denetimin bulduğu kaçış
 *      yolları (`React.createElement("button")`, Medusa alt-yol importu) da
 *      ayrıca sınanır.
 *
 *   B. **Sözleşme koruması** (`ui2/` + pilot). Bu paketin ana işi, sayacın
 *      yaslandığı vekili ("Form.Control içindeyse adlandırılmıştır") inşa
 *      yoluyla doğru yapmaktı. Buradaki mutasyonlar korumaları TEK TEK
 *      söker ve ilgili davranış testinin gerçekten kırıldığını gösterir.
 *      Denetimin M3/M3b mutasyonlarının karşılığı A3 ve A4'tür: o yazımlar
 *      artık geliştirmede patlıyor, yani sayaç dalını dürüstçe affedebiliyor.
 *
 * GÜVENLİK (kök CLAUDE.md §D): sürücü `git checkout --` KULLANMAZ. Dosyanın
 * ham baytları bellekte tutulur ve aynen geri yazılır; başlangıçta ve sonda
 * `git status --porcelain` çıktısı karşılaştırılır. Kirli çalışma ağacında da
 * güvenlidir çünkü yalnız kendi dokunduğu dosyayı geri yazar.
 *
 * Kullanım (frontend/ dizininden):  node scripts/ip_a3c_mutasyon.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NOBETCILER = "src/__guards__";
const FORM = "src/components/admin/ui2/form.tsx";
const FORM_TEST = "src/components/admin/ui2/form.test.tsx";
const BEKCI = "src/components/admin/ui2/kirliFormBekcisi.tsx";
const BEKCI_TEST = "src/components/admin/ui2/kirliFormBekcisi.test.tsx";
const PILOT = "src/components/admin/inventory/DamageDialog.tsx";
const PILOT_TEST = "src/components/admin/inventory/DamageDialog.test.tsx";
const SAYAC = "scripts/ui-baseline-sayim.mjs";
const AYRAC = '        <div className="flex justify-end gap-2">';

const MUTASYONLAR = [
  /* ═══════════════ A · eşik nöbetçileri ═══════════════ */
  {
    ad: "A1 · ham <button sayısı (JSX)",
    dosya: PILOT,
    hedef: NOBETCILER,
    uygula: (s) =>
      s.replace(AYRAC, `        <button type="button">Ham buton</button>\n${AYRAC}`),
    beklenen: /ham <button sayısı artamaz/,
  },
  {
    ad: 'A2 · KAÇIŞ YOLU: React.createElement("button")',
    dosya: PILOT,
    hedef: NOBETCILER,
    // Denetim P3-1: eski sayaç bunu görmüyordu (mutasyon M2 GEÇMİŞTİ).
    uygula: (s) =>
      s.replace(
        AYRAC,
        `        {React.createElement("button", null, "Ham")}\n${AYRAC}`
      ),
    beklenen: /ham <button sayısı artamaz/,
  },
  {
    ad: "A3 · erişilebilir adı olmayan form kontrolü",
    dosya: PILOT,
    hedef: NOBETCILER,
    uygula: (s) =>
      s.replace(
        AYRAC,
        `        <input className="input" placeholder="Serbest not" />\n${AYRAC}`
      ),
    beklenen: /erişilebilir adı olmayan form kontrolü artamaz/,
  },
  {
    ad: "A4 · ui2 dışı @medusajs/ui importu",
    dosya: PILOT,
    hedef: NOBETCILER,
    uygula: (s) => `import { Tooltip } from "@medusajs/ui";\n${s}`,
    beklenen: /ui2\/ dışında @medusajs\/ui import eden dosya yok/,
  },
  {
    ad: "A5 · KAÇIŞ YOLU: @medusajs/ui ALT YOL importu",
    dosya: PILOT,
    hedef: NOBETCILER,
    // Denetim P3-1: eski sayaç yalnız tam eşitliğe bakıyordu (M5 GEÇMİŞTİ).
    uygula: (s) =>
      `import { Tooltip } from "@medusajs/ui/dist/esm/components/tooltip";\n${s}`,
    beklenen: /ui2\/ dışında @medusajs\/ui import eden dosya yok/,
  },
  {
    ad: "A6 · etiketsiz overlay",
    dosya: PILOT,
    hedef: NOBETCILER,
    uygula: (s) =>
      s.replace(AYRAC, `        <div className="fixed inset-0 bg-black/40" />\n${AYRAC}`),
    beklenen: /overlay/,
  },
  {
    ad: "A7 · ÖLÇÜM TABANI: dosya listesinden bir dosya düşerse",
    dosya: SAYAC,
    hedef: NOBETCILER,
    // "Bir ekranı taban dışına taşımak eşiği düşürür ve ilerleme gibi okunur"
    // (denetim P1-4). Artık taban KİMLİKLE doğrulanıyor: liste değişirse test
    // kırılır, sayılar düşse bile.
    uygula: (s) => s.replace('  "src/pages/DeliveryDriver.tsx",\n', ""),
    beklenen: /ölçüm tabanı dosya listesi SABİTTİR/,
  },
  {
    ad: "A8 · SAYACIN KENDİSİ: kontrol tarayıcısı susturulursa",
    dosya: SAYAC,
    hedef: NOBETCILER,
    // Eskiden bunu `kontrolToplam >= 140` tabanı tutuyordu; o taban göçün
    // kendisi tarafından kırılacağı için KALDIRILDI. Ağ hâlâ var ama yeri
    // değişti: aleti ölçen `sayim.test.ts` yakalar.
    uygula: (s) =>
      s.replace(
        "      if (KONTROL_ETIKETLERI.has(ad)) {",
        "      if (false && KONTROL_ETIKETLERI.has(ad)) {"
      ),
    beklenen: /adsız kontroller gerçekten sayılır/,
  },

  /* ═══════════════ B · sözleşme koruması ═══════════════ */
  {
    ad: "B1 · Form.Control: Form.Item YOKKEN patlama kaldırılırsa (denetim M3)",
    dosya: FORM,
    hedef: FORM_TEST,
    uygula: (s) =>
      s.replace(
        "    if (!kimlik) {\n      throw new Error(\n        \"Form.Control, Form.Item dışında kullanıldı:",
        "    if (false) {\n      throw new Error(\n        \"Form.Control, Form.Item dışında kullanıldı:"
      ),
    beklenen: /K2 —/,
  },
  {
    ad: "B2 · Form.Control: Fragment çocuk patlaması kaldırılırsa (denetim M3b)",
    dosya: FORM,
    hedef: FORM_TEST,
    uygula: (s) =>
      s.replace("    if (cocuk.type === Fragment) {", "    if (false) {"),
    beklenen: /K3 —/,
  },
  {
    ad: "B3 · Form.Control: çalışma zamanı id ölçümü kaldırılırsa",
    dosya: FORM,
    hedef: FORM_TEST,
    uygula: (s) =>
      s.replace(
        "    if (dugum instanceof HTMLElement && dugum.id === kimlik.id) return;",
        "    return;"
      ),
    beklenen: /K4 —/,
  },
  {
    ad: "B4 · Form.Control: aria-describedby yine EZİLİRSE",
    dosya: FORM,
    hedef: FORM_TEST,
    uygula: (s) =>
      s.replace(
        '    [slotTanimi, typeof cocukTanimi === "string" ? cocukTanimi : null]',
        "    [slotTanimi, null]"
      ),
    beklenen: /K5 —/,
  },
  {
    ad: "B5 · Form.Item: Fragment içindeki Hint aranmazsa",
    dosya: FORM,
    hedef: FORM_TEST,
    uygula: (s) => s.replace("      if (c.type === Fragment) {", "      if (false) {"),
    beklenen: /K6 —/,
  },
  {
    ad: "B6 · Form.Item: gömülü Hint sessizce geçerse",
    dosya: FORM,
    hedef: FORM_TEST,
    uygula: (s) => s.replace("      if (GELISTIRME) gomuluSlotAra(c);", ""),
    beklenen: /K7 —/,
  },
  {
    ad: "B7 · Bekçi: öksüz onay penceresi temizliği kaldırılırsa",
    dosya: BEKCI,
    hedef: BEKCI_TEST,
    uygula: (s) =>
      s.replace(
        '      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));',
        ""
      ),
    beklenen: /M8 —/,
  },
  {
    ad: "B8 · Bekçi: gönderim sonrası yeniden kirlenme korumasız kalırsa",
    dosya: BEKCI,
    hedef: BEKCI_TEST,
    uygula: (s) =>
      s.replace(
        "  const kaydedildi = gonderimTemiz && damgaRef.current === anlikDegerler;",
        "  const kaydedildi = gonderimTemiz;"
      ),
    beklenen: /M9 —/,
  },
  {
    ad: "B9 · Pilot: odak ilk hatalı alana taşınmazsa",
    dosya: PILOT,
    hedef: PILOT_TEST,
    uygula: (s) =>
      s.replace("      ilkHatayaOdaklan(hatalar);", "      void hatalar;"),
    beklenen: /kaynak kova zorunlu kalır|eksiklerin HEPSİ/,
  },
  {
    ad: "B10 · Pilot: geçersiz veri sunucuya GİDERSE",
    dosya: PILOT,
    hedef: PILOT_TEST,
    // Kapı kalktı; "geçersiz veri gitmez" garantisi artık YALNIZ
    // `handleSubmit`in geçersizde `onGecerli`yi çağırmamasına dayanıyor.
    // Bu mutasyon o tek ipi keser.
    uygula: (s) =>
      s.replace(
        "  const gonder = form.handleSubmit(",
        "  const gonder = ((f) => () => f(form.getValues()))("
      ),
    beklenen: /gönderilebiliyor|görünür|gitmez|onay/i,
  },
];

function gitDurumu() {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd: "..",
    encoding: "utf8",
  });
}

function testKos(hedef) {
  try {
    const cikti = execFileSync(
      "npx",
      ["vitest", "run", hedef, "--reporter=basic"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true }
    );
    return { gecti: true, cikti };
  } catch (e) {
    return { gecti: false, cikti: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const baslangicDurumu = gitDurumu();

const hedefler = [...new Set(MUTASYONLAR.map((m) => m.hedef))];
for (const h of hedefler) {
  const ilk = testKos(h);
  if (!ilk.gecti) {
    console.error(`HATA: ${h} mutasyondan ÖNCE zaten kırmızı. Prova anlamsız.`);
    process.exit(1);
  }
}
console.log(`Taban: ${hedefler.length} hedef kümesinin hepsi YEŞİL.\n`);

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

  const yakalandi = !sonuc.gecti && m.beklenen.test(sonuc.cikti);
  hepsiYakalandi &&= yakalandi;
  console.log(
    `${yakalandi ? "✓" : "✗"} ${m.ad}: mutasyon ${
      sonuc.gecti ? "YAKALANMADI (nöbetçi geçti!)" : "yakalandı"
    }`
  );

  const geri = testKos(m.hedef);
  if (!geri.gecti) {
    console.error("  ✗ geri alma sonrası test hâlâ kırmızı — DUR.");
    process.exit(1);
  }
}

const sonDurum = gitDurumu();
if (sonDurum !== baslangicDurumu) {
  console.error("\n✗ ÇALIŞMA AĞACI DEĞİŞTİ — sürücü temiz kapanmadı.");
  console.error(`önce:\n${baslangicDurumu}\nsonra:\n${sonDurum}`);
  process.exit(1);
}
console.log("\nÇalışma ağacı başlangıçtaki hâline döndü.");
process.exit(hepsiYakalandi ? 0 : 1);
