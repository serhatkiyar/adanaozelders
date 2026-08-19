/**
 * İP-A1/A2 nöbetçi taban sayımı (İP-A0 `sayim.sh`'in taşınabilir Node sürümü).
 *
 * ## Neden AST (İP-A2 düzeltmesi)
 *
 * İlk sürüm (İP-A1) sayımı ham metin üzerinde regex ile yapıyordu. Bu iki
 * yanlışı birden üretiyordu:
 *
 *   1. **Yorum satırları sayılıyordu.** Bir satır yorumunda ya da JSX içine
 *      gömülü blok yorumda geçen `<button` gerçek bir buton sanılıyordu.
 *   2. **String/şablon içerikleri sayılıyordu.** Bir örnek metninde geçen
 *      `<label htmlFor=…` oran paydasını şişiriyordu.
 *
 * Yön "artamaz" olduğu için bu sessiz geçiş üretmiyordu; ama İP-A6/A7'de
 * eşikler AŞAĞI çekilecek ve yorumda kalmış tek bir `<button` **meşru bir
 * düşüşü bloklardı** — nöbetçi, düzeltmeyi cezalandırırdı.
 *
 * Çözüm satır penceresi ya da "önce yorumları sil" tarzı bir metin ön temizliği
 * DEĞİL: bu kod tabanı Türkçe ve JSX metinleri kesme işaretiyle dolu
 * (`Medusa'nın`, `preset'in`). Elle yazılmış bir tarayıcı o kesme işaretini
 * string başlangıcı sanar ve dosyanın yarısını yutar. Bu yüzden sayım
 * TypeScript'in kendi parser'ıyla üretilen **AST** üzerinde yapılır
 * (kök CLAUDE.md §C: sınıf/fonksiyon sınırı AST ile bulunmalı).
 *
 * Yan kazanç: `<button` ile `<ButtonGroup` ayrımı, kendi kapanan `<button />`
 * biçimi ve `role={"dialog"}` gibi ifade biçimleri artık doğru okunuyor.
 *
 * Hem CLI'dan (`node scripts/ui-baseline-sayim.mjs`) hem testten çağrılır.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";

// Hem CLI (`node scripts/...`) hem Vitest, çalışma dizini `frontend/` iken koşar.
// Vitest kaynağı dönüştürdüğü için `import.meta.url` dosya URL'i olmayabilir;
// bu yüzden kök cwd'den alınır ve varlığı doğrulanır.
const ROOT = process.cwd();
if (!existsSync(join(ROOT, "src")) || !existsSync(join(ROOT, "package.json"))) {
  throw new Error(
    `ui-baseline-sayim: calisma dizini frontend/ olmali, bulundu: ${ROOT}`
  );
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const name of entries) {
    const r = posix.join(dir, name);
    if (statSync(join(ROOT, r)).isDirectory()) walk(r, out);
    // Test dosyaları ÖLÇÜM DIŞI: taban, kullanıcıya sevk edilen arayüzü ölçer.
    // Test fixture'larındaki `<button>`/`<label>` kasten ilkeldir (erişilebilirlik
    // sözleşmesini kanıtlamak için ham etiket gerekir) ve borç sayılamaz. İP-A2'de
    // ui2/ ve inventory/ altına ilk test dosyaları girince taban 126'dan 128'e
    // "yükseldi"; sayılan şey borç değil, borcu ölçen testlerdi.
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(r);
  }
  return out;
}

/**
 * Ölçüm tabanına DİZİN kuralıyla girmeyen, ama aynı panel kabuğunu kullanan ve
 * aynı göçe girecek ekranlar (İP-A3c · denetim P1-4).
 *
 * Taban eskiden yalnız `components/admin/**` + `pages/admin/**` +
 * `dashboards/Admin*.tsx` idi. Aşağıdaki altı ekran `DashboardShell`
 * kullanıyor, aynı `admin/ui` parçalarını çağırıyor ve A6-A7'de göç edecek —
 * ama ölçümün DIŞINDAYDI. İki ayrı zarar üretiyordu: (a) nöbetçi bu bölgede
 * borcun büyümesine izin veriyordu, (b) bir ekranı taban dışına taşımak eşiği
 * düşürüyor ve "ilerleme" gibi okunuyordu.
 *
 * `DeliveryDriver.tsx` kök CLAUDE.md'ye göre ADMIN rolünün saha ekranıdır ve
 * tek başına 19 ham buton taşıyordu — ölçülen 126'nın %15'i, tamamen görünmez.
 */
