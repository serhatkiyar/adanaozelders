/**
 * İP-A8 · Mutasyon provası — denetim #3 düzeltmelerinin ters provası.
 *
 * Her düzeltme için sorulan tek soru: **koruma söküldüğünde nöbetçi gerçekten
 * kırılıyor mu.** Bu turda üç kez "kapı yeşil" yanıltıcı çıktı; yeşil kapı
 * bir kanıt değil, kanıtın ön koşuludur.
 *
 * Kümeler:
 *
 *   A. **Dört eşik** — yükselmedi (102 / 7 / 0 / 0) ama sabit kalmaları
 *      korumanın çalıştığını GÖSTERMEZ; her biri gerçek JSX ile kırılır.
 *   B. **Kapının yeni çıpaları** (B-5 / B-7) — 403 kutusu ve "kontrol
 *      beklenmiyor" kaydı. Eski kapı ikisini de göremiyordu.
 *   C. **Sayaç kapsamı** (B-6) — `.ts` yeniden-dışavurum deliği.
 *   D. **Kirli form koruması** (B-1 / B-2) ve **iç içe ESC** (B-3).
 *   E. **Kaynak nöbetçisinin üç kör noktası** (Görev 3).
 *   F. **Kontrast/şema ve kilitli karar** (B-9 / B-10).
 *
 * GÜVENLİK (kök CLAUDE.md §D): sürücü `git checkout --` KULLANMAZ. Dosyanın
 * ham baytları bellekte tutulur ve aynen geri yazılır (CRLF korunur);
 * başlangıçta ve sonda `git status --porcelain` karşılaştırılır. Ayrıca
 * mutasyondan ÖNCE hedef testlerin YEŞİL olduğu doğrulanır — taban kırmızıyken
 * uygulanan bir mutasyon "yakalandı" görünürdü (A7d5'in eklediği kapı).
 *
 * Kullanım (frontend/ dizininden):  node scripts/ip_a8_mutasyon.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const KAPI = "src/__guards__/calismaZamaniKapisi.test.tsx";
const TABAN_NOBETCI = "src/__guards__/uiBaseline.test.ts";
const KORUMASIZ_NOBETCI = "src/__guards__/korumasizPencere.test.ts";
const SEMA_NOBETCI = "src/__guards__/renkSemasi.test.ts";
const GONDER_NOBETCI = "src/__guards__/gonderDugmesi.test.ts";
const DEDEKTOR = "src/components/admin/ui2/korumasizIcerik.test.tsx";
const OPERATOR_KABUL = "src/pages/dashboards/adminKutuphaneOperator.acceptance.test.tsx";

const IZINLER = "src/test-utils/adminIzinleri.ts";
const KUTUPHANELER = "src/pages/dashboards/AdminLibraries.tsx";
const MODAL_A11Y = "src/hooks/useModalA11y.ts";
const DIALOG = "src/components/admin/ui/Dialog.tsx";
const CSS = "src/index.css";
const SIPARISLER = "src/pages/admin/delivery/DeliveryOrdersPage.tsx";
const ROZET = "src/components/admin/ui/Badge.tsx";
const SAYFA_DURUMU = "src/components/admin/ui/PageState.tsx";
const ONAY_PENCERESI = "src/components/admin/ui/ConfirmDialog.tsx";

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

/** Sentetik kaçak: `.ts` barreli üzerinden bağlanan borç (denetim #3 · B-6). */
const KACAK_TSX = `export function A8Kacak() {
  return (
    <div>
      <button type="button">bir</button>
      <button type="button">iki</button>
      <button type="button">uc</button>
      <input type="text" />
      <textarea />
      <div className="fixed inset-0 bg-black/50" />
    </div>
  );
}
`;
const KACAK_TS = `export * from "./a8Kacak";\n`;

