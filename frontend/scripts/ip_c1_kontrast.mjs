// İP-C1 — karşılıklı hero banner kontrast sondası (gerçek Chrome + ham CDP).
//
// ══════════════════════════════════════════════════════════════════════════
// NEDEN YENİDEN YAZILDI (yamalanmadı)
// ══════════════════════════════════════════════════════════════════════════
//
// İlk sürüm zemini `<img>`in NATURAL piksellerinden okuyor, görüntülenen
// kutuyu natural koordinata elle eşliyordu. Eşleme hatalıydı:
//
//     const natXScaled = dx * scale + offX;
//     const nx = Math.round(natXScaled / scale);   // = dx + offX  →  ölçek iptal
//
// Yani `scale` sadeleşiyor, ölçüm "CSS pikseli natural piksele eşit" varsayan
// bir şeye dönüşüyordu. Denetim bunu somut kanıtla yakaladı: metin +200 CSS px
// kaydırıldığında natural aralık 375→553 px kaymalıyken script sabit 200 px
// kaydırıyordu.
//
// Formülü düzeltmek yetmezdi — YAKLAŞIM yanlıştı. Natural pikselden okumak,
// ölçümün sırtına şunların TAMAMINI elle modellemeyi yıkıyordu: object-fit
// kırpması, scrim alfa kompozisyonu, tema, `transform`, tarayıcı ölçekleme,
// DPR. Her biri ayrı bir sessiz hata kaynağı.
//
// Bu sürüm zemini RENDER EDİLMİŞ SAYFADAN okur: `Page.captureScreenshot` ile
// kompozit piksel alınır. Böylece "eşleme" diye bir kavram kalmaz — ekranda
// ne varsa o ölçülür. Tek koordinat dönüşümü kalır ve o da ölçülebilirdir:
//
//     ekranGoruntusuPx = cssViewportPx × (ssGenislik / window.innerWidth)
//
// Ölçek TAHMİN EDİLMEZ, ekran görüntüsünün kendi genişliğinden TÜRETİLİR;
// deviceScaleFactor (DPR) ne olursa olsun kendi kendini düzeltir.
//
// Metin nasıl "arkasındaki zemin"e dönüşür: ölçümden hemen önce metnin rengi
// saydama çekilir (`color`/`-webkit-text-fill-color`), ekran görüntüsü alınır,
// renk geri konur. Yerleşim ve scrim aynen yerinde kalır; kareden yalnız
// glyph'ler düşer. Böylece örneklenen her piksel gerçekten METNİN ARKASIDIR —
// glyph pikselini zemin sanıp 1.0 kontrast raporlama riski yok.
//
// Örnekleme alanı elementin kutusu DEĞİL, metnin kendi satır kutularıdır
// (`Range.getClientRects`) — scrim'in dolgusu (padding) metin sayılmaz.
// Izgara adımı en fazla 2 CSS px'tir. Eski 11×11=121 noktalık ızgara ölçümü
// tekrarlanabilir kılmıyordu (aynı kodda commit 6.9 / taze koşu 6.84 okudu).
//
// ══════════════════════════════════════════════════════════════════════════
// KAPI (sıfır örnek = BAŞARISIZLIK)
// ══════════════════════════════════════════════════════════════════════════
//
// Eski kapı `gecti === false` sayıyordu; hata kaydında `gecti` undefined
// olduğu için sayıma girmiyordu → kapsamın yarısı sessizce düşerken exit 0.
// Denetimde gerçekten yaşandı (soğuk koşu, selector bulunamadı, kapı yeşil).
// Bu sürümde beklenen kombinasyon sayısı ÖNCEDEN sabittir; `gecti === true`
// sayısı ona eşit değilse veya tek bir hata kaydı varsa exit 1.
//
// ══════════════════════════════════════════════════════════════════════════
// KULLANIM (frontend/)
// ══════════════════════════════════════════════════════════════════════════
//   npm run dev -- --port 5199
//   node scripts/ip_c1_kontrast.mjs --frontend http://127.0.0.1:5199
//   node scripts/ip_c1_kontrast.mjs --frontend … --sweep      # scrim alfa taraması
//   node scripts/ip_c1_kontrast.mjs --frontend … --selftest   # aletin kendi kapısı
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Banner kimlikleri bileşenle AYNI KAYNAKTAN gelir. Sabit string kopyası
// tutulmaz: etiket değişirse script kendiliğinden yeni etiketi arar, kopya
// geri gelirse `crossPromoBanner.acceptance.test.tsx::N-3` patlar.
import CROSS_PROMO from "../src/config/crossPromo.json" with { type: "json" };

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]?.startsWith("--") ? "1" : (arr[i + 1] ?? "1")]);
    return acc;
  }, [])
);
const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5199";
const OUT = resolve(ARGS.out ?? "../docs/ip-c1");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DPR = Number(ARGS.dpr ?? 1);
const SWEEP = "sweep" in ARGS;
const SELFTEST = "selftest" in ARGS;

