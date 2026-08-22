// İP-C2 — Duyuru şeridi kontrast + CLS sondası (gerçek Chrome + ham CDP).
//
// ip_c1_kontrast.mjs'nin Chrome yaşam döngüsü/CDP istemcisi buradan
// AYNEN alındı (kanıtlanmış, sızıntısız kapanış). Ölçüm katmanı YENİDEN
// yazıldı: duyuru şeridi bir resim/scrim taşımaz — düz CSS zemin üstünde
// metin. Bu yüzden karmaşık object-fit/scrim modellemesi YOK; buna karşılık
// bu dosya YENİ bir ölçüm ekliyor: CLS (Cumulative Layout Shift), çünkü
// şerit ASENKRON veriyle gelir ve geç gelmesi sayfa içeriğini aşağı itebilir.
//
// ══════════════════════════════════════════════════════════════════════════
// KAPI (sıfır örnek = BAŞARISIZLIK) — ip_c1 ile AYNI disiplin
// ══════════════════════════════════════════════════════════════════════════
// Beklenen kombinasyon sayısı ÖNCEDEN sabittir (2 varyant × 2 tema × 2 hedef
// [metin, link] = 8); `gecti === true` sayısı ona eşit değilse ya da tek bir
// hata kaydı varsa exit 1.
//
// ══════════════════════════════════════════════════════════════════════════
// ÖN KOŞUL — bu script ÜRETMEZ, VAR OLAN gerçek sunucuya bağlanır
// ══════════════════════════════════════════════════════════════════════════
// Backend + frontend dev sunucuları ayakta olmalı VE veritabanında AKTİF bir
// `duyuru_seridi` satırı bulunmalı (varyantı script `--api` ucundan PATCH
// ile değiştirir — admin token gerekir). Mock veri YOK (kök CLAUDE.md).
//
//   backend: uvicorn main:app --port 8000  (POSTGRES_DB test'e işaret eder)
//   frontend: npx vite --port 5199         (aynı origin proxy: /api → 8000)
//   node scripts/duyuru_kontrast_cls.mjs --frontend http://127.0.0.1:5199 \
//        --duyuru-id 96 --admin-token <JWT>
//   node scripts/duyuru_kontrast_cls.mjs --selftest   (aletin kendi kapısı — sunucu gerekmez)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]?.startsWith("--") ? "1" : (arr[i + 1] ?? "1")]);
    return acc;
  }, [])
);
const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5199";
const OUT = resolve(ARGS.out ?? "../docs/ip-c2");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DPR = Number(ARGS.dpr ?? 1);
const SELFTEST = "selftest" in ARGS;
const DUYURU_ID = ARGS["duyuru-id"];
const ADMIN_TOKEN = ARGS["admin-token"];
const API_BASE = ARGS.api ?? `${FRONTEND}/api/v1`;

const ESIK = 4.5;
const ORNEK_ADIMI_CSS = 2;
const SELECTOR = '[role="region"][aria-label="Duyuru"]';
const VIEWPORT = { w: 1280, h: 900 };
const TEMALAR = [
  { ad: "acik", koyu: false },
  { ad: "koyu", koyu: true },
];
const VARYANTLAR = ["bilgi", "dikkat"];
const HEDEFLER = [
  { ad: "metin", selector: `${SELECTOR} [data-duyuru-metin]` },
  { ad: "link", selector: `${SELECTOR} [data-duyuru-link]` },
];

const BEKLENEN_KOMBINASYON = VARYANTLAR.length * TEMALAR.length * HEDEFLER.length;

const uyu = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══════════════════════ Chrome yaşam döngüsü (ip_c1'den birebir) ══════════════════════ */

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
    return cikti.trim().split(",").map((x) => Number.parseInt(x, 10)).filter((x) => Number.isFinite(x));
  } catch {
    return null;
  }
}

async function chromeKapat(pid, damga, profil) {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* zaten ölmüş olabilir */
    }
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* yok */
    }
  }
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