const MUTASYONLAR = [
  /* ── A. Dört eşik ── */
  {
    ad: "A1 · taban ekranına HAM <button> eklenirse (rawButton <= 102)",
    dosya: ROZET,
    hedef: TABAN_NOBETCI,
    uygula: (s) => degistir(s, "export function Badge(", "export function A8Ham() {\n  return <button type=\"button\">x</button>;\n}\n\nexport function Badge("),
    beklenen: /103|rawButton|ham/i,
  },
  {
    ad: "A2 · taban ekranına ADSIZ kontrol eklenirse (adsizKontrol <= 7)",
    dosya: ROZET,
    hedef: TABAN_NOBETCI,
    uygula: (s) => degistir(s, "export function Badge(", "export function A8Adsiz() {\n  return <input type=\"text\" />;\n}\n\nexport function Badge("),
    beklenen: /adsiz|8|erişilebilir/i,
  },
  {
    ad: "A3 · ekranda pencere durumu (`useState` → `open`) doğarsa (modalDurumu === 0)",
    dosya: ONAY_PENCERESI,
    hedef: TABAN_NOBETCI,
    // ÖNEMLİ: metrik "useState var mı" DEĞİL, "bir durum pencerenin `open`ına
    // AKIYOR mu" sorusudur (İP-A6b · Görev 4, sabit nokta hesabı). İlk yazımda
    // mutasyon pencereye bağlanmayan çıplak bir `useState` ekliyordu ve haklı
    // olarak YAKALANMADI — kusurlu olan nöbetçi değil mutasyondu (kök
    // CLAUDE.md §I). Doğru şekli: durum `<Dialog open={…}>`a bağlanır.
    uygula: (s) =>
      degistir(
        s,
        'import { useCallback, useMemo } from "react";',
        'import { useCallback, useMemo, useState } from "react";'
      ).replace(
        "export function ConfirmDialog(",
        [
          "export function A8Modal() {",
          "  const [modalAcik, setModalAcik] = useState(false);",
          '  return <Dialog open={modalAcik} title="A8" onClose={() => setModalAcik(false)}><span /></Dialog>;',
          "}",
          "",
          "export function ConfirmDialog(",
        ].join("\n")
      ),
    beklenen: /modalDurum|pencere durumu|A8Modal|useState/i,
  },
  {
    ad: "A4 · etiketsiz overlay doğarsa (unlabeledOverlays === 0)",
    dosya: ROZET,
    hedef: TABAN_NOBETCI,
    uygula: (s) =>
      degistir(
        s,
        "export function Badge(",
        "export function A8Overlay() {\n  return <div className=\"fixed inset-0 bg-black/50\" />;\n}\n\nexport function Badge("
      ),
    beklenen: /overlay|etiketsiz/i,
  },

  /* ── B. Kapının yeni çıpaları (B-5 / B-7) ── */
  {
    ad: "B1 · fixture'dan bir izin düşerse ekran 403 kutusu basar (B-5 çıpası)",
    dosya: IZINLER,
    hedef: KAPI,
    uygula: (s) => degistir(s, '  "libraries.view",\n  "libraries.manage",\n', ""),
    beklenen: /403 kutusu|OLCULMUS SAYILMAZ/,
  },
  {
    ad: "B2 · kontrol basan bir ekran susarsa (B-7 kimlik çıpası)",
    dosya: "src/components/admin/store/CouponsPanel.tsx",
    hedef: KAPI,
    // Süzgeç formunu kapatmak = ekran artık kontrol basmıyor. Eski kapı bunu
    // GÖREMEZDİ: `expect(adsiz).toBe(0)` sıfır kontrolde de geçerdi.
    uygula: (s) => degistir(s, 'const { canView, canManage } = useAdminAreaAccess("coupons");', 'const { canView, canManage } = useAdminAreaAccess("coupons");\n  if (canView) return <p>A8</p>;'),
    beklenen: /HIC kontrol yok|totoloji|KONTROLSUZ_EKRANLAR/,
  },

  /* ── C. Sayaç kapsamı (B-6) ── */
  {
    ad: "C1 · `.ts` barreli üzerinden bağlanan borç (B-6 sentetik kaçağı)",
    hedef: TABAN_NOBETCI,
    yeniDosyalar: [
      { yol: "src/lib/a8Kacak.tsx", icerik: KACAK_TSX },
      { yol: "src/lib/a8Barrel.ts", icerik: KACAK_TS },
    ],
    dosya: SAYFA_DURUMU,
    uygula: (s) => 'import "@/lib/a8Barrel";\n' + s,
    beklenen: /a8Kacak|fazlaDosyalar/,
  },

  /* ── D. Kirli form koruması ve iç içe ESC ── */
  {
    ad: "D1 · operatör formunun bekçisi sökülürse (B-1 regresyonu)",
    dosya: KUTUPHANELER,
    hedef: OPERATOR_KABUL,
    uygula: (s) =>
      degistir(
        s,
        "  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: create.error });\n",
        ""
      ),
    // Kancanın HİÇ çağrılmaması B-1'in birebir şeklidir: pencere bekçiyi
    // tanımaz, ×/ESC/dış tıklama dört alanı sormadan siler.
    //
    // İLK YAZIMDA bu mutasyon `pencereSiz: true` EKLEMEKti ve YAKALANMADI —
    // haklı olarak: `pencereSiz` yalnız beyansız-sağlayıcısız çağrının
    // `throw`unu susturur, bildirimi kesmez (A7d2 · SK-3 tablosu:
    // "sağlayıcı var + beyan var → geçer"). Yani kusurlu olan nöbetçi değil
    // mutasyonun kendisiydi; kayda geçirildi (kök CLAUDE.md §I).
    beklenen: /Kaydedilmemiş değişiklikler var|KİRLİ formda ESC|kirli form bekçisi kaydolmadı/,
  },
  {
    ad: "D2 · dedektör panel içeriğini izlemeyi bırakırsa (B-2 regresyonu)",
    dosya: DIALOG,
    hedef: DEDEKTOR,
    uygula: (s) => degistir(s, "    const gozlemci = new MutationObserver(() => {", "    const gozlemci = { observe() {}, disconnect() {} };\n    const _kullanilmayan = (() => {"),
    beklenen: /alanlar SONRADAN doğuyor|B-1/,
  },
  {
    ad: "D3 · ESC yığını kalkarsa (B-3 regresyonu)",
    dosya: MODAL_A11Y,
    hedef: OPERATOR_KABUL,
    uygula: (s) => degistir(s, "      if (!enUsttekiMi()) return;\n", ""),
    beklenen: /iki pencereyi birden|EN İÇTEKİ/,
  },

  /* ── E. Kaynak nöbetçisinin üç kör noktası ── */
  {
    ad: "E1 · `korumasiz` beyanının DEĞERİ okunmazsa",
    dosya: "scripts/korumasiz-pencere.mjs",
    hedef: KORUMASIZ_NOBETCI,
    uygula: (s) =>
      degistir(
        s,
        "function korumasizBeyani(node) {\n  const o = ozellik(node, \"korumasiz\");\n  if (!o) return false;",
        "function korumasizBeyani(node) {\n  const o = ozellik(node, \"korumasiz\");\n  return !!o;\n  // eslint-disable-next-line no-unreachable\n  if (!o) return false;"
      ),
    beklenen: /korumasiz=\{false\}|beyan SAYILMAZ/,
  },
  {
    ad: "E2 · değişkene alınmış içerik çözülmezse",
    dosya: "scripts/korumasiz-pencere.mjs",
    hedef: KORUMASIZ_NOBETCI,
    uygula: (s) =>
      degistir(
        s,
        "            const hedef = jsxDegiskenleri.get(m.expression.text);",
        "            const hedef = undefined;"
      ),
    beklenen: /DEĞİŞKENE alınmış|satır içi/,
  },
  {
    ad: "E3 · bekçi bayrağı yine DOSYA KAPSAMLI olursa",
    dosya: "scripts/korumasiz-pencere.mjs",
    hedef: KORUMASIZ_NOBETCI,
    uygula: (s) =>
      degistir(s, "  const bekciAtfedilebilir = bekciVar && pencereSayisi <= 1;", "  const bekciAtfedilebilir = bekciVar;"),
    beklenen: /ikinci pencere|atfedilemez|KİMLİKLE/,
  },

  /* ── F. Şema ve kilitli karar ── */
  {
    ad: "F1 · kök `color-scheme` bildirimi silinirse (B-9 regresyonu)",
    dosya: CSS,
    hedef: SEMA_NOBETCI,
    uygula: (s) => degistir(s, "    color-scheme: light;\n  }\n  html.dark {\n    color-scheme: dark;\n  }", "  }"),
    beklenen: /color-scheme/,
  },
  {
    ad: "F2 · gönder düğmesi yine geçerlilikle kapanırsa (B-10 regresyonu)",
    dosya: SIPARISLER,
    hedef: GONDER_NOBETCI,
    uygula: (s) =>
      degistir(
        s,
        "          isPending={islemSuruyor}\n        >\n          Kargola",
        "          isPending={islemSuruyor}\n          disabled={!deger.trim()}\n        >\n          Kargola"
      ),
    beklenen: /sınıflandırılmamış disabled|trim/,
  },
];

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

