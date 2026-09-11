/**
 * ── İ9 · Boşluk 2: izin kapısı sessizce açık kalabilir ──
 *
 * `PanelShell.tsx`e (commit `a62f8c9`) yeni bir izin kapısı eklendi: kapı
 * yalnız `menu.ts`teki `PANEL_MENU`nun `requiredPermission` alanına bakıyor
 * (bkz. `rotaIzniBul`/`menuyuIzneGoreSuz`). Kapıyı kuran ajanın kendi
 * bildirdiği risk: **`App.tsx`e `/yonetim-yeni` (`PATHS.adminNew`) altına yeni
 * bir rota eklenip `menu.ts`te karşılık gelen `requiredPermission` girilmezse
 * o rota sessizce izinsiz açık kalır** — `PanelShell`in izin hesabı
 * `rotaIzniBul(PANEL_MENU, pathname)` döner, eşleşme yoksa ya da eşleşen
 * yaprağın `requiredPermission`ı yoksa `izinliMi` sözleşme gereği `true`dur
 * (bkz. `PanelShell.tsx`: `!rotaBilgisi?.requiredPermission || …`).
 *
 * 15 modül `/yonetim-yeni` altına eklenecek; bu paket her yeni rotada
 * TEKRARLANACAK bir hata sınıfı. Bu dosya onu YAKALAYAN nöbetçidir.
 *
 * ## Yöntem
 *
 * `App.tsx`in kendisi render edilmez (tüm alt ağacı — providers, lazy admin
 * ekranları — ayağa kaldırmak bu kapının konusu değil, gereksiz ağırlık
 * getirir). Bunun yerine KAYNAK METNİ AST ile taranır — depoda zaten emsali
 * var: `scripts/ui-baseline-sayim.mjs` (JSX ölçümü), `scripts/gonder-dugmesi.mjs`
 * ve `scripts/korumasiz-pencere.mjs` (ikisi de JSX/`<Route>` benzeri yapıları
 * kaynaktan AST ile okur). Yorumda/dizede geçen sahte bir `<Route>` metni
 * (regex'in düşeceği tuzak) AST'te düğüm ÜRETMEZ.
 *
 * İzin HESABI yeniden yazılmaz — gerçek üretim fonksiyonu içe aktarılıp
 * çağrılır (`rotaIzniBul`, `PANEL_MENU`, `@/lib/routes`teki `PATHS`). İki kopya
 * ayrışırsa kapı sessizce körleşirdi (aynı gerekçe `kapiOlcumu.tsx`te
 * `ERISIM_REDDEDILDI_BASLIK` için de var).
 *
 * ## "ölçmeyen nöbetçi yeşil verir" tuzağına düşmemek
 *
 * Depoda kayıtlı ders (`uiBaseline.test.ts` başlığı, TB-A5-1) ve bu paketin
 * kendi Boşluk 1'i: bir nöbetçi ÖLÇMEDİĞİ şeyde her zaman yeşildir. Bu yüzden
 * aşağıda üç ayrı iddia var, ikisi UYDURMA girdiyle:
 *
 *   1. Gerçek `App.tsx` BUGÜN yeşil (kapı kuruldu, tek bağlı modül var).
 *   2. UYDURULMUŞ bir `App.tsx` parçası — gerçek `PANEL_MENU`de yaprağı
 *      OLMAYAN bir rota (`siparisler`, bugün `menu.ts`te path'siz bir yer
 *      tutucu) — nöbetçi bunu KIRMIZI görür mü?
 *   3. UYDURULMUŞ bir menü — rota ile AYNI path'i taşıyan ama
 *      `requiredPermission`ı OLMAYAN bir yaprak — nöbetçi bunu da KIRMIZI
 *      görür mü? (Bu, riskin TAM TARİFİ: rota var, menü girdisi var, ama izin
 *      beyanı yok.)
 *
 * İkisi de KIRMIZI çıkmazsa nöbetçi ölçmüyor demektir.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";

import { PATHS } from "@/lib/routes";
import { PANEL_MENU, rotaIzniBul, type PanelMenuItem } from "@/panel/layout/menu";

const APP_TSX = "src/App.tsx";

export type PanelRota = { path: string; index: boolean };

/** JSX özniteliğinin (varsa) düz metin değeri — `x="a"` ve `x={"a"}` aynı okunur. */
function jsxAttrMetni(init: ts.JsxAttribute["initializer"]): string | null {
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  }
  return null;
}