export const EK_TABAN_DOSYALARI = [
  "src/pages/DeliveryDriver.tsx",
  "src/pages/DeliveryRunHandover.tsx",
  "src/pages/dashboards/CourierHome.tsx",
  "src/pages/dashboards/OperatorHome.tsx",
  "src/pages/dashboards/OperatorLibrary.tsx",
  "src/pages/dashboards/OperatorSessions.tsx",
];

/** Ölçüm tabanı: admin bileşenleri + admin sayfaları + panel ekranları. */
export function adminBase() {
  const files = [...walk("src/components/admin"), ...walk("src/pages/admin")];
  for (const f of walk("src/pages/dashboards")) {
    if (/\/Admin[^/]*\.tsx$/.test(f)) files.push(f);
  }
  for (const f of EK_TABAN_DOSYALARI) {
    if (existsSync(join(ROOT, f))) files.push(f);
  }
  return [...new Set(files)].sort();
}

/** Tüm kaynak ağacı. */
export function allSource() {
  return walk("src").sort();
}

const read = (f) => readFileSync(join(ROOT, f), "utf8");

/** Baskı katmanları gerçek overlay değildir — isimle sabitlenmiş istisna listesi. */
export const PRINT_LAYERS = [
  "src/components/admin/delivery/LabelSheet.tsx",
  "src/components/admin/packing/PackageLabel.tsx",
  "src/components/admin/packing/PackingLabelSheet.tsx",
];

/** `role="dialog"` + `aria-modal` taşımayan gerçek overlay'i olan dosyalar (İP-A0 tespiti). */
export const UNLABELED_OVERLAY_FILES = [
  "src/pages/admin/AdminPayoutsPage.tsx",
  "src/pages/dashboards/AdminExamCatalogs.tsx",
  "src/pages/dashboards/AdminLibraries.tsx",
  "src/pages/dashboards/AdminStore.tsx",
];

const MEDUSA = "@medusajs/ui";

/**
 * Medusa'ya doğrudan bağımlılık mı?
 *
 * ── Kaçış yolu 2 (İP-A3c · denetim P3-1, mutasyon M5 GEÇMİŞTİ) ──
 * Paket kökü yerine ALT YOL yazmak (`@medusajs/ui/dist/esm/components/button`)
 * mimari kuralı aynen çiğner ama eski kontrol yalnız tam eşitliğe bakıyordu.
 */
const medusaYolu = (metin) => metin === MEDUSA || metin.startsWith(`${MEDUSA}/`);

/** Erişilebilir ad araması yapılan form kontrolleri. */
const KONTROL_ETIKETLERI = new Set(["input", "select", "textarea"]);

/**
 * ÖLÇÜM DIŞI `<input type=…>` değerleri ve gerekçeleri.
 *
 *   - `hidden`   → hiç render edilmez, odaklanamaz; etiketlenecek bir yüzeyi yok.
 *   - `submit` / `reset` / `button` / `image` → HTML'de **labelable değildirler**
 *     (`<label>` bu tiplere bağlanamaz); erişilebilir adları kendi
 *     `value`/`alt` içeriklerinden gelir. Bunları borç saymak, kapatılması
 *     imkânsız bir borç üretirdi.
 *
 * `checkbox`/`radio` ÖLÇÜM İÇİNDEDİR: ikisi de labelable'dır ve panelde
 * etiketsiz kutucuk gerçek bir erişilebilirlik borcudur.
 *
 * Tipten bağımsız İKİNCİ bir ölçüm dışı kural daha var: `hidden` özniteliği
 * taşıyan kontrol (`display:none`) erişilebilirlik ağacında yoktur. Bunlar
 * `ref` ile tetiklenen dosya seçicileridir; görünen tetikleyici kendi
 * etiketini taşır. Sadece `className`'de "hidden" geçmesi YETMEZ — dinamik
 * olabilir; `sr-only` ise zaten görünmez ama OKUNUR, ölçüm içinde kalır.
 */
