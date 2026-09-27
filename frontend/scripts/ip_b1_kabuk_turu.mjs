// İP-B1 · Görev 5 — panel kabuğunun gerçek tarayıcı turu (Chrome + CDP).
//
// Önceki turlardan (A7d*) FARKI: sonda sayfası kullanılmıyor. Ölçülen şey
// KABUK ve kabuk gerçek rota ağacında yaşıyor — sahte bir sayfaya monte
// edilirse `aria-current`, rota gezinmesi, kısayolların gerçekten gezindirmesi
// ve mobil çekmecenin rota değişince kapanması ölçülemez.
//
// GERÇEK VERİ KULLANILMAZ: tur, YENİ ve BOŞ bir demo veritabanına
// (`adana_b1_demo`) bağlı bir backend'e karşı koşar. Canlı `ceyhandb`'ye
// bağlanılmaz; ekranlarda yalnız seed verisi ve boş durumlar görünür.
//
// Kullanım (frontend/):
//   node scripts/ip_b1_kabuk_turu.mjs --frontend http://127.0.0.1:5173 \
//        --eposta admin@... --sifre ...
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
const OUT = resolve(ARGS.out ?? "../docs/arsiv/ip-b/ip-b1");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9411);
const EPOSTA = ARGS.eposta;
const SIFRE = ARGS.sifre;