async function chromeBaslat(vp, dpr, ekBayraklar = []) {
  const port = await bosPortAl();
  const damga = `c2-kontrast-${process.pid}-${port}`;
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
      ...ekBayraklar,
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

  const hedefler = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(
    (t) => t.type === "page"
  );
  if (hedefler.length !== 1 || !String(hedefler[0].url).startsWith("about:blank")) {
    await chromeKapat(p.pid, damga, profil);
    throw new Error(`Port ${port}'te taze olmayan bir Chrome bulundu (${hedefler.length} sekme)`);
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
      throw new Error(`Sayfa içi hata: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result.value;
  }
  async git(url, selector, { bekleZorunlu = true } = {}) {
    await this.gonder("Page.navigate", { url });
    for (let i = 0; i < 120; i++) {
      if (await this.eval(() => document.readyState === "complete")) break;
      await uyu(250);
    }
    let bulundu = false;
    for (let i = 0; i < 60; i++) {
      if (await this.eval((s) => !!document.querySelector(s), selector)) {
        bulundu = true;
        break;
      }
      await uyu(300);
    }
    if (!bulundu && bekleZorunlu) {
      throw new Error(`Selector sayfada bulunamadı: ${selector} — ${url}`);
    }
    await uyu(300);
    return bulundu;
  }
  async ssDataUrl() {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    return `data:image/png;base64,${r.data}`;
  }
  async tus(key, code, keyCode) {
    for (const type of ["keyDown", "keyUp"]) {
      await this.gonder("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    }
  }
}

/* ══════════════════════ Sayfa içi ölçüm parçaları ══════════════════════ */

/** Metnin GLYPH kutularını ve ön plan rengini okur (element kutusu değil). */
const metinBilgisi = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return { hata: `bulunamadı: ${selector}` };
  const metin = el.textContent.trim();
  if (!metin) return { hata: "ölçülen öğenin metni boş" };

  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
  if (!rects.length) return { hata: "glyph kutusu ölçülemedi (görünmez metin?)" };

  const st = getComputedStyle(el);
  const px = Number.parseFloat(st.fontSize);
  const kalin = Number.parseInt(st.fontWeight, 10) >= 700;
  return {
    metinIcerik: metin,
    fgCss: st.color,
    fontPx: px,
    kalin,
    buyukMetinMi: px >= 24 || (kalin && px >= 18.66),
    rects,
    innerWidth: window.innerWidth,
  };
};

const metniGizle = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return { hata: "öğe yok" };
  const onceki = { color: el.style.color, fill: el.style.webkitTextFillColor };
  el.style.color = "transparent";
  el.style.webkitTextFillColor = "transparent";
  return { onceki };
};

const metniGoster = (selector, onceki) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  el.style.color = onceki.color ?? "";
  el.style.webkitTextFillColor = onceki.fill ?? "";
  return true;
};

const odakOlc = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return { hata: `odak ölçümü: bulunamadı ${selector}` };
  el.focus();
  const st = getComputedStyle(el);
  return { focusVisible: el.matches(":focus-visible"), boxShadow: st.boxShadow, outline: `${st.outlineStyle} ${st.outlineWidth} ${st.outlineColor}` };
};

/**
 * Madde B: link'in metinden renkle DEĞİL, kalıcı alt çizgiyle de ayrıştığını
 * GERÇEK tarayıcıda doğrular. jsdom'da bu ölçülemez — Tailwind'in ürettiği
 * CSS jsdom'a hiç yüklenmez, `className` dizisinde "underline" görmek onun
 * GERÇEKTEN uygulandığını KANITLAMAZ (ör. `hover:underline` yazılsaydı sınıf
 * adı yine "underline" içerirdi, ama varsayılan durumda çizgi olmazdı).
 */
const dekorasyonBilgisi = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return { hata: `dekorasyon ölçümü: bulunamadı ${selector}` };
  const st = getComputedStyle(el);
  return { textDecorationLine: st.textDecorationLine, textDecorationColor: st.textDecorationColor };
};

/** Ekran görüntüsünün KOMPOZİT piksellerinden en kötü kontrastı bulur (ip_c1 ile aynı yöntem). */
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
  const olcek = c.width / window.innerWidth;
  const fg = rgba(fgCss);

  let enKotu = null;
  let ornek = 0;
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
        if (!enKotu || k < enKotu.kontrast) enKotu = { kontrast: k, zemin: zemin.map(Math.round) };
      }
    }
  }
  if (!ornek) return { hata: "hiç örnek alınamadı" };
  return {
    enKotuKontrast: enKotu.kontrast,
    enKotuZemin: `rgb(${enKotu.zemin.join(", ")})`,
    ornekSayisi: ornek,
    esik,
    gecti: enKotu.kontrast >= esik,
  };
};

async function olcumYap(sayfa, selector) {
  const bilgi = await sayfa.eval(metinBilgisi, selector);
  if (bilgi.hata) throw new Error(`metin bilgisi (${selector}): ${bilgi.hata}`);

  const gizle = await sayfa.eval(metniGizle, selector);
  if (gizle.hata) throw new Error(`metni gizleme: ${gizle.hata}`);
  let olcum;
  try {
    await sayfa.eval(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const dataUrl = await sayfa.ssDataUrl();
    olcum = await sayfa.eval(pikselOrnekle, { dataUrl, rects: bilgi.rects, fgCss: bilgi.fgCss, adim: ORNEK_ADIMI_CSS, esik: ESIK });
  } finally {
    await sayfa.eval(metniGoster, selector, gizle.onceki);
  }
  if (olcum.hata) throw new Error(`piksel örnekleme (${selector}): ${olcum.hata}`);
  return { metinIcerik: bilgi.metinIcerik, onRenk: bilgi.fgCss, fontPx: bilgi.fontPx, buyukMetinMi: bilgi.buyukMetinMi, glyphKutuSayisi: bilgi.rects.length, ...olcum };
}

async function temaAyarla(sayfa, url, selector, koyu) {
  await sayfa.eval((k) => {
    localStorage.setItem("adana-theme", JSON.stringify({ state: { preference: k ? "dark" : "light" }, version: 0 }));
    return true;
  }, koyu);
  await sayfa.git(url, selector);
}

async function viewportIle(vp, dpr, is, ekBayraklar) {
  const c = await chromeBaslat(vp, dpr, ekBayraklar);
  let ws;
  try {
    ws = new WebSocket(c.hedef.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    const sayfa = new Sayfa(ws);
    await sayfa.gonder("Page.enable");
    await sayfa.gonder("Runtime.enable");
    await sayfa.gonder("Network.enable");
    // ÖLÇÜLDÜ: `GET /duyuru-seridi/aktif` `Cache-Control: public, max-age=60`
    // taşıyor (public uç sözleşmesi — kasıtlı) ve Chrome bunu aynı origin'e
    // yapılan art arda navigasyonlarda TEKRAR KULLANIYOR: script varyantı
    // PATCH'lese bile ikinci sayfa yüklemesi 60 sn boyunca ESKİ gövdeyi
    // gösteriyordu (ilk koşuda 8/8 "geçti" ama hepsi YANLIŞLIKLA aynı
    // varyantı ölçtü — sessiz yanlış pozitif). Ölçüm oturumunda önbellek
    // KAPALI: gerçek kullanıcı deneyimini DEĞİL, her varyantı GERÇEKTEN
    // ölçmeyi hedefliyoruz.
    await sayfa.gonder("Network.setCacheDisabled", { cacheDisabled: true });
    // HER navigasyondan önce, sayfanın kendi JS'inden ÖNCE çalışır — CLS
    // gözlemcisi ilk boyamadan itibaren kayıt tutabilsin diye (bkz. clsOku).
    await sayfa.gonder("Page.addScriptToEvaluateOnNewDocument", { source: CLS_BOOTSTRAP });
    await sayfa.gonder("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: dpr, mobile: false });
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

/* ══════════════════════ Backend yardımcıları (varyant değiştirme) ══════════════════════ */

async function varyantAyarla(varyant) {
  if (!DUYURU_ID || !ADMIN_TOKEN) {
    throw new Error("--duyuru-id ve --admin-token zorunlu (seed edilmiş aktif duyuru satırı gerekir)");
  }
  const r = await fetch(`${API_BASE}/admin/duyuru-seridi/${DUYURU_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ varyant }),
  });
  if (!r.ok) throw new Error(`varyant ayarlanamadı (${r.status}): ${await r.text()}`);
}