export const OLCUM_DISI_INPUT_TIPLERI = new Set([
  "hidden",
  "submit",
  "reset",
  "button",
  "image",
]);

/** Bir kontrolü "adlandırılmış" sayan sarmalayıcı bileşenler. */
const KONTROL_SARMALAYICILARI = new Set(["Form.Control"]);

/** Bir JSX özniteliğinin (varsa) düz metin değeri; `x="a"` ve `x={"a"}` aynı okunur. */
function ozniteligeDeger(init) {
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      return e.text;
    }
  }
  return null;
}

/**
 * TEK BİR DOSYANIN ölçümü — saf fonksiyon, dosya sistemine dokunmaz.
 *
 * Testten doğrudan çağrılabilsin diye ayrıldı: sayacın yorum/string
 * saymadığını kanıtlamanın yolu, ona elde yazılmış bir kaynak vermektir.
 */
export function dosyaOlcumu(kaynak, dosyaAdi = "olcum.tsx") {
  const sf = ts.createSourceFile(
    dosyaAdi,
    kaynak,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.tsx$/.test(dosyaAdi) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const o = {
    rawButton: 0,
    labels: 0,
    labelsWithHtmlFor: 0,
    overlays: 0,
    dialogRoles: 0,
    ariaModals: 0,
    medusaImport: false,
    // Erişilebilir adı olmayan form kontrolleri (İP-A3a metriği).
    kontrolToplam: 0,
    adsizKontrol: 0,
    adsizKontrolSatirlari: [],
    olcumDisiKontrol: 0,
  };

  // Kontrol ↔ etiket bağı DOSYA ÖLÇEĞİNDE kurulur: `<label htmlFor={x}>` ile
  // `<input id={x}>` aynı JSX ağacında kardeş bile olmayabilir. Bu yüzden
  // önce dosyadaki bütün `htmlFor` değerleri toplanır, kontroller sonra
  // taranır. Karşılaştırma özniteliğin KAYNAK METNİ üzerinden yapılır; böylece
  // `htmlFor="ad"`↔`id="ad"` kadar `htmlFor={uid}`↔`id={uid}` de eşleşir.
  const htmlForDegerleri = new Set();
  const htmlForTopla = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      if (n.tagName.getText(sf) === "label") {
        for (const p of n.attributes.properties) {
          if (ts.isJsxAttribute(p) && p.name.getText(sf) === "htmlFor" && p.initializer) {
            htmlForDegerleri.add(p.initializer.getText(sf).replace(/\s+/g, ""));
          }
        }
      }
    }
    ts.forEachChild(n, htmlForTopla);
  };
  htmlForTopla(sf);

  // ── Yerel etiket sarmalayıcıları ──
  //
  // Bu kod tabanında yaygın bir desen var:
  //
  //     function Field({ label, children }) {
  //       return <label className="…">{label}{children}</label>;
  //     }
  //     …
  //     <Field label="Araç adı"><input … /></Field>
  //
  // Buradaki `<input>` ÇALIŞMA ZAMANINDA `<label>` içinde sarmalanmıştır ve
  // erişilebilir adı vardır — ama JSX ağacında atası `<Field>`tir, `<label>`
  // değil. Bu tespit olmadan sayaç `DeliveryVehiclesPage`'in 18 alanını borç
  // sayıyordu; ölçüm gerçek borcu 18 fazla gösterirdi.
  //
  // Tespit AYNI DOSYAYLA sınırlıdır: başka dosyadan import edilen bir
  // sarmalayıcı görünmez. Kalan yanlış pozitif riski raporda listelenir.
  const sarmalayiciAdlari = new Set();
  const kapsayanAd = (n) => {
    for (let a = n.parent; a; a = a.parent) {
      if (ts.isFunctionDeclaration(a) && a.name) return a.name.getText(sf);
      if (
        (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) &&
        a.parent &&
        ts.isVariableDeclaration(a.parent) &&
        a.parent.name
      ) {
        return a.parent.name.getText(sf);
      }
    }
    return null;
  };
  const sarmalayiciTopla = (n) => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === "label") {
      // `<label>` içinde `{children}` geçiyor mu?
      let cocukAktarimi = false;
      const ara = (m) => {
        if (ts.isJsxExpression(m) && m.expression) {
          const e = m.expression;
          const metin = e.getText(sf).replace(/\s+/g, "");
          if (metin === "children" || metin === "props.children") {
            cocukAktarimi = true;
          }
        }
        ts.forEachChild(m, ara);
      };
      n.children.forEach(ara);
      if (cocukAktarimi) {
        const ad = kapsayanAd(n);
        if (ad) sarmalayiciAdlari.add(ad);
      }
    }
    ts.forEachChild(n, sarmalayiciTopla);
  };
  sarmalayiciTopla(sf);

  /** Bir JSX düğümünün ataları arasında verilen etiketlerden biri var mı? */
  const atadaVarMi = (n, kabul) => {
    for (let a = n.parent; a; a = a.parent) {
      if (ts.isJsxElement(a) && kabul(a.openingElement.tagName.getText(sf))) {
        return true;
      }
    }
    return false;
  };

  const gez = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const ad = n.tagName.getText(sf);
      const oz = n.attributes.properties;
      if (ad === "button") o.rawButton += 1;
      if (ad === "label") {
        o.labels += 1;
        if (
          oz.some(
            (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "htmlFor"
          )
        ) {
          o.labelsWithHtmlFor += 1;
        }
      }
      for (const p of oz) {
        if (!ts.isJsxAttribute(p)) continue;
        const pad = p.name.getText(sf);
        if (pad === "aria-modal") o.ariaModals += 1;
        if (pad === "role" && ozniteligeDeger(p.initializer) === "dialog") {
          o.dialogRoles += 1;
        }
      }

      // ── İP-A3a: erişilebilir adı olmayan form kontrolü ──
      if (KONTROL_ETIKETLERI.has(ad)) {
        const nitelik = (isim) =>
          oz.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === isim);

        const tipNit = nitelik("type");
        const tip = tipNit ? ozniteligeDeger(tipNit.initializer) : null;

        const gizliNit = nitelik("hidden");
        const gizli =
          !!gizliNit &&
          (!gizliNit.initializer ||
            gizliNit.initializer.getText(sf).replace(/\s+/g, "") === "{true}");

        if (
          gizli ||
          (ad === "input" && tip && OLCUM_DISI_INPUT_TIPLERI.has(tip.toLowerCase()))
        ) {
          o.olcumDisiKontrol += 1;
        } else {
          o.kontrolToplam += 1;

          // Dört adlandırma biçimi. Hiçbiri yoksa kontrol BORÇTUR.
          const ariaVar = !!(nitelik("aria-label") || nitelik("aria-labelledby"));

          const idNit = nitelik("id");
          const idBagli =
            !!idNit?.initializer &&
            htmlForDegerleri.has(idNit.initializer.getText(sf).replace(/\s+/g, ""));

          const labelIcinde = atadaVarMi(n, (t) => t === "label");
          const kontrolIcinde = atadaVarMi(
            n,
            (t) => KONTROL_SARMALAYICILARI.has(t) || sarmalayiciAdlari.has(t)
          );

          if (!ariaVar && !idBagli && !labelIcinde && !kontrolIcinde) {
            o.adsizKontrol += 1;
            o.adsizKontrolSatirlari.push(
              sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
            );
          }
        }
      }
    }

    // ── Kaçış yolu 1: `React.createElement("button", …)` ──
    //
    // JSX olmayan ham buton (İP-A3c · denetim P3-1, mutasyon M2 GEÇMİŞTİ).
    // Bugün kod tabanında yok; kapatılmasının sebebi kötü niyet değil, göç
    // sırasında kaza eseri ortaya çıkma ihtimali.
    if (ts.isCallExpression(n)) {
      const cagri = n.expression.getText(sf).replace(/\s+/g, "");
      if (
        (cagri === "createElement" || /(^|\.)React\.createElement$/.test(cagri)) &&
        n.arguments[0] &&
        ts.isStringLiteral(n.arguments[0]) &&
        n.arguments[0].text === "button"
      ) {
        o.rawButton += 1;
      }
    }

    // Overlay tespiti sınıf adına bakar; sınıf adı ancak bir string/şablon
    // parçasının İÇİNDE geçebilir. Yorumdaki `fixed inset-0` artık sayılmaz.
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      o.overlays += (n.text.match(/fixed inset-0/g) || []).length;
    }

    // `import`, `export … from` ve dinamik `import()` — üçü de doğrudan
    // bağımlılıktır; regex sürümü yalnız ilkini görüyordu.
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      medusaYolu(n.moduleSpecifier.text)
    ) {
      o.medusaImport = true;
    }
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      medusaYolu(n.arguments[0].text)
    ) {
      o.medusaImport = true;
    }

    ts.forEachChild(n, gez);
  };

  gez(sf);
  return o;
}

