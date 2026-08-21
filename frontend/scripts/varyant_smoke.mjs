// Faz 3 · Varyant vitrini — GERÇEK TARAYICI duman turu (Chrome + CDP).
//
// `ip19_browser_acceptance.mjs` altyapı deseninin kopyası (Playwright yok;
// Node 22 yerleşik WebSocket). İZOLE yığında koşar: backend adana_varyant_test
// DB'siyle ayrı porttan, vite ayrı porttan — ceyhandb'ye dokunulmaz.
//
// Ölçülenler (hepsi PUBLIC vitrin, giriş gerekmez):
//   1. /magaza araması: varyant grubu TEK kart; "X'den başlayan" + "Seçenekleri
//      Gör (3)".
//   2. Facet paneli: "Renk" kutusu veriden gelir; "Sarı" işaretlenince liste
//      GERÇEK istekle yeniden gelir ve kart temsilcisi sarı üye olur.
//   3. Ürün detayı: "Renk" başlıklı seçici; Pembe "Tükendi" işaretli.
//   4. Mavi'ye tıklayınca KARDEŞİN SAYFASINA gidilir: URL + başlık + KAPAK
//      GÖRSELİ değişir (görsel ürün başına — ek iş gerekmediğinin kanıtı).
//
// Kullanım:
//   node scripts/varyant_smoke.mjs --frontend http://127.0.0.1:5178 --out ./varyant-kabul
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5178";
// MUTLAK yol: Chrome --user-data-dir göreli yolu çözemiyor (İP-19'da ölçüldü).
const OUT = resolve(ARGS.out ?? "./varyant-kabul");
const CHROME =
  ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9224);

mkdirSync(OUT, { recursive: true });

const adimlar = [];
function kaydet(ad, ok, detay) {
  adimlar.push({ adim: ad, ok, detay });
  console.log(`${ok ? "  \u2713" : "  \u2717"} ${ad}${detay ? ` \u2014 ${detay}` : ""}`);
  if (!ok) process.exitCode = 1;
}
function zorunlu(ad, kosul, detay) {
  kaydet(ad, Boolean(kosul), detay);
  if (!kosul) throw new Error(`KABUL D\u00dc\u015eT\u00dc: ${ad}`);
}

async function chromeBaslat() {
  const profil = join(OUT, "chrome-profil");
  rmSync(profil, { recursive: true, force: true });
  mkdirSync(profil, { recursive: true });
  const p = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profil}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore", detached: false },
  );
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return p;
    } catch {
      /* bekle */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Chrome DevTools portu a\u00e7\u0131lmad\u0131");
}