/* ══════════════════════ CLS ölçümü ══════════════════════ */

/**
 * ÖLÇÜLDÜ: `layout-shift` girdileri `performance.getEntriesByType` ile
 * GERİYE DÖNÜK okunamıyor (Chromium bu türü yalnız AKTİF bir
 * `PerformanceObserver` varken timeline'a yazıyor — `paint`/`resource`in
 * aksine "buffered" değil). Bu yüzden gözlemci `Page.addScriptToEvaluateOnNewDocument`
 * ile HER navigasyondan önce enjekte edilir (uygulamanın kendi JS'inden
 * ÖNCE çalışır ki ilk boyamadaki kaymalar da kaçmasın) ve girdiler
 * `window.__clsGirdileri`ye toplanır.
 */
const CLS_BOOTSTRAP = `
  window.__clsGirdileri = [];
  try {
    new PerformanceObserver((list) => {
      window.__clsGirdileri.push(...list.getEntries());
    }).observe({ type: "layout-shift", buffered: true });
  } catch (e) {
    window.__clsGozlemciHatasi = String(e);
  }
`;

const clsOku = () => {
  if (window.__clsGozlemciHatasi) return { hata: window.__clsGozlemciHatasi };
  const girdiler = window.__clsGirdileri ?? [];
  const toplam = girdiler.filter((g) => !g.hadRecentInput).reduce((s, g) => s + g.value, 0);
  return { cls: +toplam.toFixed(4), girdiSayisi: girdiler.length };
};