export function sayim() {
  const base = adminBase();
  let rawButton = 0;
  let labels = 0;
  let labelsWithHtmlFor = 0;

  const overlayOffenders = [];
  let unlabeledOverlays = 0;

  let kontrolToplam = 0;
  let adsizKontrol = 0;
  let olcumDisiKontrol = 0;
  const adsizKontrolDosyalari = [];

  for (const f of base) {
    const o = dosyaOlcumu(read(f), f);
    rawButton += o.rawButton;
    labels += o.labels;
    labelsWithHtmlFor += o.labelsWithHtmlFor;

    kontrolToplam += o.kontrolToplam;
    adsizKontrol += o.adsizKontrol;
    olcumDisiKontrol += o.olcumDisiKontrol;
    if (o.adsizKontrol > 0) {
      adsizKontrolDosyalari.push({
        dosya: f,
        sayi: o.adsizKontrol,
        satirlar: o.adsizKontrolSatirlari,
      });
    }

    if (PRINT_LAYERS.includes(f) || !o.overlays) continue;
    // Bir overlay'in "etiketli" sayılması için HEM role="dialog" HEM
    // aria-modal gerekir; ikisinin küçüğü kadarı etiketli kabul edilir.
    const labeled = Math.min(o.dialogRoles, o.ariaModals);
    const missing = Math.max(0, o.overlays - labeled);
    if (missing > 0) {
      unlabeledOverlays += missing;
      overlayOffenders.push(f);
    }
  }

  // `ui2/` dışında `@medusajs/ui` import eden dosyalar (tüm kaynak ağacı).
  // Ön eleme yalnız hız içindir: metinde adı hiç geçmeyen dosya parse edilmez.
  const medusaDirectImports = allSource().filter((f) => {
    if (f.includes("/admin/ui2/")) return false;
    const s = read(f);
    return s.includes(MEDUSA) && dosyaOlcumu(s, f).medusaImport;
  });

  adsizKontrolDosyalari.sort((a, b) => b.sayi - a.sayi || a.dosya.localeCompare(b.dosya));

  return {
    files: base.length,
    // Ölçüm tabanının KENDİSİ (İP-A3c · P1-2/P1-4): nöbetçi bunu isimle
    // sabitlenmiş listeyle karşılaştırır. Eski taban kontrolü
    // (`kontrolToplam >= 140`) göçün TANIMI GEREĞİ kırılacaktı — sayaç ham
    // `input`/`select`/`textarea` etiketlerini sayıyor ve göç onları
    // sarmalayıcılara çeviriyor. `AdminStore.tsx` tek başına göç etse taban
    // 140'ın altına iner ve CI **ilerleme yüzünden** kırmızıya dönerdi.
    dosyalar: base,
    rawButton,
    // `labels` / `labelsWithHtmlFor` artık EŞİK DEĞİL, TEŞHİS sayısıdır
    // (İP-A3a: oran metriği kaldırıldı — gerekçesi `docs/ip-a3a-rapor.md`).
    // Sayaç bunları zaten `htmlFor`↔`id` eşleştirmesi için üretiyor.
    labels,
    labelsWithHtmlFor,
    // İP-A3a nöbetçi metriği: erişilebilir adı olmayan form kontrolü.
    kontrolToplam,
    adsizKontrol,
    olcumDisiKontrol,
    adsizKontrolDosyalari,
    medusaDirectImports,
    unlabeledOverlays,
    overlayOffenders: overlayOffenders.sort(),
  };
}

if (process.argv[1] && process.argv[1].endsWith("ui-baseline-sayim.mjs")) {
  console.log(JSON.stringify(sayim(), null, 2));
}