const ESIK = 4.5;
const ORNEK_ADIMI_CSS = 2; // ızgara yoğunluğu: en fazla 2 CSS px

const BANNERLAR = Object.entries(CROSS_PROMO).map(([anahtar, c]) => ({
  anahtar,
  ad: anahtar === "landingToStore" ? "landing-magaza-banner" : "magaza-ozelders-banner",
  path: c.pagePath,
  imageSrc: c.imageSrc,
  selector: `a[aria-label="${c.ariaLabel}"]`,
}));
const VIEWPORTS = [
  { w: 1280, h: 1000, ad: "1280" },
  { w: 380, h: 900, ad: "380" },
];
const TEMALAR = [
  { ad: "acik", koyu: false },
  { ad: "koyu", koyu: true },
];
const ALFALAR = [0, 0.3, 0.5, 0.6, 0.7, 0.8];

/** Kapının önceden sabitlenmiş kapsamı — "sıfır örnek de yeşil" kusurunun panzehiri. */
const BEKLENEN_KOMBINASYON = BANNERLAR.length * VIEWPORTS.length * TEMALAR.length;

const uyu = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══════════════════════ Chrome yaşam döngüsü ══════════════════════ */

/**
 * Boş port: RASTGELE SEÇİLMEZ, gerçekten bind edilir.
 *
 * Eski hâl `9200 + rand(500)` idi; denetimde yabancı bir Chrome'a bağlanıldı
 * ve iki kez CDP zaman aşımı yaşandı. `listen(0)` işletim sisteminden
 * GERÇEKTEN boş bir port ister ve onu bind eder; kapatıp Chrome'a devrederiz.
 */
function bosPortAl() {
  return new Promise((coz, red) => {
    const s = createServer();
    s.once("error", red);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => coz(port));
    });
  });
}

/**
 * Profil dizini adına gömülü benzersiz damga → süreç ağacını sonra bununla
 * sayarız. YALNIZ kendi damgamızı taşıyan süreçler görünür; makinedeki başka
 * Chrome pencerelerine, MCP sunucularına veya başka oturumlara dokunmaz.
 */
function damgaliPidler(damga) {
  if (process.platform !== "win32") return [];
  try {
    const cikti = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${damga}*' } | Select-Object -ExpandProperty ProcessId) -join ','`,
      ],
      { encoding: "utf8" }
    );
    return cikti
      .trim()
      .split(",")
      .map((x) => Number.parseInt(x, 10))
      .filter((x) => Number.isFinite(x));
  } catch {
    return null; // sayılamadı
  }
}

/**
 * Chrome'u ağacıyla birlikte sonlandırır.
 *
 * `child.kill()` Windows'ta yalnız başlatılan süreci hedefler; Chrome'un
 * renderer/GPU/utility çocukları hayatta kalır (denetimde sızıntı görüldü).
 * `taskkill /T /F` ağacı keser, ardından kalan süreç sayısı DOĞRULANIR.
 */