async function chromeBaslat() {
  // Profil ÇIKTI dizinine yazılmaz: `docs/arsiv/ip-b/ip-b1` sonuçların yeri ve Chrome
  // profili orada kalırsa hem commit'e sızar hem bir sonraki koşumda kilitli
  // kalıp turu düşürür (ölçüldü: EPERM).
  // Profil KOŞUMA ÖZEL: eski profili silmeye çalışmak, arka planda kalmış
  // bir Chrome varken EPERM ile turu düşürüyordu (ölçüldü).
  const profil = join(tmpdir(), `ip-b1-tur-profil-${process.pid}`);
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
  throw new Error("Chrome DevTools portu açılmadı");
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
          red(new Error(`CDP zaman aşımı: ${method}`));
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
        `Sayfa içi hata: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`
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
    await new Promise((r) => setTimeout(r, 1600));
  }
  /**
   * Ekranın RENDER'ini bekler: `readyState complete` yetmez — rotalar
   * `React.lazy` ile bölünüyor ve kabuk ancak parça indikten sonra basılıyor.
   * Sabit bekleme ilk koşumda 13 sahte kırmızı üretti ("h1 sayısı 0", "rail
   * görünmüyor") — ölçülen şey düzen değil, yükleme hızıydı.
   */
  async hazirBekle(ms = 20000) {
    const bitis = Date.now() + ms;
    while (Date.now() < bitis) {
      if (await this.eval(() => document.querySelectorAll("h1").length > 0)) {
        // Bir kare daha: başlık geldiyse kabuk da basılmıştır.
        await new Promise((r) => setTimeout(r, 400));
        return true;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }
  async genislik(px) {
    await this.gonder("Emulation.setDeviceMetricsOverride", {
      width: px,
      height: 900,
      deviceScaleFactor: 1,
      mobile: px < 700,
    });
  }
  async tus(key, opts = {}) {
    const metinli = opts.text != null;
    const ortak = { key, windowsVirtualKeyCode: opts.code ?? 0, ...opts.mods };
    await this.gonder("Input.dispatchKeyEvent", {
      type: metinli ? "keyDown" : "rawKeyDown",
      ...(metinli ? { text: opts.text } : {}),
      ...ortak,
    });
    await this.gonder("Input.dispatchKeyEvent", { type: "keyUp", ...ortak });
    await new Promise((r) => setTimeout(r, 150));
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
}

/* ── Sayfa içi sondalar ── */

const kontrastAraci = `
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
  const kanal = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const parlaklik = (p) => 0.2126 * kanal(p[0]) + 0.7152 * kanal(p[1]) + 0.0722 * kanal(p[2]);
  const oran = (on, arka) => { const a = parlaklik(on) + 0.05, b = parlaklik(arka) + 0.05; return +(Math.max(a,b)/Math.min(a,b)).toFixed(2); };
  const arkaPlan = (el) => { for (let n = el; n; n = n.parentElement) { const p = rgb(getComputedStyle(n).backgroundColor); if (p.length >= 3 && (p.length < 4 || p[3] > 0)) return p.slice(0,3); } return [255,255,255]; };
`;

const duzenOlc = () => {
  const kok = document.documentElement;
  const dugmeler = Array.from(document.querySelectorAll("button")).filter(
    (b) => b.getBoundingClientRect().height > 0
  );
  const rail = document.querySelector('[data-testid="panel-rail"]');
  return {
    tema: kok.classList.contains("dark") ? "koyu" : "acik",
    govdeGenisligi: document.body.clientWidth,
    yatayTasma: kok.scrollWidth > kok.clientWidth,
    tasmaPiksel: Math.max(0, kok.scrollWidth - kok.clientWidth),
    icIceButon: document.querySelectorAll("button button").length,
    dugmeSayisi: dugmeler.length,
    enKucukDokunmaHedefi: dugmeler.length
      ? Math.min(...dugmeler.map((b) => Math.round(b.getBoundingClientRect().height)))
      : null,
    railGorunur: rail ? rail.getBoundingClientRect().width > 0 : false,
    railGenisligi: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
    railKatli: rail ? rail.getAttribute("data-katli") : null,
    h1Sayisi: document.querySelectorAll("h1").length,
    h1: (document.querySelector("h1")?.textContent ?? "").trim(),
    ariaCurrent: Array.from(document.querySelectorAll('[aria-current="page"]')).map((a) =>
      (a.getAttribute("aria-label") || a.textContent || "").trim()
    ),
    erisimReddi: /yetkiniz yok/i.test(document.body.innerText),
  };
};

/** Kabuğun kontrast ölçümü: metin seviyeleri + kenarlık + odak halkası. */
const kontrastOlc = new Function(`
  ${kontrastAraci}
  const rail = document.querySelector('[data-testid="panel-rail"]');
  const out = {};
  const olc = (ad, sec, esik) => {
    const el = (rail || document).querySelector(sec);
    if (!el) { out[ad] = null; return; }
    const st = getComputedStyle(el);
    const k = oran(rgb(st.color).slice(0,3), arkaPlan(el));
    out[ad] = { kontrast: k, esik, gecti: k >= esik, fontPx: parseFloat(st.fontSize) };
  };
  olc("gezinmeEtkinOge", 'a[aria-current="page"]', 4.5);
  olc("gezinmePasifOge", 'a:not([aria-current="page"])', 4.5);
  olc("grupBasligi", 'h2', 3);
  olc("sayfaBasligi", 'h1', 4.5);
  // Kenarlık kontrastı: kenarlık rengi ile komşu yüzey (SC 1.4.11, esik 3)
  const kenar = document.querySelector('[data-testid="rail-alt"]');
  if (kenar) {
    const st = getComputedStyle(kenar);
    out.kenarlik = { renk: st.borderTopColor, kontrast: oran(rgb(st.borderTopColor).slice(0,3), arkaPlan(kenar)), esik: 3 };
    out.kenarlik.gecti = out.kenarlik.kontrast >= 3;
  }
  return out;
`);

const odakHalkasiOlc = new Function(`
  ${kontrastAraci}
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const st = getComputedStyle(el);
  const gorunur = st.getPropertyValue("box-shadow") + " " + st.outlineStyle + " " + st.outlineWidth;
  return {
    ad: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
    etiket: el.tagName.toLowerCase(),
    boxShadow: st.boxShadow.slice(0, 120),
    outline: st.outlineStyle + " " + st.outlineWidth + " " + st.outlineColor,
    halkaVar: /rgb/.test(st.boxShadow) || (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0),
    ham: gorunur.slice(0, 60),
  };
`);

const odaklanan = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  return {
    etiket: el.tagName.toLowerCase(),
    ad: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
    railIcinde: !!el.closest('[data-testid="panel-rail"]'),
    pencereIcinde: !!el.closest('[role="dialog"]'),
  };
};

const pencereVarMi = () => {
  const p = document.querySelector('[role="dialog"]');
  return p
    ? { ad: p.getAttribute("aria-label"), ariaModal: p.getAttribute("aria-modal") }
    : null;
};

const dugmeyeBas = (ad) => {
  const d = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(ad)
  );
  if (!d) return { hata: `düğme yok: ${ad}` };
  d.click();
  return { basildi: ad };
};

