/**
 * Korumasız pencere taraması (İP-A7d4 · Görev 1 · statik yarı).
 *
 * ## Neden çalışma zamanı dedektörünün YANINDA bir de bu var
 *
 * Çalışma zamanı dedektörü (`ui2/icerikKorumasi.ts` → `ui/Dialog`) doğru
 * cevabı verir ama **yalnız RENDER EDİLEN pencereyi** görür. Bu paket o
 * sınırı ölçtü ve sonuç net: dedektör tam suite'te (1507 test) **hiçbir şey
 * yakalamadı**, oysa panelde o anda BEŞ ekranın penceresi korumasızdı. Sebep
 * basit — o pencereleri açan bir test yoktu.
 *
 * Yani "çalışma zamanı dedektörü var" demek "kusur CI'da görünür" demek
 * DEĞİLDİR; ancak o pencereyi açan bir test de varsa öyledir. Bu tarama
 * kalan deliği kapatır: kaynağa bakar, render gerektirmez, ölçüm tabanındaki
 * HER pencereyi görür.
 *
 * ## Bu taramanın kendi sınırı (CLAUDE.md §C: kaynak sözleşmesi DÜŞÜK GÜÇLÜ)
 *
 * Yalnız **tek dosya içini** görebilir. SK-4'te pencere `EditProductModal`,
 * alanlar `ProductForm`daydı; bu tarama o kusuru göremezdi — çalışma zamanı
 * dedektörü görür. İkisi birbirinin kör noktasını kapatıyor ve **hiçbiri tek
 * başına yeterli değil**; rapor bunu böyle yazar.
 *
 * Sınırı daraltan tek şey şudur: pencere JSX'inde büyük harfli bir bileşen
 * varsa (yani alanlar başka dosyada olabilir) bulgu "belirsiz" sayılır ve
 * SESSİZCE temiz yazılmaz — `belirsiz` listesine düşer.
 *
 * ## İP-A8 · Görev 3 — kapatılan ÜÇ kör nokta
 *
 * Bağımsız denetim #3 taramayı doğrudan çağırarak üç yazımın **sessizce
 * temiz** geçtiğini ölçtü (ne bulgu ne belirsiz):
 *
 *   1. **`korumasiz={false}`** — beyan kontrolü özniteliğin VARLIĞINA
 *      bakıyordu, değerine değil. "Korumasızım ama değilim" diye bir durum
 *      yok; artık değer okunuyor ve `false` beyan SAYILMAZ.
 *   2. **Değişkene alınmış içerik** — `const govde = <input/>;
 *      <Dialog>{govde}</Dialog>`. Küçük harfli JSX ifadesi ne kontrol ne
 *      bileşen sayılıyordu. Artık aynı dosyadaki JSX değişkenleri çözülüp
 *      pencerenin içine SATIR İÇİ alınıyor (çevrim koruması var).
 *   3. **Aynı dosyada ikinci pencere** — dosyada herhangi bir bekçi kancası
 *      görülünce `bekciVar` bütün dosyayı affediyordu. Bir dosyada bir
 *      korumalı + bir korumasız pencere varsa ikincisi görünmüyordu. Bekçi
 *      artık yalnız dosyada TEK pencere varken atfedilebilir sayılır; birden
 *      çok pencerede kontrol taşıyan pencereler `belirsiz`e düşer
 *      (`sebep: "atfedilemez-bekci"`) — sessizce temiz YAZILMAZ.
 *
 * ## Kural
 *
 * Ölçüm tabanındaki bir `.tsx` dosyasında `<Dialog>` ya da
 * `<DuzenlemePenceresi>` JSX'i varsa ve o JSX'in ALTINDA düzenlenebilir bir
 * kontrol yazılıysa, dosya ya bir kirli form bekçisi çağırmalı ya da pencere
 * `korumasiz` beyanı taşımalıdır. Üçüncü ihtimal yok.
 *
 * `<DuzenlemeYuzeyi>` taranmaz: o yüzey bekçiyi kendi bağlar (sözleşmesi
 * gereği `form` prop'u ZORUNLUDUR), dolayısıyla korumasız olamaz.
 *
 * ## Yorum ve dize yanlış pozitif üretmez
 *
 * Tarama AST üzerindedir: `find()` + karakter penceresi KULLANILMAZ (§C).
 * Bir yorumda ya da dizede geçen `<textarea>` metni JSX düğümü değildir ve
 * sayılmaz — bu dosyanın kendi başlığındaki `<Dialog>` sözcükleri dahil.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { OLCUM_TABANI } from "./ui-baseline-sayim.mjs";

const ROOT = process.cwd();

/** Pencere kuran JSX etiketleri. `DuzenlemeYuzeyi` bekçiyi kendi bağlar. */
const PENCERE_ETIKETLERI = new Set(["Dialog", "DuzenlemePenceresi"]);