async function chromeKapat(pid, damga, profil) {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* süreç zaten ölmüş olabilir */
    }
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* yok */
    }
  }
  // İlk tur ağacı keser ama Chrome'un yeniden ebeveynlenmiş yardımcıları
  // (crashpad vb.) saniyelerce yaşayabiliyor — bir koşuda 2, bir koşuda 1
  // süreç "hâlâ ayakta" raporlandı, sonra kendiliğinden düştüler. Bu yüzden
  // 5 sn beklenir, hâlâ kalan varsa kalanlar PID hedefli ikinci kez kesilir.
  let kalan = -1;
  const say = () => {
    const l = damgaliPidler(damga);
    return l === null ? -1 : l.length;
  };
  for (let tur = 0; tur < 2; tur++) {
    for (let i = 0; i < 20; i++) {
      kalan = say();
      if (kalan === 0 || kalan < 0) break;
      await uyu(250);
    }
    if (kalan <= 0) break;
    const artik = damgaliPidler(damga) ?? [];
    for (const q of artik) {
      try {
        execFileSync("taskkill", ["/PID", String(q), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* yarışta çoktan ölmüş olabilir */
      }
    }
  }
  try {
    rmSync(profil, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    /* profil silinemezse ölçüm sonucunu etkilemez */
  }
  return kalan;
}

async function chromeBaslat(vp, dpr) {
  const port = await bosPortAl();
  const damga = `c1-kontrast-${process.pid}-${port}`;
  const profil = join(tmpdir(), damga);
  mkdirSync(profil, { recursive: true });
  const p = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profil}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--hide-scrollbars",
      `--force-device-scale-factor=${dpr}`,
      `--window-size=${vp.w},${vp.h}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let acildi = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) {
        acildi = true;
        break;
      }
    } catch {
      /* bekle */
    }
    await uyu(200);
  }
  if (!acildi) {
    await chromeKapat(p.pid, damga, profil);
    throw new Error(`Chrome DevTools portu açılmadı (port ${port})`);
  }

  // Tazelik nöbetçisi: bind edilmiş porta rağmen yabancı bir tarayıcıya
  // bağlanmadığımızı doğrula. Taze bir örnekte tek bir `about:blank` sekmesi
  // olur; yabancı profilde onlarca hedef bulunur.
  const hedefler = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(
    (t) => t.type === "page"
  );
  if (hedefler.length !== 1 || !String(hedefler[0].url).startsWith("about:blank")) {
    await chromeKapat(p.pid, damga, profil);
    throw new Error(
      `Port ${port}'te taze olmayan bir Chrome bulundu (${hedefler.length} sekme) — yabancı tarayıcıya bağlanma riski`
    );
  }
  return { pid: p.pid, port, damga, profil, hedef: hedefler[0] };
}