/** `<Route>`/`<Route/>` düğümünden ortak alanlar — iki JSX biçimini tekleştirir. */
function routeBilgisi(
  n: ts.Node,
  sf: ts.SourceFile
): { tagName: string; attrs: ts.JsxAttributes; children: readonly ts.JsxChild[] } | null {
  if (ts.isJsxElement(n)) {
    return {
      tagName: n.openingElement.tagName.getText(sf),
      attrs: n.openingElement.attributes,
      children: n.children,
    };
  }
  if (ts.isJsxSelfClosingElement(n)) {
    return { tagName: n.tagName.getText(sf), attrs: n.attributes, children: [] };
  }
  return null;
}

function ozniteligiBul(attrs: ts.JsxAttributes, ad: string): ts.JsxAttribute | undefined {
  return attrs.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === ad
  );
}

function yolBirlestir(taban: string, parca: string): string {
  if (parca === "") return taban;
  return taban.endsWith("/") ? `${taban}${parca}` : `${taban}/${parca}`;
}

/**
 * Bir `<Route>` alt ağacındaki (react-router v6 iç içe rota deseni) TÜM
 * rotaları, mutlak `pathname`leriyle toplar.
 *
 * `path` özniteliği STRING LİTERAL olmayan (dinamik ifade taşıyan) bir
 * `<Route>` bugün ağaçta YOK; böyle bir düğümle karşılaşılırsa kendisi
 * sonuca eklenmez (path bilinmiyor) ama çocukları yine de gezilir — sessizce
 * yutmak yerine `cozulemeyenler`e düşer ki yeni bir dinamik rota fark
 * edilmeden geçmesin.
 */
function altRotalariTopla(
  children: readonly ts.JsxChild[],
  sf: ts.SourceFile,
  taban: string,
  sonuc: PanelRota[],
  cozulemeyenler: string[]
): void {
  for (const child of children) {
    const bilgi = routeBilgisi(child, sf);
    if (!bilgi || bilgi.tagName !== "Route") continue;

    const indexNit = ozniteligiBul(bilgi.attrs, "index");
    const pathNit = ozniteligiBul(bilgi.attrs, "path");
    const index = !!indexNit;

    let buYol: string | null = null;
    if (index) {
      buYol = taban;
    } else if (pathNit) {
      const metin = jsxAttrMetni(pathNit.initializer);
      if (metin !== null) buYol = yolBirlestir(taban, metin);
      else cozulemeyenler.push(`${bilgi.tagName} path={dinamik ifade} (taban: ${taban})`);
    }

    if (buYol !== null) sonuc.push({ path: buYol, index });
    altRotalariTopla(bilgi.children, sf, buYol ?? taban, sonuc, cozulemeyenler);
  }
}

/**
 * `kaynak`taki (App.tsx metni ya da onun şeklini taklit eden bir test
 * fixture'ı) `path={PATHS.adminNew}` etiketli `<Route>`u bulur ve altındaki
 * TÜM rotaları mutlak `pathname`leriyle döndürür.
 *
 * `tabanIfadesi` varsayılanı gerçek dosyadaki yazımla (`PATHS.adminNew`)
 * AYNIDIR — kaynak metninde ARANAN şey budur, `PATHS` modülü ÇÖZÜLMEZ
 * (AST statik metin taraması yapar, tip/değer çözümlemesi yapmaz).
 */