/** Negatif kontrol: sahte 300px'lik bir blok ekler → gerçek, kalıcı bir kayma üretir. */
const yapayKaymaUret = () => {
  const el = document.createElement("div");
  el.style.height = "300px";
  el.style.background = "red";
  el.setAttribute("data-yapay-kayma", "");
  document.body.prepend(el);
  return true;
};

async function clsOlcCalistir(sayfa, url, { gecikmeMs } = {}) {
  // Tema BİLEREK ayarlanmıyor: about:blank'ten localStorage'a dokunmak
  // SecurityError verir (opak köken) ve CLS renk değil YERLEŞİM ölçer —
  // varsayılan (açık) temada koşmak sonucu etkilemez.
  if (gecikmeMs) {
    // Yalnız /duyuru-seridi/aktif isteğine gecikme — CDP Fetch domain'i tek
    // istek türünü hedefleyebilir; burada basitlik için TÜM ağ throttle edilir
    // (worst-case senaryo: yavaş bağlantıda sayfanın GERÇEKTEN nasıl
    // davrandığı — yalnız tek bir XHR'ı yapay geciktirmekten daha dürüst bir
    // ölçüm, çünkü gerçek yavaş bağlantıda navbar/logo da birlikte gecikir).
    await sayfa.gonder("Network.emulateNetworkConditions", {
      offline: false,
      latency: gecikmeMs,
      downloadThroughput: 500 * 1024,
      uploadThroughput: 500 * 1024,
    });
  } else {
    await sayfa.gonder("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }

  const t0 = Date.now();
  await sayfa.gonder("Page.navigate", { url });
  for (let i = 0; i < 200; i++) {
    if (await sayfa.eval(() => document.readyState === "complete")) break;
    await uyu(100);
  }
  const readyMs = Date.now() - t0;

  // ÖLÇÜLDÜ: sabit bir bekleme (ör. gecikme×2+500ms) throttle altında YETMEDİ
  // — 1500ms gecikmede şerit gerçekte ~10 sn'de geliyordu, script 3.5 sn
  // bekleyip "sahnede değil, CLS=0" diye YANLIŞ raporluyordu (sessiz yanlış
  // negatif). Sabit bekleme yerine POLL: şerit gelene ya da tavana (20 sn)
  // çarpana kadar. Tavan throttle testinde de gerçekçi bir üst sınırdır —
  // web-vitals'ın kendi INP/LCP "iyi" eşikleri de saniyeler mertebesindedir,
  // sonsuza kadar beklemek gerçek kullanıcı deneyimini temsil etmez.
  const TAVAN_MS = 20000;
  let seritMs = null;
  while (Date.now() - t0 < TAVAN_MS) {
    if (await sayfa.eval((s) => !!document.querySelector(s), SELECTOR)) {
      seritMs = Date.now() - t0;
      break;
    }
    await uyu(300);
  }
  // Şerit belirdikten sonra da bir kare payı bırak — kaymanın kendisi
  // ölçülene kadar (layout-shift entry'si asenkron gelebilir).
  await uyu(500);

  const sonuc = await sayfa.eval(clsOku);
  const seritVarMi = await sayfa.eval((s) => !!document.querySelector(s), SELECTOR);
  const tavaniAsti = seritMs === null && !seritVarMi;
  // Düzeltme turu (madde D-ek): tavan aşıldığında `cls` "gerçekten ölçüldü ve
  // sıfır çıktı" ile karışıyordu — oysa şerit hiç gelmediği için asıl kayma
  // GÖZLEMLENEMEDİ, sıfır DEĞİL BİLİNMİYOR. `null` yazılır ki sonraki okuyucu
  // tabloyu "bu koşulda kayma yok" diye yanlış okumasın.
  return { ...sonuc, cls: tavaniAsti ? null : sonuc.cls, seritVarMi, readyMs, seritMs, tavaniAsti };
}

/* ══════════════════════ --selftest ══════════════════════ */

async function selftest() {
  const basarisiz = [];
  const not = (ad, gecti, detay) => {
    console.log(`  ${gecti ? "✓" : "✗"} ${ad} — ${detay}`);
    if (!gecti) basarisiz.push(ad);
  };

  await viewportIle(VIEWPORT, DPR, async (sayfa) => {
    // Sunucu bağımsız statik bir sayfa: negatif kontroller İÇİN gerçek app
    // gerekmez, yalnız Chrome + CDP mekaniğinin KENDİSİ test edilir.
    const html =
      "data:text/html," +
      encodeURIComponent(
        `<!doctype html><html><body style="margin:0">
          <div role="region" aria-label="Duyuru" style="background:#fff;padding:8px">
            <span data-duyuru-metin style="color:#ffffff">AYNI RENK METİN</span>
          </div>
        </body></html>`
      );
    await sayfa.git(html, '[data-duyuru-metin]');

    // S-1: beyaz metin / beyaz zemin → eşiği KESİNLİKLE geçmemeli.
    const olcum = await olcumYap(sayfa, '[data-duyuru-metin]');
    not("S-1 aynı renk metin/zemin → eşik GEÇMEMELİ", olcum.gecti === false, `kontrast ${olcum.enKotuKontrast} (eşik ${ESIK})`);

    // S-2: bozuk selector → açık hatayla patlamalı.
    let patladi = false;
    try {
      await olcumYap(sayfa, "[data-yok-boyle-bir-sey]");
    } catch (e) {
      patladi = true;
      not("S-2 bozuk selector → açık mesajla patlar", true, String(e.message).split("\n")[0]);
    }
    if (!patladi) not("S-2 bozuk selector → açık mesajla patlar", false, "PATLAMADI");

    // S-3 (CLS): yapay kayma üretimi GERÇEKTEN pozitif bir CLS okumalı —
    // aletin "her zaman 0 okuyup sessizce geçer" olmadığının kanıtı.
    const destek = await sayfa.eval(() => (typeof PerformanceObserver !== "undefined" ? PerformanceObserver.supportedEntryTypes : []));
    not("S-3a tarayıcı layout-shift'i destekliyor", destek.includes("layout-shift"), `supportedEntryTypes=${JSON.stringify(destek)}`);

    const oncekiCls = await sayfa.eval(clsOku);
    await sayfa.eval(yapayKaymaUret);
    // Chromium kaymayı bir sonraki render karesinde işler; birkaç kare bekle.
    await sayfa.eval(() => new Promise((r) => { let n = 0; const tur = () => (++n >= 6 ? r() : requestAnimationFrame(tur)); requestAnimationFrame(tur); }));
    await uyu(500);
    const sonrakiCls = await sayfa.eval(clsOku);
    const fark = sonrakiCls.cls - oncekiCls.cls;
    not("S-3b yapay kayma → CLS ÖLÇÜLEBİLİR ARTIŞ üretir", fark > 0, `önce ${oncekiCls.cls}, sonra ${sonrakiCls.cls} (Δ${fark.toFixed(4)}, girdi ${oncekiCls.girdiSayisi}→${sonrakiCls.girdiSayisi})`);

    // S-6 (madde B): text-decoration:none taşıyan bir link'i dekorasyonBilgisi
    // GERÇEKTEN "none" olarak okumalı — kontrolün kendisi kör olmasın diye.
    const linkHtml =
      "data:text/html," +
      encodeURIComponent(`<!doctype html><html><body>
        <a href="#" data-duyuru-link style="text-decoration:none;color:#000">cizgisiz link</a>
      </body></html>`);
    await sayfa.git(linkHtml, "[data-duyuru-link]");
    const dekor = await sayfa.eval(dekorasyonBilgisi, "[data-duyuru-link]");
    not(
      "S-6 alt çizgisiz link → dekorasyonBilgisi GERÇEKTEN 'none' okur",
      dekor.textDecorationLine === "none",
      `okunan: "${dekor.textDecorationLine}"`
    );
  });

  // S-4/S-5 (madde A): saf fonksiyon — tarayıcı gerekmez. Sahte (uydurma)
  // ölçüm kayıtlarıyla, gerçek hatanın YAŞANDIĞI şekli birebir taklit eder:
  // dikkat__acik/koyu bilgi'nin rengini "ölçmüş" gibi davranır.
  const sahteIhlalliSonuc = {
    bilgi__acik__metin: { enKotuZemin: "rgb(26, 54, 93)" },
    bilgi__koyu__metin: { enKotuZemin: "rgb(138, 176, 222)" },
    dikkat__acik__metin: { enKotuZemin: "rgb(26, 54, 93)" }, // ← İHLAL: bilgi ile aynı
    dikkat__koyu__metin: { enKotuZemin: "rgb(26, 54, 93)" },
    bilgi__acik__link: { enKotuZemin: "rgb(26, 54, 93)" },
    bilgi__koyu__link: { enKotuZemin: "rgb(138, 176, 222)" },
    dikkat__acik__link: { enKotuZemin: "rgb(246, 173, 85)" },
    dikkat__koyu__link: { enKotuZemin: "rgb(246, 173, 85)" },
  };
  let s4Patladi = false;
  let s4Mesaj = "";
  try {
    negatifKontrolleriDogrula(sahteIhlalliSonuc);
  } catch (e) {
    s4Patladi = true;
    s4Mesaj = String(e.message).split("\n")[0];
  }
  not("S-4 varyant ihlali (dikkat bilgi'nin rengini taşıyor) → PATLAR", s4Patladi, s4Mesaj || "PATLAMADI — sessizce geçti");

  const sahteTemaIhlalliSonuc = {
    bilgi__acik__metin: { enKotuZemin: "rgb(26, 54, 93)" },
    bilgi__koyu__metin: { enKotuZemin: "rgb(26, 54, 93)" }, // ← İHLAL: açık ile aynı
    dikkat__acik__metin: { enKotuZemin: "rgb(246, 173, 85)" },
    dikkat__koyu__metin: { enKotuZemin: "rgb(246, 173, 85)" },
    bilgi__acik__link: { enKotuZemin: "rgb(26, 54, 93)" },
    bilgi__koyu__link: { enKotuZemin: "rgb(26, 54, 93)" }, // ← İHLAL
    dikkat__acik__link: { enKotuZemin: "rgb(246, 173, 85)" },
    dikkat__koyu__link: { enKotuZemin: "rgb(246, 173, 85)" },
  };
  let s5Patladi = false;
  let s5Mesaj = "";
  try {
    negatifKontrolleriDogrula(sahteTemaIhlalliSonuc);
  } catch (e) {
    s5Patladi = true;
    s5Mesaj = String(e.message).split("\n")[0];
  }
  not("S-5 tema ihlali (bilgi açık/koyu aynı) → PATLAR", s5Patladi, s5Mesaj || "PATLAMADI — sessizce geçti");

  // S-4b/S-5b: aynı fonksiyon, İHLALSİZ (gerçek son ölçümün şekli) girdide
  // SESSİZCE geçmeli — yoksa kontrol her zaman patlayan, hiç ayırt etmeyen
  // bir alarm olurdu (ters prova).
  const sahteTemizSonuc = {
    bilgi__acik__metin: { enKotuZemin: "rgb(26, 54, 93)" },
    bilgi__koyu__metin: { enKotuZemin: "rgb(138, 176, 222)" },
    dikkat__acik__metin: { enKotuZemin: "rgb(246, 173, 85)" },
    dikkat__koyu__metin: { enKotuZemin: "rgb(246, 173, 85)" },
    bilgi__acik__link: { enKotuZemin: "rgb(26, 54, 93)" },
    bilgi__koyu__link: { enKotuZemin: "rgb(138, 176, 222)" },
    dikkat__acik__link: { enKotuZemin: "rgb(246, 173, 85)" },
    dikkat__koyu__link: { enKotuZemin: "rgb(246, 173, 85)" },
  };
  let s4bPatladi = false;
  try {
    negatifKontrolleriDogrula(sahteTemizSonuc);
  } catch (e) {
    s4bPatladi = true;
  }
  not("S-4b/S-5b gerçekçi İHLALSİZ girdide sessizce GEÇER (ters prova)", !s4bPatladi, s4bPatladi ? "yanlışlıkla patladı" : "geçti");

  console.log(`\nSELFTEST: ${basarisiz.length ? `BAŞARISIZ (${basarisiz.join(", ")})` : "TAMAM"}`);
  return basarisiz.length ? 1 : 0;
}

/* ══════════════════════ negatif kontroller: temanın/varyantın GERÇEKTEN uygulandığı ══════════════════════ */

/**
 * ÖLÇÜLDÜ (düzeltme turu, madde A): `Network.setCacheDisabled` yalnız API
 * yanıtının HTTP önbelleğini çözer — temanın veya varyantın SAYFAYA
 * GERÇEKTEN uygulandığını KANITLAMAZ. İlk koşuda tam olarak bu ikinci hata
 * sınıfı yaşandı: 8 kombinasyonun 4'ü (dikkat__açık/koyu × metin/link)
 * birebir aynı zemin RGB'sini (`rgb(26, 54, 93)` — aslında BİLGİ'nin rengi)
 * ölçtü ve kapı yine de "8/8 geçti" dedi, çünkü kapı yalnız KONTRAST ORANINA
 * bakıyor, hangi rengin ölçüldüğüne değil.
 *
 * Bu fonksiyon iki bilinen-doğru değişmezi zorlar:
 *   1. Varyant değişmezi: `bilgi` ve `dikkat` HER İKİ temada da FARKLI zemin
 *      rengi taşımalı (Ç-3: #1A365D/#8AB0DE vs #F6AD55).
 *   2. Tema değişmezi: yalnız `bilgi` varyantında — açık/koyu FARKLI zemin
 *      taşımalı (#1A365D → #8AB0DE). `dikkat` varyantında BİLEREK
 *      SINANMAZ: Ç-3 kararı gereği #F6AD55 iki temada da AYNIDIR (aksan
 *      değil, doğrudan zemin) — bu değişmezi orada zorlamak, doğru
 *      tasarım kararını hatalıymış gibi raporlardı.
 *
 * İhlal → throw (main() bunu yakalayıp exit 1 yapar). Sessiz geçiş YOK.
 */
function negatifKontrolleriDogrula(sonuc) {
  const zemin = (varyant, tema, hedef) => sonuc[`${varyant}__${tema}__${hedef}`]?.enKotuZemin;

  for (const tema of TEMALAR.map((t) => t.ad)) {
    for (const hedef of HEDEFLER.map((h) => h.ad)) {
      const b = zemin("bilgi", tema, hedef);
      const d = zemin("dikkat", tema, hedef);
      if (b === undefined || d === undefined) continue; // hata kaydı zaten kapıda yakalanır
      if (b === d) {
        throw new Error(
          `NEGATİF KONTROL İHLALİ (varyant): bilgi__${tema}__${hedef} ve dikkat__${tema}__${hedef} ` +
            `AYNI zemini ölçtü (${b}). Varyant PATCH'i sayfaya GERÇEKTEN yansımamış olabilir ` +
            `(önbellek, staleTime, ya da yanlış satır ölçülüyor).`
        );
      }
    }
  }

  for (const hedef of HEDEFLER.map((h) => h.ad)) {
    const acik = zemin("bilgi", "acik", hedef);
    const koyu = zemin("bilgi", "koyu", hedef);
    if (acik === undefined || koyu === undefined) continue;
    if (acik === koyu) {
      throw new Error(
        `NEGATİF KONTROL İHLALİ (tema): bilgi__acik__${hedef} ve bilgi__koyu__${hedef} AYNI zemini ` +
          `ölçtü (${acik}). Tema localStorage'a yazılmış ama sayfaya GERÇEKTEN yansımamış olabilir.`
      );
    }
  }

  console.log("  ✓ negatif kontroller: varyant ve tema zemin RGB'yi GERÇEKTEN değiştiriyor");
}

/* ══════════════════════ kapı ══════════════════════ */

export function kapiSonucu(sonuc, beklenen) {
  const kayitlar = Object.entries(sonuc);
  const hatalar = kayitlar.filter(([, o]) => o && o.hata).map(([k]) => k);
  const gecen = kayitlar.filter(([, o]) => o && o.gecti === true).length;
  const kalan = kayitlar.filter(([, o]) => o && o.gecti === false).map(([k]) => k);
  const mesajlar = [];
  if (hatalar.length) mesajlar.push(`HATA KAYDI: ${hatalar.join(", ")}`);
  if (gecen !== beklenen) mesajlar.push(`KAPSAM EKSİK: ${gecen}/${beklenen} kombinasyon eşiği geçti`);
  if (kalan.length) mesajlar.push(`EŞİK ALTI: ${kalan.join(", ")}`);
  return { kod: mesajlar.length ? 1 : 0, gecen, beklenen, mesajlar };
}

/* ══════════════════════ ana akış ══════════════════════ */

async function main() {
  mkdirSync(OUT, { recursive: true });

  if (SELFTEST) {
    process.exitCode = await selftest();
    return;
  }

  const sonuc = {};

  await viewportIle(VIEWPORT, DPR, async (sayfa) => {
    for (const varyant of VARYANTLAR) {
      await varyantAyarla(varyant);
      for (const tema of TEMALAR) {
        for (const h of HEDEFLER) {
          const key = `${varyant}__${tema.ad}__${h.ad}`;
          const bulunduMu = await sayfa.git(`${FRONTEND}/`, h.selector, { bekleZorunlu: false });
          if (!bulunduMu) {
            // Link hedefi, link_url/link_metni boşsa hiç render edilmez — bu
            // BEKLENEN bir "hata değil, ölçülemedi" durumu (14 numaralı test
            // aynı davranışı DOM düzeyinde kontrol ediyor). Seed satırında
            // link daima dolu tutulmalı; boşsa burada gürültülü uyarılır.
            console.warn(`  [uyarı] ${key}: selector bulunamadı (${h.selector}) — seed satırında link eksik olabilir`);
            sonuc[key] = { hata: `selector bulunamadı: ${h.selector}` };
            continue;
          }
          await temaAyarla(sayfa, `${FRONTEND}/`, h.selector, tema.koyu);
          sonuc[key] = await olcumYap(sayfa, h.selector);
          await sayfa.tus("Tab", "Tab", 9);
          await uyu(200);
          sonuc[key].odak = await sayfa.eval(odakOlc, h.selector);
          if (h.ad === "link") {
            // Madde B: link her zaman (hover'sız) kalıcı alt çizgi taşımalı.
            const dekor = await sayfa.eval(dekorasyonBilgisi, h.selector);
            if (dekor.hata) throw new Error(`dekorasyon (${key}): ${dekor.hata}`);
            sonuc[key].dekorasyon = dekor;
            if (dekor.textDecorationLine !== "underline") {
              throw new Error(
                `MADDE B İHLALİ: ${key} linkinin hesaplanmış \`text-decoration-line\` değeri ` +
                  `"${dekor.textDecorationLine}" — "underline" DEĞİL. Link renkle hiç ayrışmıyor demektir.`
              );
            }
          }
          // Ham RGB'ler HER ZAMAN yazılır — yalnız oran değil. Oran, iki farklı
          // kombinasyonun aynı pikseli ölçtüğü bir hatayı GİZLER (madde A).
          console.log(
            `${key}  kontrast=${sonuc[key].enKotuKontrast} gecti=${sonuc[key].gecti} ` +
              `zemin(ham)=${sonuc[key].enKotuZemin} metin(ham)=${sonuc[key].onRenk} ` +
              `ornek=${sonuc[key].ornekSayisi}` +
              (sonuc[key].dekorasyon ? ` alt-cizgi=${sonuc[key].dekorasyon.textDecorationLine}` : "")
          );
        }
      }
    }
  });

  // Madde A: varyant/tema GERÇEKTEN uygulanmış mı — sessizce geçme, patla.
  negatifKontrolleriDogrula(sonuc);

  writeFileSync(join(OUT, "kontrast.json"), JSON.stringify(sonuc, null, 2));

  const kapi = kapiSonucu(sonuc, BEKLENEN_KOMBINASYON);
  console.log(`\nKAPI (kontrast): ${kapi.gecen}/${kapi.beklenen} kombinasyon eşiği geçti`);
  for (const m of kapi.mesajlar) console.error(`  ✗ ${m}`);

  // ── CLS (madde D) ──
  //
  // Her ağ koşulu için AYNI tarayıcı profilinde (dolayısıyla AYNI
  // `localStorage`) İKİ ardışık navigasyon yapılır:
  //   1. İLK ZİYARET — önbellek boş, `lib/duyuruCache::oku()` `undefined`
  //      döner, davranış DÜZELTME ÖNCESİYLE AYNI (iyimser render yok).
  //   2. TEKRAR ZİYARET — ilk ziyaretin GERÇEK yanıtı `useAktifDuyuru`'nun
  //      `useEffect`'i tarafından önbelleğe yazılmış olmalı; ikinci
  //      navigasyon o önbellekten İYİMSER render eder.
  // İkisi AYRI raporlanır — "CLS iyileşti" iddiası yalnız tekrar ziyaret
  // için doğrudur, ilk ziyaret İYİLEŞMEZ (kapatılamaz yer tutucu Ç-2/test
  // 12 tarafından yasaklı — bkz. rapor madde D).
  const clsSonuc = {};
  const KOSULLAR = [
    { ad: "hizli", secenek: {} },
    { ad: "yavas_1500ms", secenek: { gecikmeMs: 1500 } },
    { ad: "yavas_4000ms", secenek: { gecikmeMs: 4000 } },
  ];
  for (const kosul of KOSULLAR) {
    await viewportIle(VIEWPORT, DPR, async (sayfa) => {
      const ilk = await clsOlcCalistir(sayfa, `${FRONTEND}/`, kosul.secenek);
      const tekrar = await clsOlcCalistir(sayfa, `${FRONTEND}/`, kosul.secenek);
      clsSonuc[kosul.ad] = { ilkZiyaret: ilk, tekrarZiyaret: tekrar };
    });
  }
  writeFileSync(join(OUT, "cls.json"), JSON.stringify(clsSonuc, null, 2));
  console.log("\n── CLS ÖLÇÜMÜ (ilk ziyaret / tekrar ziyaret) ──");
  for (const [ad, { ilkZiyaret: i, tekrarZiyaret: t }] of Object.entries(clsSonuc)) {
    const satir = (etiket, o) =>
      `  ${etiket}: CLS=${o.cls} (${o.girdiSayisi} kayma girdisi, şerit sahnede=${o.seritVarMi}, ` +
      `readyState ${o.readyMs}ms, şerit ${o.seritMs ?? `20000+ms (TAVANI AŞTI)`})`;
    console.log(`${ad}:`);
    console.log(satir("ilk ziyaret   ", i));
    console.log(satir("tekrar ziyaret", t));
  }

  process.exitCode = kapi.kod;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