/* ══════════════════════ CDP istemcisi ══════════════════════ */

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
  /** Sayfaya git ve selector GERÇEKTEN monte olana kadar bekle; olmazsa PATLA. */
  async git(url, selector) {
    await this.gonder("Page.navigate", { url });
    for (let i = 0; i < 120; i++) {
      if (await this.eval(() => document.readyState === "complete")) break;
      await uyu(250);
    }
    // Tembel rota parçaları (React.lazy + Suspense) "readyState complete"ten
    // çok sonra monte olabilir — sabit gecikme yerine selector'ü yokla.
    let bulundu = false;
    for (let i = 0; i < 60; i++) {
      if (await this.eval((s) => !!document.querySelector(s), selector)) {
        bulundu = true;
        break;
      }
      await uyu(300);
    }
    if (!bulundu) {
      throw new Error(
        `Selector sayfada bulunamadı: ${selector} — ${url}\n` +
          `  (banner adı crossPromo.json ile uyuşmuyor olabilir; ölçüm YAPILAMADI)`
      );
    }
    await uyu(300);
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
  async ssDataUrl() {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    return `data:image/png;base64,${r.data}`;
  }
  async tus(key, code, keyCode) {
    for (const type of ["keyDown", "keyUp"]) {
      await this.gonder("Input.dispatchKeyEvent", {
        type,
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
    }
  }
}

/* ══════════════════════ Sayfa içi parçalar ══════════════════════ */

/** Banner'ı görünür alana getirir ve arka plan görselinin çözüldüğünü bekler. */
const hazirla = async (selector) => {
  const link = document.querySelector(selector);
  if (!link) return { hata: `bulunamadı: ${selector}` };
  link.scrollIntoView({ block: "center", behavior: "instant" });
  const img = link.querySelector("img");
  if (!img) return { hata: "banner içinde <img> yok" };
  for (let i = 0; i < 60; i++) {
    if (img.complete && img.naturalWidth > 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!img.complete || !img.naturalWidth) return { hata: "görsel yüklenmedi" };
  try {
    await img.decode();
  } catch {
    /* decode desteklenmiyorsa complete kontrolü yeterli */
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { tamam: true, imgSrc: img.getAttribute("src") };
};

/**
 * Metnin GLYPH kutularını (element kutusu değil) ve ön plan rengini okur.
 * `Range.selectNodeContents` + `getClientRects` satır kutularını verir; scrim
 * dolgusu (padding) dışarıda kalır.
 */
const metinBilgisi = (selector) => {
  const link = document.querySelector(selector);
  if (!link) return { hata: `bulunamadı: ${selector}` };
  const el = link.querySelector("[data-hero-text]");
  if (!el) return { hata: "data-hero-text yok" };
  const metin = el.textContent.trim();
  if (!metin) return { hata: "ölçülen öğenin metni boş — yanlış öğe olabilir" };

  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
  if (!rects.length) return { hata: "glyph kutusu ölçülemedi (görünmez metin?)" };

  const st = getComputedStyle(el);
  const px = Number.parseFloat(st.fontSize);
  const kalin = Number.parseInt(st.fontWeight, 10) >= 700;
  const katman = link.querySelector("[data-hero-scrim]");
  const katmanSt = katman ? getComputedStyle(katman) : null;
  return {
    metinIcerik: metin,
    fgCss: st.color,
    scrimBg: st.backgroundColor,
    scrimKatmani: katmanSt
      ? { backgroundColor: katmanSt.backgroundColor, backgroundImage: katmanSt.backgroundImage }
      : null,
    fontPx: px,
    kalin,
    buyukMetinMi: px >= 24 || (kalin && px >= 18.66),
    rects,
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio,
  };
};

/** Metni saydama çeker (yerleşim ve scrim yerinde kalır) → önceki satır içi değerleri döner. */
const metniGizle = (selector) => {
  const el = document.querySelector(selector)?.querySelector("[data-hero-text]");
  if (!el) return { hata: "metin öğesi yok" };
  const onceki = { color: el.style.color, fill: el.style.webkitTextFillColor };
  el.style.color = "transparent";
  el.style.webkitTextFillColor = "transparent";
  return { onceki };
};

const metniGoster = (selector, onceki) => {
  const el = document.querySelector(selector)?.querySelector("[data-hero-text]");
  if (!el) return false;
  el.style.color = onceki.color ?? "";
  el.style.webkitTextFillColor = onceki.fill ?? "";
  return true;
};

/**
 * Örtüyü (scrim) satır içi ezer; `null` ezmeyi kaldırır.
 *
 * Örtü iki yerden birinde olabilir: ayrı bir katman (`data-hero-scrim`, yönlü
 * gradyan için) ya da metnin kendi arka planı (eski "hap" biçimi). Tarama TEK
 * bir örtü uygular — ikisine birden yazılırsa alfalar üst üste biner ve
 * ölçülen değer istenen alfadan koyu çıkar (0.5 + 0.5 = 0.75 etkin).
 */
const scrimAyarla = (selector, css) => {
  const link = document.querySelector(selector);
  const el = link?.querySelector("[data-hero-text]");
  if (!el) return { hata: "metin öğesi yok" };
  const katman = link.querySelector("[data-hero-scrim]");
  if (css === null) {
    for (const n of [el, katman]) {
      if (!n) continue;
      n.style.backgroundColor = "";
      n.style.backgroundImage = "";
    }
    link.querySelector("[data-hero-scrim-gecici]")?.remove();
    return { uygulandi: null, katmanVar: !!katman };
  }
  // Örtü katmanı yoksa GEÇİCİ bir tane enjekte edilir. Metin span'ının kendi
  // arka planını boyamak YETMEZ: inline bir öğenin arka planı yalnız içerik
  // alanını (≈font-size) kaplar, oysa örneklenen satır kutusu line-height
  // kadar uzundur — üstteki/alttaki boşluk örtüsüz kalır ve tarama her alfada
  // AYNI değeri okur. (Bu kusur gerçekten yaşandı: mağaza banner'ı örtü
  // kaldırıldıktan sonra 0.0–0.8 arası hep 9.32 raporladı.)
  let hedef = katman;
  if (!hedef) {
    hedef = link.querySelector("[data-hero-scrim-gecici]");
    if (!hedef) {
      hedef = document.createElement("span");
      hedef.setAttribute("data-hero-scrim-gecici", "");
      hedef.style.position = "absolute";
      hedef.style.inset = "0";
      link.insertBefore(hedef, link.querySelector("[data-hero-text]")?.parentElement ?? null);
    }
  }
  hedef.style.backgroundImage = "none";
  hedef.style.backgroundColor = css;
  el.style.backgroundImage = "none";
  el.style.backgroundColor = "transparent";
  return {
    uygulandi: getComputedStyle(hedef).backgroundColor,
    katmanVar: !!katman,
    geciciKatman: !katman,
  };
};

/** Eşleme regresyon nöbetçisi için metni yatay kaydırır. */
const metniKaydir = (selector, dxCss) => {
  const el = document.querySelector(selector)?.querySelector("[data-hero-text]");
  if (!el) return { hata: "metin öğesi yok" };
  el.style.transform = dxCss === 0 ? "" : `translateX(${dxCss}px)`;
  return { transform: getComputedStyle(el).transform };
};

/**
 * Ekran görüntüsünün KOMPOZİT piksellerinden en kötü kontrastı bulur.
 *
 * Ölçek tahmin edilmez: `ssGenislik / window.innerWidth`ten türetilir, yani
 * deviceScaleFactor ne olursa olsun doğru. Örnekleme yalnız glyph kutularının
 * içinde ve en fazla `adim` CSS px aralıkla yapılır.
 */
const pikselOrnekle = async (girdi) => {
  const { dataUrl, rects, fgCss, adim, esik } = girdi;

  const rgba = (s) => {
    const p = (s.match(/[\d.]+/g) || []).map(Number);
    if (p.length === 3) return [p[0], p[1], p[2], 1];
    return p.length >= 4 ? p : [0, 0, 0, 1];
  };
  const kanal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const parlaklik = (p) => 0.2126 * kanal(p[0]) + 0.7152 * kanal(p[1]) + 0.0722 * kanal(p[2]);
  const oran = (a, b) => {
    const x = parlaklik(a) + 0.05;
    const y = parlaklik(b) + 0.05;
    return +(Math.max(x, y) / Math.min(x, y)).toFixed(2);
  };
  /** `ust`ü (alfalı) `alt`ın üzerine bindirir → opak rgb. */
  const uzerine = (alt, ust) => {
    const a = ust[3];
    return [ust[0] * a + alt[0] * (1 - a), ust[1] * a + alt[1] * (1 - a), ust[2] * a + alt[2] * (1 - a)];
  };

  const gorsel = new Image();
  gorsel.src = dataUrl;
  await gorsel.decode();
  const c = document.createElement("canvas");
  c.width = gorsel.naturalWidth;
  c.height = gorsel.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(gorsel, 0, 0);
  const veri = ctx.getImageData(0, 0, c.width, c.height).data;

  const olcek = c.width / window.innerWidth; // GERÇEK DPR — ölçüm sonucundan türetilir
  const fg = rgba(fgCss);

  let enKotu = null;
  let ornek = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;

  for (const r of rects) {
    const nx = Math.max(2, Math.ceil(r.w / adim) + 1);
    const ny = Math.max(2, Math.ceil(r.h / adim) + 1);
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const cssX = r.x + (r.w * ix) / (nx - 1);
        const cssY = r.y + (r.h * iy) / (ny - 1);
        const px = Math.min(c.width - 1, Math.max(0, Math.round(cssX * olcek)));
        const py = Math.min(c.height - 1, Math.max(0, Math.round(cssY * olcek)));
        const i = (py * c.width + px) * 4;
        const zemin = [veri[i], veri[i + 1], veri[i + 2]];
        const on = fg[3] >= 1 ? fg.slice(0, 3) : uzerine(zemin, fg);
        const k = oran(on, zemin);
        ornek++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        if (!enKotu || k < enKotu.kontrast) {
          enKotu = { kontrast: k, zemin: zemin.map(Math.round), px, py, cssX: +cssX.toFixed(1), cssY: +cssY.toFixed(1) };
        }
      }
    }
  }
  if (!ornek) return { hata: "hiç örnek alınamadı" };

  return {
    enKotuKontrast: enKotu.kontrast,
    enKotuZemin: `rgb(${enKotu.zemin.join(", ")})`,
    enKotuPiksel: { x: enKotu.px, y: enKotu.py, cssX: enKotu.cssX, cssY: enKotu.cssY },
    ornekSayisi: ornek,
    ornekAralik: { x0, x1, y0, y1 },
    olculenDpr: +olcek.toFixed(3),
    ssBoyut: { w: c.width, h: c.height },
    esik,
    gecti: enKotu.kontrast >= esik,
  };
};

/**
 * Odak halkası — GERÇEK `:focus-visible` altında. Programatik `focus()` tek
 * başına Chromium'da `:focus-visible` eşleşmesini garanti etmez; çağrıdan önce
 * sayfaya gerçek bir Tab tuşu gönderilir (`sayfa.tus`).
 */
const odakOlc = (selector) => {
  const link = document.querySelector(selector);
  if (!link) return { hata: `odak ölçümü: bulunamadı ${selector}` };
  link.focus();
  const st = getComputedStyle(link);
  return {
    focusVisible: link.matches(":focus-visible"),
    boxShadow: st.boxShadow,
    outline: `${st.outlineStyle} ${st.outlineWidth} ${st.outlineColor}`,
  };
};

/* ══════════════════════ Ölçüm sürücüsü ══════════════════════ */

/**
 * Tek bir kombinasyonu ölçer. Herhangi bir adım eksik kalırsa `throw` eder —
 * "sessizce eksik sonuç" bu katmanda mümkün değildir.
 */
async function olcumYap(sayfa, selector) {
  const h = await sayfa.eval(hazirla, selector);
  if (h.hata) throw new Error(`hazırlık: ${h.hata}`);

  const bilgi = await sayfa.eval(metinBilgisi, selector);
  if (bilgi.hata) throw new Error(`metin bilgisi: ${bilgi.hata}`);

  const gizle = await sayfa.eval(metniGizle, selector);
  if (gizle.hata) throw new Error(`metni gizleme: ${gizle.hata}`);
  let olcum;
  try {
    await sayfa.eval(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const dataUrl = await sayfa.ssDataUrl();
    olcum = await sayfa.eval(pikselOrnekle, {
      dataUrl,
      rects: bilgi.rects,
      fgCss: bilgi.fgCss,
      adim: ORNEK_ADIMI_CSS,
      esik: ESIK,
    });
  } finally {
    await sayfa.eval(metniGoster, selector, gizle.onceki);
  }
  if (olcum.hata) throw new Error(`piksel örnekleme: ${olcum.hata}`);

  return {
    metinIcerik: bilgi.metinIcerik,
    onRenk: bilgi.fgCss,
    scrimBg: bilgi.scrimBg,
    scrimKatmani: bilgi.scrimKatmani,
    fontPx: bilgi.fontPx,
    kalin: bilgi.kalin,
    buyukMetinMi: bilgi.buyukMetinMi,
    glyphKutuSayisi: bilgi.rects.length,
    imgSrc: h.imgSrc,
    ...olcum,
  };
}

/** Kapı kararı SAF fonksiyondur → kendi kendini test edebilir (bkz. --selftest). */
export function kapiSonucu(sonuc, beklenen) {
  const kayitlar = Object.entries(sonuc);
  const hatalar = kayitlar.filter(([, o]) => o && o.hata).map(([k]) => k);
  const gecen = kayitlar.filter(([, o]) => o && o.gecti === true).length;
  const kalan = kayitlar.filter(([, o]) => o && o.gecti === false).map(([k]) => k);
  const mesajlar = [];
  if (hatalar.length) mesajlar.push(`HATA KAYDI: ${hatalar.join(", ")}`);
  if (gecen !== beklenen)
    mesajlar.push(`KAPSAM EKSİK: ${gecen}/${beklenen} kombinasyon eşiği geçti (eksik ölçüm sessizce düşmüş olabilir)`);
  if (kalan.length) mesajlar.push(`EŞİK ALTI: ${kalan.join(", ")}`);
  return { kod: mesajlar.length ? 1 : 0, gecen, beklenen, mesajlar };
}

/** Bir viewport için Chrome açar, işi çalıştırır, ağacı sonlandırır. */
async function viewportIle(vp, dpr, is) {
  const c = await chromeBaslat(vp, dpr);
  let ws;
  try {
    ws = new WebSocket(c.hedef.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    const sayfa = new Sayfa(ws);
    await sayfa.gonder("Page.enable");
    await sayfa.gonder("Runtime.enable");
    await sayfa.gonder("Emulation.setDeviceMetricsOverride", {
      width: vp.w,
      height: vp.h,
      deviceScaleFactor: dpr,
      mobile: vp.w < 500,
    });
    return await is(sayfa);
  } finally {
    try {
      ws?.close();
    } catch {
      /* yok */
    }
    const kalanSurec = await chromeKapat(c.pid, c.damga, c.profil);
    console.log(`  [chrome] pid ${c.pid} sonlandırıldı — kalan süreç: ${kalanSurec}`);
    if (kalanSurec > 0) console.warn(`  [chrome] UYARI: ${kalanSurec} süreç hâlâ ayakta (${c.damga})`);
  }
}

/** Temayı kalıcı yaz ve sayfayı yeniden yükle. */
async function temaAyarla(sayfa, url, selector, koyu) {
  await sayfa.eval(
    (k) => {
      localStorage.setItem("adana-theme", JSON.stringify({ state: { preference: k ? "dark" : "light" }, version: 0 }));
      return true;
    },
    koyu
  );
  await sayfa.git(url, selector);
}

/* ══════════════════════ --selftest: aletin kendi kapısı ══════════════════════ */

/**
 * Negatif kontroller. Aletin "hep yeşil" olamayacağını KANITLAR:
 *   S-1 scrim alfa 0 iken landing banner'ı eşiği GEÇMEMELİ
 *   S-2 selector bilerek bozulduğunda ölçüm PATLAMALI (kapı exit 1)
 *   S-3 metin +200 CSS px kaydığında örneklenen piksel aralığı 200×DPR kadar
 *       kaymalı (eşleme regresyon nöbetçisi — eski aleti düşüren kusur)
 *   S-4 kapı fonksiyonu: hata kaydı ve eksik kapsam exit 1 üretmeli
 */
async function selftest() {
  const basarisiz = [];
  const not = (ad, gecti, detay) => {
    console.log(`  ${gecti ? "✓" : "✗"} ${ad} — ${detay}`);
    if (!gecti) basarisiz.push(ad);
  };

  // S-4 saf fonksiyon: tarayıcı gerekmiyor, önce koşsun.
  const s4a = kapiSonucu({ a: { hata: "bulunamadı" } }, 1);
  not("S-4a hata kaydı exit 1", s4a.kod === 1, JSON.stringify(s4a.mesajlar));
  const s4b = kapiSonucu({}, BEKLENEN_KOMBINASYON);
  not("S-4b sıfır örnek exit 1", s4b.kod === 1, JSON.stringify(s4b.mesajlar));
  const s4c = kapiSonucu({ a: { gecti: true }, b: { gecti: true } }, 2);
  not("S-4c tam kapsam exit 0", s4c.kod === 0, JSON.stringify(s4c));

  const landing = BANNERLAR.find((b) => b.anahtar === "landingToStore");
  const vp = VIEWPORTS[0];

  await viewportIle(vp, DPR, async (sayfa) => {
    const url = `${FRONTEND}${landing.path}`;
    await sayfa.git(url, landing.selector);

    // S-1 — scrim alfa 0
    await sayfa.eval(scrimAyarla, landing.selector, "rgba(0, 0, 0, 0)");
    const scrimsiz = await olcumYap(sayfa, landing.selector);
    await sayfa.eval(scrimAyarla, landing.selector, null);
    not(
      "S-1 scrim alfa 0 → eşik GEÇMEMELİ",
      scrimsiz.gecti === false,
      `kontrast ${scrimsiz.enKotuKontrast} (eşik ${ESIK}), ${scrimsiz.ornekSayisi} örnek`
    );

    // S-3 — eşleme regresyon nöbetçisi
    const once = await olcumYap(sayfa, landing.selector);
    await sayfa.eval(metniKaydir, landing.selector, 200);
    const sonra = await olcumYap(sayfa, landing.selector);
    await sayfa.eval(metniKaydir, landing.selector, 0);
    const beklenenKayma = 200 * once.olculenDpr;
    const gercekKayma = sonra.ornekAralik.x0 - once.ornekAralik.x0;
    not(
      "S-3 +200 CSS px kayma → örnek aralığı 200×DPR kaymalı",
      Math.abs(gercekKayma - beklenenKayma) <= 2,
      `beklenen ${beklenenKayma}px, ölçülen ${gercekKayma}px (DPR ${once.olculenDpr})`
    );

    // S-2 — bozuk selector
    let patladi = false;
    let mesaj = "";
    try {
      await sayfa.git(url, 'a[aria-label="BU-ETIKET-YOK-12345"]');
      await olcumYap(sayfa, 'a[aria-label="BU-ETIKET-YOK-12345"]');
    } catch (e) {
      patladi = true;
      mesaj = String(e.message).split("\n")[0];
    }
    not("S-2 bozuk selector → açık mesajla patlar", patladi, mesaj || "PATLAMADI");
  });

  console.log(`\nSELFTEST: ${basarisiz.length ? `BAŞARISIZ (${basarisiz.join(", ")})` : "TAMAM"}`);
  return basarisiz.length ? 1 : 0;
}

/* ══════════════════════ ana akış ══════════════════════ */

async function main() {
  mkdirSync(OUT, { recursive: true });

  if (SELFTEST) {
    process.exitCode = await selftest();
    return;
  }

  const sonuc = {};
  const tarama = {};

  for (const vp of VIEWPORTS) {
    await viewportIle(vp, DPR, async (sayfa) => {
      for (const tema of TEMALAR) {
        for (const b of BANNERLAR) {
          const key = `${b.ad}__vp${vp.ad}__${tema.ad}`;
          const url = `${FRONTEND}${b.path}`;
          await sayfa.git(url, b.selector);
          await temaAyarla(sayfa, url, b.selector, tema.koyu);

          sonuc[key] = await olcumYap(sayfa, b.selector);

          // Odak halkası: önce gerçek Tab (son girdi modalitesi → klavye).
          await sayfa.tus("Tab", "Tab", 9);
          await uyu(250);
          sonuc[key].odak = await sayfa.eval(odakOlc, b.selector);

          // Arşiv karesi: odak/yeniden yerleşim sonrası sayfa kaymış olabilir —
          // banner'ı tekrar görünür alana getir, yoksa kayda banner'sız bir
          // ekran düşüyor (ilk turda mağaza sayfasında bu yaşandı).
          await sayfa.eval(hazirla, b.selector);
          await sayfa.ss(join(OUT, `${key}__vp${vp.ad}.png`));
          console.log(
            `${key}  kontrast=${sonuc[key].enKotuKontrast} gecti=${sonuc[key].gecti} ` +
              `ornek=${sonuc[key].ornekSayisi} dpr=${sonuc[key].olculenDpr} scrim="${sonuc[key].scrimBg}"`
          );

          if (SWEEP) {
            for (const a of ALFALAR) {
              await sayfa.eval(scrimAyarla, b.selector, `rgba(0, 0, 0, ${a})`);
              const o = await olcumYap(sayfa, b.selector);
              tarama[`${key}__alfa${a}`] = {
                alfa: a,
                enKotuKontrast: o.enKotuKontrast,
                gecti: o.gecti,
                ornekSayisi: o.ornekSayisi,
                enKotuZemin: o.enKotuZemin,
              };
              console.log(`   alfa ${a.toFixed(2)} → ${o.enKotuKontrast} ${o.gecti ? "GEÇTİ" : "kaldı"}`);
            }
            await sayfa.eval(scrimAyarla, b.selector, null);
          }
        }
      }
    });
  }

  writeFileSync(join(OUT, "kontrast.json"), JSON.stringify(sonuc, null, 2));

  if (SWEEP) {
    // Her banner için EŞİĞİ GEÇEN EN DÜŞÜK ALFA — tüm viewport×tema
    // kombinasyonlarında geçmesi şartıyla (en kötü koşul belirler).
    const ozet = {};
    for (const b of BANNERLAR) {
      let enDusuk = null;
      for (const a of ALFALAR) {
        const ilgili = Object.entries(tarama).filter(
          ([k, v]) => k.startsWith(`${b.ad}__`) && v.alfa === a
        );
        if (ilgili.length && ilgili.every(([, v]) => v.gecti)) {
          enDusuk = a;
          break;
        }
      }
      const enKotuler = Object.fromEntries(
        ALFALAR.map((a) => [
          a,
          Math.min(
            ...Object.entries(tarama)
              .filter(([k, v]) => k.startsWith(`${b.ad}__`) && v.alfa === a)
              .map(([, v]) => v.enKotuKontrast)
          ),
        ])
      );
      ozet[b.ad] = { enDusukGuvenliAlfa: enDusuk, alfaBasinaEnKotu: enKotuler };
    }
    writeFileSync(join(OUT, "scrim-taramasi.json"), JSON.stringify({ ozet, ham: tarama }, null, 2));
    console.log("\n── SCRIM ALFA TARAMASI (her banner: tüm vp×tema'da en kötü) ──");
    for (const [ad, o] of Object.entries(ozet)) {
      console.log(`${ad}: en düşük güvenli alfa = ${o.enDusukGuvenliAlfa ?? "YOK"}`);
      for (const [a, k] of Object.entries(o.alfaBasinaEnKotu)) console.log(`   alfa ${a} → en kötü ${k}`);
    }
  }

  const kapi = kapiSonucu(sonuc, BEKLENEN_KOMBINASYON);
  console.log(`\nKAPI: ${kapi.gecen}/${kapi.beklenen} kombinasyon eşiği geçti`);
  for (const m of kapi.mesajlar) console.error(`  ✗ ${m}`);
  process.exitCode = kapi.kod;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