/** Bekçiyi kuran kanca adları — biri çağrılıyorsa dosyada koruma vardır. */
const BEKCI_KANCALARI = new Set(["useYuzeyKirliFormBekcisi", "useKirliFormBekcisi"]);

/** Veri taşımayan `<input type>` değerleri (kapatınca kaybedilecek şey yok). */
const VERISIZ_INPUT = new Set(["hidden", "button", "submit", "reset", "image"]);

const GIRDI_ETIKETLERI = new Set(["input", "textarea", "select"]);

function etiketAdi(node) {
  const ad = ts.isJsxElement(node)
    ? node.openingElement.tagName
    : ts.isJsxSelfClosingElement(node)
      ? node.tagName
      : null;
  return ad ? ad.getText() : null;
}

function ozellik(node, ad) {
  const acilis = ts.isJsxElement(node) ? node.openingElement : node;
  if (!acilis.attributes) return null;
  for (const o of acilis.attributes.properties) {
    if (ts.isJsxAttribute(o) && o.name.getText() === ad) return o;
  }
  return null;
}

/**
 * `korumasiz` beyanı GERÇEKTEN var mı — özniteliğin DEĞERİ okunur.
 *
 * `<Dialog korumasiz>` ve `<Dialog korumasiz={true}>` beyandır;
 * `<Dialog korumasiz={false}>` DEĞİLDİR. Eski hâl özniteliğin varlığına
 * bakıyordu ve `{false}` taramayı atlatıyordu (İP-A8 · Görev 3).
 * Bilinmeyen/dinamik bir değer (`korumasiz={bayrak}`) beyan sayılmaz:
 * güvenli taraf taramaktır.
 */
function korumasizBeyani(node) {
  const o = ozellik(node, "korumasiz");
  if (!o) return false;
  if (!o.initializer) return true; // çıplak `korumasiz`
  const i = o.initializer;
  if (ts.isJsxExpression(i) && i.expression) {
    return i.expression.kind === ts.SyntaxKind.TrueKeyword;
  }
  return false;
}

/** `<input type="hidden">` gibi veri taşımayan bir kontrol mü. */
function verisizInputMu(node) {
  const tip = ozellik(node, "type");
  if (!tip || !tip.initializer) return false;
  const i = tip.initializer;
  if (ts.isStringLiteral(i)) return VERISIZ_INPUT.has(i.text);
  return false; // dinamik tip: veri taşıyor say (güvenli taraf)
}

/**
 * Bir dosyanın korumasız pencerelerini bulur.
 *
 * @returns {{bulgular: {pencere: string, satir: number, kontroller: string[]}[],
 *            belirsiz: {pencere: string, satir: number, bilesenler: string[]}[]}}
 */