// ── YEŞİL TABAN KAPISI ──
// Taban kırmızıyken uygulanan bir mutasyon "YAKALANDI" görünürdü. Bu kapı
// A7d5'te eklendi ve bağımsız denetim #3 (§6f) geçmiş provaların geçerliliği
// için tam olarak bunu sormuştu.
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
  const geriAlmalar = [];

  for (const yeni of m.yeniDosyalar ?? []) {
    writeFileSync(yeni.yol, yeni.icerik, "utf8");
    geriAlmalar.push(() => rmSync(yeni.yol, { force: true }));
  }

  if (m.uygula) {
    const orijinal = readFileSync(m.dosya, "utf8");
    const bozuk = m.uygula(orijinal);
    if (bozuk === orijinal) {
      console.error(`✗ ${m.ad}: mutasyon UYGULANAMADI (desen bulunamadı).`);
      hepsiYakalandi = false;
      for (const g of geriAlmalar.reverse()) g();
      continue;
    }
    writeFileSync(m.dosya, bozuk, "utf8");
    geriAlmalar.push(() => writeFileSync(m.dosya, orijinal, "utf8"));
  }

  const sonuc = testKos(m.hedef);
  for (const g of geriAlmalar.reverse()) g();

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
console.log(hepsiYakalandi ? "TÜM MUTASYONLAR YAKALANDI." : "EKSİK VAR.");
process.exitCode = hepsiYakalandi && bitisDurumu === baslangicDurumu ? 0 : 1;