class Sayfa {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.bekleyen = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.bekleyen.has(m.id)) {
        const { coz, red } = this.bekleyen.get(m.id);
        this.bekleyen.delete(m.id);
        m.error ? red(new Error(JSON.stringify(m.error))) : coz(m.result);
      }
    });
  }
  gonder(method, params = {}) {
    const id = ++this.id;
    return new Promise((coz, red) => {
      this.bekleyen.set(id, { coz, red });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.bekleyen.has(id)) {
          this.bekleyen.delete(id);
          red(new Error(`CDP zaman a\u015f\u0131m\u0131: ${method}`));
        }
      }, 60_000);
    });
  }
  async eval(fn, ...args) {
    const ifade = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`;
    const r = await this.gonder("Runtime.evaluate", {
      expression: `(async () => { return ${ifade}; })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        `Sayfa i\u00e7i hata: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
      );
    }
    return r.result.value;
  }
  async git(url) {
    await this.gonder("Page.navigate", { url });
    await this.bekle(() => document.readyState === "complete");
    await new Promise((r) => setTimeout(r, 500));
  }
  async bekle(kosulFn, { ms = 15000, aciklama = "" } = {}, ...args) {
    const bitis = Date.now() + ms;
    let son = null;
    while (Date.now() < bitis) {
      try {
        son = await this.eval(kosulFn, ...args);
        if (son) return son;
      } catch (e) {
        son = e.message;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
      `Bekleme zaman a\u015f\u0131m\u0131${aciklama ? `: ${aciklama}` : ""} (son: ${son})`,
    );
  }
  async ekranGoruntusu(ad) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, ad), Buffer.from(r.data, "base64"));
  }
}

async function sayfaAc() {
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const sekme = hedefler.find((t) => t.type === "page");
  const ws = new WebSocket(sekme.webSocketDebuggerUrl);
  await new Promise((coz, red) => {
    ws.addEventListener("open", coz, { once: true });
    ws.addEventListener("error", red, { once: true });
  });
  const s = new Sayfa(ws);
  await s.gonder("Page.enable");
  await s.gonder("Runtime.enable");
  return s;
}

const metinVarMi = (desen) => new RegExp(desen, "i").test(document.body.innerText);

async function ana() {
  const chrome = await chromeBaslat();
  try {
    const sayfa = await sayfaAc();

    // 1 · Liste: grup başına tek kart + "başlayan" fiyat
    await sayfa.git(`${FRONTEND}/magaza?q=Fosforlu`);
    await sayfa.bekle(metinVarMi, { aciklama: "grup kart\u0131" }, "Se\u00e7enekleri G\u00f6r \\(3\\)");
    const kartSayisi = await sayfa.eval(() =>
      [...document.querySelectorAll("a")].filter((a) =>
        /Se\u00e7enekleri G\u00f6r/.test(a.textContent || ""),
      ).length,
    );
    zorunlu("1. Listede grup TEK kart", kartSayisi === 1, `kart=${kartSayisi}`);
    zorunlu(
      "1b. 'X'den ba\u015flayan' fiyat g\u00f6r\u00fcn\u00fcyor",
      await sayfa.eval(metinVarMi, "'den ba\u015flayan"),
      "",
    );
    await sayfa.ekranGoruntusu("1-liste-grup-karti.png");

    // 2 · Facet: "Renk" kutusu + Sarı seçimi listeyi GERÇEK istekle daraltır
    zorunlu(
      "2. Facet panelinde 'Renk' kutusu (veriden)",
      await sayfa.eval(() =>
        [...document.querySelectorAll("h3")].some((h) => h.textContent.trim() === "Renk"),
      ),
      "",
    );
    await sayfa.eval(() => {
      const kutu = [...document.querySelectorAll("label")].find((l) =>
        /Sar\u0131/.test(l.textContent || ""),
      );
      kutu?.querySelector("input[type=checkbox]")?.click();
    });
    // Filtre partition'\u0131 da daralt\u0131r: grupta yaln\u0131z SARI \u00fcye kal\u0131r \u2192
    // variant_count=1 \u2192 kart normal karta d\u00f6ner ("Sepete Ekle"), temsilci
    // sar\u0131 \u00fcyedir. "Se\u00e7enekleri G\u00f6r" metninin KAYBOLMASI do\u011fru davran\u0131\u015ft\u0131r.
    await sayfa.bekle(
      () =>
        /Fosforlu Kalem - Sar\u0131/.test(document.body.innerText) &&
        !/Se\u00e7enekleri G\u00f6r/.test(document.body.innerText) &&
        !/Fosforlu Kalem - Mavi/.test(document.body.innerText),
      { aciklama: "Sar\u0131 filtresi sonras\u0131 liste" },
    );
    await sayfa.ekranGoruntusu("2-facet-renk-sari.png");
    kaydet(
      "2b. Sar\u0131 filtresi GER\u00c7EK iste\u011fi att\u0131: kart\u0131 sar\u0131 \u00fcye temsil ediyor, mavi listede yok",
      true,
      "",
    );

    // 3 · Detay: seçici + Tükendi işareti
    await sayfa.git(`${FRONTEND}/magaza/urun/duman-fosforlu-sari`);
    await sayfa.bekle(metinVarMi, { aciklama: "detay ba\u015fl\u0131\u011f\u0131" }, "Fosforlu Kalem - Sar\u0131");
    zorunlu(
      "3. Se\u00e7ici ba\u015fl\u0131\u011f\u0131 'Renk' (eksen ad\u0131 gruptan)",
      await sayfa.eval(() =>
        [...document.querySelectorAll("p")].some((p) => p.textContent.trim() === "Renk"),
      ),
      "",
    );
    const pembeDurum = await sayfa.eval(() => {
      const a = [...document.querySelectorAll("a")].find((x) =>
        /Pembe/.test(x.textContent || ""),
      );
      return a ? a.textContent : null;
    });
    zorunlu(
      "3b. T\u00fckenen karde\u015f listede + 'T\u00fckendi' etiketli",
      pembeDurum && /T\u00fckendi/.test(pembeDurum),
      pembeDurum ?? "yok",
    );
    const sariKapak = await sayfa.eval(
      () => document.querySelector("img[alt*='Fosforlu']")?.src ?? null,
    );
    await sayfa.ekranGoruntusu("3-detay-secici-sari.png");

    // 4 · Mavi'ye tıkla → kardeşin sayfası: URL + başlık + GÖRSEL değişir
    await sayfa.eval(() => {
      const a = [...document.querySelectorAll("a")].find((x) =>
        /Mavi/.test(x.textContent || ""),
      );
      a?.click();
    });
    await sayfa.bekle(metinVarMi, { aciklama: "mavi detay" }, "Fosforlu Kalem - Mavi");
    const url = await sayfa.eval(() => location.pathname);
    zorunlu(
      "4. Se\u00e7im karde\u015fin sayfas\u0131na gitti",
      url.endsWith("/duman-fosforlu-mavi"),
      url,
    );
    const maviKapak = await sayfa.eval(
      () => document.querySelector("img[alt*='Fosforlu']")?.src ?? null,
    );
    zorunlu(
      "4b. Renk se\u00e7ilince kapak g\u00f6rseli DE\u011e\u0130\u015eT\u0130",
      sariKapak && maviKapak && sariKapak !== maviKapak,
      `${sariKapak} \u2192 ${maviKapak}`,
    );
    await sayfa.ekranGoruntusu("4-detay-mavi.png");
  } finally {
    chrome.kill();
  }
  writeFileSync(join(OUT, "rapor.json"), JSON.stringify(adimlar, null, 2));
  const kirik = adimlar.filter((a) => !a.ok).length;
  console.log(`\n${adimlar.length} ad\u0131m \u00b7 ${kirik} k\u0131r\u0131k`);
}

ana().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