export function korumasizPencereler(kaynak, dosyaAdi = "olcum.tsx") {
  const sf = ts.createSourceFile(dosyaAdi, kaynak, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // (1) Dosyada bekçi kancası çağrılıyor mu — AST çağrısı, metin değil.
  let bekciVar = false;
  const bekciAra = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && BEKCI_KANCALARI.has(n.expression.text)) {
      bekciVar = true;
    }
    ts.forEachChild(n, bekciAra);
  };
  bekciAra(sf);

  // (2) Aynı dosyada JSX'e bağlanmış değişkenler — `<Dialog>{govde}</Dialog>`
  //     yazımı içeriği taramadan kaçırıyordu (İP-A8 · Görev 3 · kör nokta 2).
  const jsxDegiskenleri = new Map();
  const jsxSoy = (n) => {
    let d = n;
    while (d && ts.isParenthesizedExpression(d)) d = d.expression;
    return d && (ts.isJsxElement(d) || ts.isJsxSelfClosingElement(d) || ts.isJsxFragment(d)) ? d : null;
  };
  const degiskenAra = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const jsx = jsxSoy(n.initializer);
      if (jsx) jsxDegiskenleri.set(n.name.text, jsx);
    }
    ts.forEachChild(n, degiskenAra);
  };
  degiskenAra(sf);

  // (3) Dosyadaki pencere sayısı — bekçinin ATFEDİLEBİLİRLİĞİ buna bağlı.
  //     Eskiden `bekciVar` tek başına bütün dosyayı affediyordu: bir dosyada
  //     bir korumalı + bir korumasız pencere varsa ikincisi görünmüyordu
  //     (İP-A8 · Görev 3 · kör nokta 3).
  let pencereSayisi = 0;
  const pencereSay = (n) => {
    const ad = etiketAdi(n);
    if (ad && PENCERE_ETIKETLERI.has(ad)) pencereSayisi += 1;
    ts.forEachChild(n, pencereSay);
  };
  pencereSay(sf);

  const bulgular = [];
  const belirsiz = [];
  // Bekçi ancak dosyada TEK pencere varsa ona atfedilebilir.
  const bekciAtfedilebilir = bekciVar && pencereSayisi <= 1;
  if (bekciAtfedilebilir) return { bulgular, belirsiz };

  const gez = (n) => {
    const ad = etiketAdi(n);
    if (ad && PENCERE_ETIKETLERI.has(ad)) {
      if (korumasizBeyani(n)) return; // beyanlı — meşru, taranmaz
      const kontroller = [];
      const bilesenler = [];
      const cozulen = new Set();
      const alt = (m) => {
        if (m !== n) {
          const a = etiketAdi(m);
          if (a) {
            if (GIRDI_ETIKETLERI.has(a) && !verisizInputMu(m)) kontroller.push(a);
            else if (a === "Form.Control") kontroller.push(a);
            else if (/^[A-Z]/.test(a) && !PENCERE_ETIKETLERI.has(a)) bilesenler.push(a);
          }
          // Değişkene alınmış içerik SATIR İÇİ alınır: `{govde}` gibi bir
          // ifade aynı dosyada JSX'e bağlıysa o JSX de pencerenin içidir.
          if (ts.isJsxExpression(m) && m.expression && ts.isIdentifier(m.expression)) {
            const hedef = jsxDegiskenleri.get(m.expression.text);
            if (hedef && !cozulen.has(hedef)) {
              cozulen.add(hedef);
              alt(hedef);
            }
          }
        }
        ts.forEachChild(m, alt);
      };
      alt(n);
      const satir = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      if (kontroller.length) {
        // Dosyada bekçi VAR ama birden çok pencere olduğu için hangisine ait
        // olduğu kaynaktan bilinemez. Sessizce temiz yazmak yerine BELİRSİZ:
        // nöbetçinin listesi kimlikle sabit olduğu için yeni bir giriş
        // kırmızı üretir.
        if (bekciVar) {
          belirsiz.push({ pencere: ad, satir, bilesenler: [...new Set(bilesenler)], sebep: "atfedilemez-bekci" });
        } else {
          bulgular.push({ pencere: ad, satir, kontroller });
        }
      } else if (bilesenler.length) {
        belirsiz.push({ pencere: ad, satir, bilesenler: [...new Set(bilesenler)], sebep: "capraz-dosya" });
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return { bulgular, belirsiz };
}

/** Ölçüm tabanının tamamını tarar; `dosya` anahtarlı düz liste döner. */
export function tabanTaramasi(taban = OLCUM_TABANI) {
  const bulgular = [];
  const belirsiz = [];
  for (const dosya of taban) {
    if (!dosya.endsWith(".tsx")) continue;
    const kaynak = readFileSync(join(ROOT, dosya), "utf8");
    const sonuc = korumasizPencereler(kaynak, dosya);
    for (const b of sonuc.bulgular) bulgular.push({ dosya, ...b });
    for (const b of sonuc.belirsiz) belirsiz.push({ dosya, ...b });
  }
  return { bulgular, belirsiz };
}

if (process.argv[1] && process.argv[1].endsWith("korumasiz-pencere.mjs")) {
  const { bulgular, belirsiz } = tabanTaramasi();
  console.log("KORUMASIZ PENCERE:", bulgular.length);
  for (const b of bulgular) console.log(` ${b.dosya}:${b.satir} <${b.pencere}> [${b.kontroller.join(", ")}]`);
  console.log("BELİRSİZ (alanlar başka dosyada olabilir):", belirsiz.length);
  for (const b of belirsiz) console.log(` ${b.dosya}:${b.satir} <${b.pencere}> [${b.bilesenler.join(", ")}]`);
}
