// P0 - Magaza vitrini DURUM TESPITI turu (uretim kodunda degisiklik YOK).
//
// Neyi kanitliyor: "dort nesil ust uste yasiyor" ve "vitrin bir yere gitmiyor"
// iddialari KAYNAK TARAMASIYLA kanitlanamaz. Bu tur gercek Chrome'da
// /magaza'yi acar ve olcer:
//   1. Hangi neslin uclarina GERCEKTEN istek gidiyor (Network kaydi),
//   2. Vitrinde kac blok basiliyor, kac urun gorunuyor,
//   3. Bloklardan kaci tiklanabilir (olu kart / hedefsiz "Kesfet"),
//   4. Acik/koyu tema paritesi ve yatay tasma.
//
// Tur yalniz PUBLIC yuzeyi olcer; oturum gerektirmez, veri YAZMAZ.
//
// Kullanim (frontend/):
//   node scripts/vitrin_p0_olcum.mjs --frontend http://127.0.0.1:5173
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] ?? "1"]);
    return acc;
  }, [])
);
const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5173";
const OUT = resolve(ARGS.out ?? "../docs/vitrin-p0");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9471);

async function chromeBaslat() {
  const profil = join(tmpdir(), `vitrin-p0-profil-${process.pid}`);
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
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1280,1000",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return p;
    } catch {
      /* bekle */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Chrome DevTools portu acilmadi");
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
          red(new Error(`CDP zaman asimi: ${method}`));
        }
      }, 60000);
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
        `Sayfa ici hata: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`
      );
    }
    return r.result.value;
  }
  async git(url) {
    await this.gonder("Page.navigate", { url });
    for (let i = 0; i < 120; i++) {
      if (await this.eval(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 2200));
  }
  async genislik(px) {
    await this.gonder("Emulation.setDeviceMetricsOverride", {
      width: px,
      height: 900,
      deviceScaleFactor: 1,
      mobile: px < 700,
    });
  }
  /**
   * ALET KUSURU NOTU: `Emulation.setEmulatedMedia` ile prefers-color-scheme
   * cevirmek BU projede temayi degistirmez - tailwind.config.js `darkMode:
   * "class"` kullaniyor ve tema `themeStore` uzerinden <html>'e `dark` sinifi
   * basarak uygulaniyor. Ilk kosumda acik ve koyu olcumler AYNI govde rengini
   * dondurdu; yani "koyu tema olcumu" diye raporlanan sey aslinda ikinci bir
   * acik tema olcumuydu. Tema bu yuzden uygulamanin kendi yolundan cevrilir.
   */
  async tema(koyu) {
    await this.eval(
      (k) => document.documentElement.classList.toggle("dark", k),
      koyu
    );
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
}

/** Vitrin yuzeyinin olcumu - sayfa icinde kosar. */
const vitriniOlc = () => {
  const kok = document.documentElement;
  const gorunur = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Kapsam NOTU: olcum `main` altina baglanmaz - magaza duzeninin <main>
  // kullandigi VARSAYILAMAZ; varsayim ilk kosumda sifir olcum uretmisti.
  // Bunun yerine tum belge olculur, <main> varligi ayrica raporlanir.
  const urunLinkleri = Array.from(
    document.querySelectorAll('a[href*="/magaza/urun"]')
  ).filter(gorunur);
  const tumLinkler = Array.from(document.querySelectorAll("a[href]")).filter(gorunur);
  const gorseller = Array.from(document.querySelectorAll("img")).filter(gorunur);
  const tiklanamazGorsel = gorseller.filter((g) => !g.closest("a")).length;
  const basliklar = Array.from(document.querySelectorAll("h2"))
    .filter(gorunur)
    .map((h) => h.textContent.trim());
  return {
    mainVar: !!document.querySelector("main"),
    metinUzunlugu: document.body.innerText.trim().length,
    govdeArkaPlan: getComputedStyle(document.body).backgroundColor,
    yatayTasma: kok.scrollWidth > kok.clientWidth,
    tasmaPiksel: Math.max(0, kok.scrollWidth - kok.clientWidth),
    sayfaYuksekligi: kok.scrollHeight,
    gorunurGorsel: gorseller.length,
    tiklanamazGorsel,
    gorunurLink: tumLinkler.length,
    urunKartiLinki: urunLinkleri.length,
    h2Basliklari: basliklar,
    // ALET KUSURU NOTU: bu desen once `/kesfet|->/i` yazilmisti; sayfadaki
    // gercek ok karakteri "→" oldugu icin HIC eslesmedi ve "0 kesfet
    // baglantisi" diye YANLIS bir bulgu uretti (blok 2-4 aslinda /magaza'ya
    // gidiyor). Desen artik gercek karakteri ariyor.
    kesfetBaglantisi: tumLinkler.filter((a) => /keşfet|→/i.test(a.textContent))
      .length,
  };
};

const NESILLER = [
  ["G1 duyuru", "/duyuru-seridi/aktif"],
  ["G2 hero", "/store/hero-slides"],
  ["G3 home-sections", "/store/home-sections"],
  ["G3 showcase-cards", "/store/showcase-cards"],
  ["G4 home (kanonik)", "/store/home"],
];

const chrome = await chromeBaslat();
const rapor = { olculdu: new Date().toISOString(), frontend: FRONTEND, turlar: {} };
try {
  mkdirSync(OUT, { recursive: true });
  // ALET KUSURU NOTU: `find(t => t.type === "page")` bir Chrome EKLENTISININ
  // arka plan sayfasini da yakalayabiliyor. Ilk kosumda tam bu oldu ve butun
  // DOM olcumleri 0 dondu ("0 gorsel, 0 link") - yani alet, magazayi degil
  // eklentiyi olcuyordu. Hedef bu yuzden ACIKCA http(s) olan sekmedir.
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const hedef = hedefler.find(
    (t) => t.type === "page" && /^https?:|^about:blank/.test(t.url ?? "")
  );
  if (!hedef) throw new Error("Olculecek sayfa sekmesi bulunamadi");
  const ws = new WebSocket(hedef.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const s = new Sayfa(ws);
  await s.gonder("Page.enable");
  await s.gonder("Runtime.enable");

  let istekler = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Network.requestWillBeSent") istekler.push(m.params.request.url);
  });
  await s.gonder("Network.enable");

  const tur = async (ad, yol, dosyaOn) => {
    istekler = [];
    await s.genislik(1280);
    await s.tema(false);
    await s.git(`${FRONTEND}${yol}`);
    const acik = await s.eval(vitriniOlc);
    await s.ss(join(OUT, `${dosyaOn}-acik.png`));
    await s.tema(true);
    await new Promise((r) => setTimeout(r, 900));
    const koyu = await s.eval(vitriniOlc);
    await s.ss(join(OUT, `${dosyaOn}-koyu.png`));
    await s.genislik(390);
    await new Promise((r) => setTimeout(r, 900));
    const mobil = await s.eval(vitriniOlc);
    await s.ss(join(OUT, `${dosyaOn}-mobil-koyu.png`));
    const apiIstekleri = istekler.filter((u) => u.includes("/api/v1/"));
    const nesilVurus = {};
    for (const [etiket, uc] of NESILLER) {
      nesilVurus[etiket] = apiIstekleri.filter((u) => u.includes(uc)).length;
    }
    rapor.turlar[ad] = {
      yol,
      acik,
      koyu,
      mobil,
      nesilVurus,
      apiIstekSayisi: apiIstekleri.length,
      apiIstekleri,
    };
    console.log(`\n### ${ad}  (${yol})`);
    console.log("  nesil vuruslari:", JSON.stringify(nesilVurus));
    console.log("  api istegi:", apiIstekleri.length);
    console.log("  acik:", JSON.stringify(acik));
    console.log(
      "  koyu govde:",
      koyu.govdeArkaPlan,
      "| mobil tasma:",
      mobil.yatayTasma,
      mobil.tasmaPiksel + "px"
    );
  };

  await tur("magaza-ana", "/magaza", "magaza-ana");
  await tur("kampanya", "/magaza/okula-donus", "kampanya");
  await tur("kampanya-yayinsiz", "/magaza/okula-donus-2", "kampanya-yayinsiz");

  // Yonetim yuzeyi: yalniz --eposta/--sifre verildiginde olculur.
  const EPOSTA = ARGS.eposta ?? process.env.P0_EPOSTA;
  const SIFRE = ARGS.sifre ?? process.env.P0_SIFRE;
  if (EPOSTA && SIFRE) {
    await s.genislik(1280);
    await s.tema(false);
    await s.git(`${FRONTEND}/giris`);
    const girisSonucu = await s.eval(
      async (eposta, sifre) => {
        const yaz = (el, deger) => {
          const proto =
            el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
          Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, deger);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const e = document.querySelector('input[type="email"], input[name="email"]');
        const p = document.querySelector('input[type="password"]');
        if (!e || !p) return "form-yok";
        yaz(e, eposta);
        yaz(p, sifre);
        const f = p.closest("form");
        if (!f) return "form-elemani-yok";
        f.requestSubmit
          ? f.requestSubmit()
          : f.querySelector('button[type="submit"]')?.click();
        return "gonderildi";
      },
      EPOSTA,
      SIFRE
    );
    await new Promise((r) => setTimeout(r, 3500));
    rapor.giris = { sonuc: girisSonucu, url: await s.eval(() => location.pathname) };
    console.log("\n### giris:", JSON.stringify(rapor.giris));

    const panelOlc = () => {
      const kok = document.documentElement;
      const gorunur = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const dugmeler = Array.from(document.querySelectorAll("button")).filter(gorunur);
      const adsiz = dugmeler.filter(
        (b) => !b.textContent.trim() && !b.getAttribute("aria-label")
      ).length;
      return {
        yol: location.pathname,
        yatayTasma: kok.scrollWidth > kok.clientWidth,
        tasmaPiksel: Math.max(0, kok.scrollWidth - kok.clientWidth),
        dugmeSayisi: dugmeler.length,
        adsizDugme: adsiz,
        girdiSayisi: Array.from(document.querySelectorAll("input,textarea,select")).filter(
          gorunur
        ).length,
        metinUzunlugu: document.body.innerText.trim().length,
        h1: Array.from(document.querySelectorAll("h1")).map((h) => h.textContent.trim()),
      };
    };

    for (const [ad, yol, dosya] of [
      ["panel-magaza", "/yonetim/magaza", "panel-magaza"],
      ["panel-vitrin", "/yonetim/magaza/ana-sayfa", "panel-vitrin"],
    ]) {
      await s.genislik(1280);
      await s.tema(false);
      await s.git(`${FRONTEND}${yol}`);
      const acik = await s.eval(panelOlc);
      await s.ss(join(OUT, `${dosya}-acik.png`));
      await s.tema(true);
      await new Promise((r) => setTimeout(r, 900));
      const koyu = await s.eval(panelOlc);
      await s.ss(join(OUT, `${dosya}-koyu.png`));
      rapor.turlar[ad] = { yol, acik, koyu };
      console.log(`\n### ${ad}  (${yol})`);
      console.log("  acik:", JSON.stringify(acik));
    }
  }

  writeFileSync(join(OUT, "olcum.json"), JSON.stringify(rapor, null, 2));
  console.log(`\nRapor: ${join(OUT, "olcum.json")}`);
} finally {
  chrome.kill();
}