export function panelAltRotalari(
  kaynak: string,
  tabanIfadesi = "PATHS.adminNew"
): { rotalar: PanelRota[]; cozulemeyenler: string[]; bulunduMu: boolean } {
  const sf = ts.createSourceFile(APP_TSX, kaynak, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rotalar: PanelRota[] = [];
  const cozulemeyenler: string[] = [];
  let bulunduMu = false;

  const gez = (n: ts.Node) => {
    if (bulunduMu) return; // tek eşleşme beklenir, ilk bulunanla dur
    const bilgi = routeBilgisi(n, sf);
    if (bilgi && bilgi.tagName === "Route") {
      const pathNit = ozniteligiBul(bilgi.attrs, "path");
      const ifadeMetni = pathNit?.initializer
        ? pathNit.initializer.getText(sf).replace(/^\{|\}$/g, "").replace(/\s+/g, "")
        : null;
      if (ifadeMetni === tabanIfadesi) {
        bulunduMu = true;
        altRotalariTopla(bilgi.children, sf, PATHS.adminNew, rotalar, cozulemeyenler);
        return;
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);

  return { rotalar, cozulemeyenler, bulunduMu };
}

/**
 * `PATHS.adminNew`in KENDİSİ — panelin "Giriş" iniş sayfası — BİLİNÇLİ OLARAK
 * izin beyanı taşımaz (bkz. `menu.ts`: `{ key: "giris", …, path: PATHS.adminNew }`
 * `requiredPermission`sız TEK yazılı girdi) ve `PanelShell` bunu genel erişimli
 * sayar. Bu TEK, İSİMLE SABİT istisna — ikinci bir izinsiz rota sessizce
 * eklenemesin diye burada duruyor, kod (panel/**) BURADAN okunmadı, kural
 * BAĞIMSIZ yazıldı.
 */
const HARIC_TUTULAN_ROTALAR: readonly string[] = [PATHS.adminNew];

/**
 * Verilen rotalardan, `menu`de KARŞILIĞI olmayan ya da karşılığı
 * `requiredPermission` TAŞIMAYAN her rotanın `pathname`ini döndürür.
 *
 * Boş dizi = kapı sağlam: her rota ya HARIC_TUTULAN_ROTALAR'da (isimle,
 * bilinçli) ya da `menu`de izin beyanlı bir yaprakla eşleşiyor.
 */
export function izinsizKalanRotalar(
  rotalar: readonly PanelRota[],
  menu: PanelMenuItem[] = PANEL_MENU
): string[] {
  return rotalar
    .map((r) => r.path)
    .filter((p) => !HARIC_TUTULAN_ROTALAR.includes(p))
    .filter((p) => !rotaIzniBul(menu, p)?.requiredPermission)
    .sort();
}

describe("İ9 · panel izin kapısı — App.tsx rotaları menu.ts'te izinle eşleşir", () => {
  it("fixture nöbetçisi: taban ifadesi bulunamazsa test kendini görünür kırar", () => {
    // Bu olmadan aşağıdaki `bulunduMu` iddiası olmasa, `panelAltRotalari`
    // App.tsx'in yapısı değişip `PATHS.adminNew` etiketli <Route> kaybolursa
    // sessizce BOŞ dizi dönerdi — "hiç ihlal yok" ile "hiç ölçmedim" ayırt
    // edilemez hâle gelirdi.
    const bos = panelAltRotalari("<div>PATHS.adminNew hiç geçmiyor</div>");
    expect(bos.bulunduMu).toBe(false);
  });

  it("BUGÜN: App.tsx'teki gerçek panel rotalarının hepsi menu.ts'te izinle yazılı", () => {
    const kaynak = readFileSync(APP_TSX, "utf8");
    const { rotalar, cozulemeyenler, bulunduMu } = panelAltRotalari(kaynak);

    expect(bulunduMu, "App.tsx'te `path={PATHS.adminNew}` etiketli <Route> bulunamadı").toBe(
      true
    );
    expect(cozulemeyenler, "dinamik (literal olmayan) path taşıyan <Route> bulundu").toEqual([]);
    // Bugün bilinen dört rota: index + urunler + urunler/yeni + urunler/:id.
    // Sayı değil TABAN büyüklüğü sınanır — asıl iddia altta (izinsizKalanRotalar).
    expect(rotalar.length).toBeGreaterThan(0);

    expect(
      izinsizKalanRotalar(rotalar),
      "Bu rotalar App.tsx'te var ama menu.ts'te izin beyanlı bir karşılığı yok " +
        "— PanelShell'in izin kapısı bunlarda SESSİZCE açık kalır. Düzeltme: " +
        "menu.ts'teki ilgili PANEL_MENU yaprağına `path` + `requiredPermission` " +
        "ekle (yaprak yoksa oluştur)."
    ).toEqual([]);
  });

  it("UYDURMA 1 — menu.ts'te YAPRAĞI OLMAYAN bir rota KIRMIZI verir", () => {
    // `siparisler` bugün `menu.ts`te `path`SİZ bir yer tutucu (PANEL_MENU'de
    // gerçek satır). Ona bir `<Route>` eklemek ama `path`/`requiredPermission`
    // ile bağlamamak — riskin tarif ettiği senaryonun ta kendisi. Gerçek
    // `PANEL_MENU` DEĞİŞTİRİLMEDİ; yalnız App.tsx'in ŞEKLİNİ taklit eden bir
    // metin uyduruldu.
    const sahteKaynak = `
      <Route path={PATHS.adminNew} element={<PanelShell />}>
        <Route index element={<div>Panel kuruldu.</div>} />
        <Route path="urunler" element={<UrunListesi />} />
        <Route path="siparisler" element={<SiparislerSayfasi />} />
      </Route>
    `;
    const { rotalar, bulunduMu } = panelAltRotalari(sahteKaynak);
    expect(bulunduMu).toBe(true);

    const izinsiz = izinsizKalanRotalar(rotalar);
    expect(izinsiz, "nöbetçi menüsüz rotayı KAÇIRDI — ölçmüyor demektir").toContain(
      "/yonetim-yeni/siparisler"
    );
  });

  it("UYDURMA 2 — menu.ts'te path'i eşleşen AMA requiredPermission'ı OLMAYAN bir yaprak KIRMIZI verir", () => {
    // Rota var, menü yaprağı da var (path eşleşiyor) — ama yaprak izin
    // beyanı TAŞIMIYOR. `rotaIzniBul` `requiredPermission: undefined` ile
    // dönecek, `PanelShell` bunu "izin gerekmiyor" sayacak: sessiz fail-open.
    // Bu, `giris` DIŞINDA hiçbir yaprakta OLMAMASI gereken durum.
    const sahteMenu: PanelMenuItem[] = [
      { key: "giris", label: "Giriş", path: PATHS.adminNew },
      { key: "raporlar", label: "Raporlar", path: `${PATHS.adminNew}/raporlar` }, // requiredPermission YOK
    ];
    const rotalar: PanelRota[] = [
      { path: PATHS.adminNew, index: true },
      { path: `${PATHS.adminNew}/raporlar`, index: false },
    ];

    const izinsiz = izinsizKalanRotalar(rotalar, sahteMenu);
    expect(
      izinsiz,
      "nöbetçi izin beyansız (ama path'i eşleşen) yaprağı KAÇIRDI — ölçmüyor demektir"
    ).toEqual([`${PATHS.adminNew}/raporlar`]);
    // `giris` (HARIC_TUTULAN_ROTALAR'da isimle sabit) kırmızıya karışmadı:
    expect(izinsiz).not.toContain(PATHS.adminNew);
  });
});