const adsizKontrolOlc = () =>
  Array.from(document.querySelectorAll("input, select, textarea"))
    .filter((el) => !["hidden", "submit", "button", "reset", "image"].includes(el.type))
    .filter((el) => {
      const ad =
        el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") &&
          document.getElementById(el.getAttribute("aria-labelledby"))?.textContent) ||
        (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
        el.closest("label")?.textContent;
      return !(ad || "").trim();
    })
    .map((el) => el.outerHTML.slice(0, 120));

/* ── Tur ── */

const sonuc = { olculdu: new Date().toISOString(), ekranlar: {}, etkilesim: {} };
let hataliAdim = 0;
const kapi = (kosul, ad) => {
  if (!kosul) {
    hataliAdim++;
    (sonuc.dusenKapilar = sonuc.dusenKapilar ?? []).push(ad);
  }
};

const EKRANLAR = {
  magaza: "/yonetim/magaza/urunler",
  envanter: "/yonetim/envanter",
  kurye: "/yonetim/dagitim/kuryeler",
  kutuphane: "/yonetim/kutuphaneler",
};

const chrome = await chromeBaslat();
try {
  mkdirSync(OUT, { recursive: true });
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const hedef = hedefler.find((t) => t.type === "page");
  const ws = new WebSocket(hedef.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const s = new Sayfa(ws);
  await s.gonder("Page.enable");
  await s.gonder("Runtime.enable");

  /* ── Oturum: gerçek giriş formu üzerinden ── */
  await s.genislik(1280);
  await s.git(`${FRONTEND}/giris`);
  const girisSonucu = await s.eval(
    async (eposta, sifre) => {
      const yaz = (sec, deger) => {
        const el = document.querySelector(sec);
        if (!el) return false;
        const proto =
          el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
        Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, deger);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      };
      const e = yaz('input[type="email"]', eposta);
      const p = yaz('input[type="password"]', sifre);
      const form = document.querySelector("form");
      if (!form) return { hata: "form yok" };
      form.requestSubmit
        ? form.requestSubmit()
        : form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return { epostaYazildi: e, sifreYazildi: p };
    },
    EPOSTA,
    SIFRE
  );
  // Giris + ilk panel render'i yuk altinda 3,5 sn'yi asabiliyor; yol degisene
  // kadar beklenir (en fazla 20 sn). Sabit bekleme, turun tamamini "giris
  // basarisiz" diye dusuruyordu.
  for (let i = 0; i < 40; i++) {
    if ((await s.eval(() => location.pathname)) !== "/giris") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  sonuc.giris = { ...girisSonucu, yol: await s.eval(() => location.pathname) };
  kapi(sonuc.giris.yol !== "/giris", `giriş başarısız (yol: ${sonuc.giris.yol})`);

  /* ── 4 ekran × 2 tema × 2 genişlik ── */
  for (const [ad, yol] of Object.entries(EKRANLAR)) {
    sonuc.ekranlar[ad] = {};
    for (const koyu of [0, 1]) {
      // Tema doğrudan store'a yazılır: profil menüsünü her ekranda açmak turun
      // ölçtüğü şeyi (kabuğun görünümü) değiştirmez ve menü etkileşimi ayrıca
      // E-4'te ölçülüyor.
      await s.eval((k) => {
        const kayit = { state: { preference: k ? "dark" : "light" }, version: 0 };
        localStorage.setItem("adana-theme", JSON.stringify(kayit));
      }, koyu);
      for (const genislik of [1280, 380]) {
        await s.genislik(genislik);
        await s.git(`${FRONTEND}${yol}`);
        await s.hazirBekle();
        const anahtar = `${koyu ? "koyu" : "acik"}-${genislik}`;
        const olcum = await s.eval(duzenOlc);
        olcum.adsizKontroller = await s.eval(adsizKontrolOlc);
        if (genislik === 1280) olcum.kontrast = await s.eval(kontrastOlc);
        sonuc.ekranlar[ad][anahtar] = olcum;
        kapi(!olcum.yatayTasma, `${ad}/${anahtar}: yatay taşma (${olcum.tasmaPiksel}px)`);
        kapi(olcum.icIceButon === 0, `${ad}/${anahtar}: iç içe <button>`);
        kapi(!olcum.erisimReddi, `${ad}/${anahtar}: 403 kutusu`);
        kapi(olcum.h1Sayisi === 1, `${ad}/${anahtar}: h1 sayısı ${olcum.h1Sayisi}`);
        kapi(
          olcum.tema === (koyu ? "koyu" : "acik"),
          `${ad}/${anahtar}: tema uygulanmadı (${olcum.tema})`
        );
        // Rail masaüstünde görünür, mobilde gizli olmalı.
        if (genislik === 1280) {
          kapi(olcum.railGorunur, `${ad}/${anahtar}: rail görünmüyor`);
        } else {
          kapi(!olcum.railGorunur, `${ad}/${anahtar}: rail mobilde gizlenmedi`);
        }
        kapi(
          olcum.adsizKontroller.length === 0,
          `${ad}/${anahtar}: adsız form kontrolü (${olcum.adsizKontroller.length})`
        );
        await s.ss(join(OUT, `${ad}-${anahtar}.png`));
      }
    }
  }

  /* ── E-1: rail katlama (masaüstü) ── */
  await s.genislik(1280);
  await s.git(`${FRONTEND}${EKRANLAR.magaza}`);
  await s.hazirBekle();
  const acikGenislik = (await s.eval(duzenOlc)).railGenisligi;
  await s.eval(dugmeyeBas, "Menüyü katla");
  await new Promise((r) => setTimeout(r, 600));
  const katliOlcum = await s.eval(duzenOlc);
  await s.ss(join(OUT, "kabuk-rail-katli-1280.png"));
  // Yeniden yükle: tercih kalıcı mı
  await s.git(`${FRONTEND}${EKRANLAR.envanter}`);
  await s.hazirBekle();
  const yenidenOlcum = await s.eval(duzenOlc);
  sonuc.etkilesim.katlama = {
    acikGenislik,
    katliGenislik: katliOlcum.railGenisligi,
    katliDurum: katliOlcum.railKatli,
    yenidenYuklemedeKatli: yenidenOlcum.railKatli,
    katliAdlar: await s.eval(() =>
      Array.from(
        document.querySelectorAll('[data-testid="panel-rail"] nav a')
      ).map((a) => (a.getAttribute("aria-label") || a.textContent || "").trim())
    ),
  };
  kapi(katliOlcum.railGenisligi < acikGenislik, "katlama: rail daralmadı");
  kapi(yenidenOlcum.railKatli === "true", "katlama: tercih yeniden yüklemede korunmadı");
  kapi(
    sonuc.etkilesim.katlama.katliAdlar.every((a) => a.length > 0),
    "katlama: katlı railde adsız gezinme bağlantısı var"
  );
  // Geri aç
  await s.eval(dugmeyeBas, "Menüyü katla");
  await new Promise((r) => setTimeout(r, 500));

  /* ── E-2: Ctrl+K komut penceresi + klavye ── */
  await s.git(`${FRONTEND}${EKRANLAR.magaza}`);
  await s.hazirBekle();
  await s.tus("k", { code: 75, mods: { modifiers: 2 } }); // 2 = Ctrl
  await new Promise((r) => setTimeout(r, 700));
  const pencere = await s.eval(pencereVarMi);
  const odakKomut = await s.eval(odaklanan);
  await s.ss(join(OUT, "kabuk-komut-penceresi-1280.png"));
  const suzme = await s.eval(() => {
    const g = document.querySelector('[role="combobox"]');
    if (!g) return { hata: "combobox yok" };
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(
      g,
      "envanter"
    );
    g.dispatchEvent(new Event("input", { bubbles: true }));
    return { yazildi: true };
  });
  await new Promise((r) => setTimeout(r, 500));
  const secenekler = await s.eval(() =>
    Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent.trim())
  );
  await s.tus("Enter", { code: 13, text: String.fromCharCode(13) });
  await new Promise((r) => setTimeout(r, 1500));
  sonuc.etkilesim.komutPenceresi = {
    pencere,
    odak: odakKomut,
    suzme,
    secenekler,
    gidilenYol: await s.eval(() => location.pathname),
    pencereKapandi: (await s.eval(pencereVarMi)) === null,
  };
  kapi(!!pencere, "Ctrl+K: pencere açılmadı");
  kapi(pencere?.ariaModal === "true", "Ctrl+K: aria-modal yok");
  kapi(!!pencere?.ad, "Ctrl+K: pencerenin erişilebilir adı yok");
  kapi(odakKomut?.etiket === "input", "Ctrl+K: odak arama kutusuna gitmedi");
  kapi(secenekler.length === 1, `Ctrl+K: süzme ${secenekler.length} sonuç verdi (beklenen 1)`);
  kapi(
    sonuc.etkilesim.komutPenceresi.gidilenYol === EKRANLAR.envanter,
    `Ctrl+K: Enter gezindirmedi (${sonuc.etkilesim.komutPenceresi.gidilenYol})`
  );

  /* ── E-3: G + harf kısayolu ── */
  await s.git(`${FRONTEND}${EKRANLAR.magaza}`);
  await s.hazirBekle();
  await s.eval(() => document.body.focus());
  await s.tus("g", { code: 71, text: "g" });
  await s.tus("k", { code: 75, text: "k" });
  await new Promise((r) => setTimeout(r, 1500));
  const kisayolYol = await s.eval(() => location.pathname);
  // Girdi odaktayken tetiklenmemeli
  await s.git(`${FRONTEND}${EKRANLAR.magaza}`);
  await s.hazirBekle();
  await s.eval(() => {
    const g = document.querySelector('input[type="search"], input[type="text"], input');
    if (g) {
      g.focus();
      return true;
    }
    return false;
  });
  await s.tus("g", { code: 71, text: "g" });
  await s.tus("k", { code: 75, text: "k" });
  await new Promise((r) => setTimeout(r, 1200));
  sonuc.etkilesim.kisayol = {
    gKIleGidilen: kisayolYol,
    girdiOdaktaykenYol: await s.eval(() => location.pathname),
  };
  kapi(kisayolYol === "/yonetim/kullanicilar", `G+K gezindirmedi (${kisayolYol})`);
  kapi(
    sonuc.etkilesim.kisayol.girdiOdaktaykenYol === EKRANLAR.magaza,
    "G+K girdi odaktayken TETİKLENDİ (olmamalıydı)"
  );

  /* ── E-4: profil menüsü + tema anahtarı (gerçek tıklama) ── */
  await s.git(`${FRONTEND}${EKRANLAR.magaza}`);
  await s.hazirBekle();
  await s.eval(dugmeyeBas, "Hesap menüsü");
  await new Promise((r) => setTimeout(r, 500));
  await s.ss(join(OUT, "kabuk-profil-menusu-1280.png"));
  const temaSecenekleri = await s.eval(() =>
    Array.from(document.querySelectorAll('[role="menu"] input[type="radio"]')).map((r) => ({
      deger: r.value,
      ad: (r.closest("label")?.textContent ?? "").trim(),
      secili: r.checked,
    }))
  );
  await s.eval(() => {
    const r = Array.from(document.querySelectorAll('[role="menu"] input[type="radio"]')).find(
      (x) => x.value === "dark"
    );
    r?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  sonuc.etkilesim.tema = {
    secenekler: temaSecenekleri,
    koyuSecinceSinif: await s.eval(() => document.documentElement.classList.contains("dark")),
  };
  kapi(temaSecenekleri.length === 3, `tema: ${temaSecenekleri.length} seçenek (beklenen 3)`);
  kapi(sonuc.etkilesim.tema.koyuSecinceSinif, "tema: 'Koyu' seçilince .dark uygulanmadı");
  await s.eval(() => {
    const r = Array.from(document.querySelectorAll('[role="menu"] input[type="radio"]')).find(
      (x) => x.value === "light"
    );
    r?.click();
  });

  /* ── E-5: mobil çekmece ── */
  await s.genislik(380);
  await s.git(`${FRONTEND}${EKRANLAR.magaza}`);
  await s.hazirBekle();
  await s.eval(dugmeyeBas, "Yönetim menüsünü aç");
  await new Promise((r) => setTimeout(r, 700));
  const cekmece = await s.eval(pencereVarMi);
  await s.ss(join(OUT, "kabuk-mobil-cekmece-380.png"));
  const cekmeceOdak = [];
  for (let i = 0; i < 6; i++) {
    await s.tus("Tab", { code: 9 });
    cekmeceOdak.push(await s.eval(odaklanan));
  }
  await s.tus("Escape", { code: 27 });
  await new Promise((r) => setTimeout(r, 600));
  sonuc.etkilesim.mobilCekmece = {
    cekmece,
    odakDisinaCikti: cekmeceOdak.some((o) => o && !o.pencereIcinde),
    escKapatti: (await s.eval(pencereVarMi)) === null,
  };
  kapi(!!cekmece, "mobil: çekmece açılmadı");
  kapi(cekmece?.ariaModal === "true", "mobil: çekmecede aria-modal yok");
  kapi(!sonuc.etkilesim.mobilCekmece.odakDisinaCikti, "mobil: odak çekmecenin dışına çıktı");
  kapi(sonuc.etkilesim.mobilCekmece.escKapatti, "mobil: ESC çekmeceyi kapatmadı");

  /* ── E-6: odak halkası görünürlüğü (klavyeyle) ── */
  await s.genislik(1280);
  await s.git(`${FRONTEND}${EKRANLAR.magaza}`);
  await s.hazirBekle();
  const halkalar = [];
  for (let i = 0; i < 8; i++) {
    await s.tus("Tab", { code: 9 });
    halkalar.push(await s.eval(odakHalkasiOlc));
  }
  sonuc.etkilesim.odakHalkasi = halkalar.filter(Boolean);
  kapi(
    sonuc.etkilesim.odakHalkasi.length > 0 &&
      sonuc.etkilesim.odakHalkasi.every((h) => h.halkaVar),
    "odak halkası: klavyeyle gezilen bir öğede halka yok"
  );

  sonuc.hataliAdim = hataliAdim;
  writeFileSync(join(OUT, "tur.json"), JSON.stringify(sonuc, null, 2), "utf8");
  console.log(JSON.stringify({ hataliAdim, dusenKapilar: sonuc.dusenKapilar ?? [] }, null, 2));
} finally {
  chrome.kill();
}
process.exit(hataliAdim === 0 ? 0 : 1);
