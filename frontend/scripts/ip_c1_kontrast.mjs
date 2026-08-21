// İP-C1 — karşılıklı hero banner kontrast sondası (Chrome + ham CDP).
//
// İki banner'ı GERÇEK sayfada (Landing "/", Mağaza "/magaza") 1280 ve 380
// genişlikte, açık ve koyu temada ölçer. Metnin arkasındaki zemin CSS
// backgroundColor'dan DEĞİL — gerçek <img>'in görüntülenen (object-fit:cover
// kırpılmış) piksellerinden okunur: metin kutusu içindeki bir piksel ızgarası
// natural-image koordinatına çevrilip canvas'tan örneklenir, en KÖTÜ (en düşük
// kontrastlı) piksel raporlanır — ortalama değil.
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/ip_c1_kontrast.mjs --frontend http://127.0.0.1:5199
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] ?? "1"]);
    return acc;
  }, [])
);
const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5199";
const OUT = resolve(ARGS.out ?? "../docs/ip-c1");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

async function chromeBaslat(width, height) {
  const PORT = 9200 + Math.floor(Math.random() * 500);
  const profil = join(tmpdir(), `c1-kontrast-profil-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
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
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return { process: p, port: PORT };
    } catch {
      /* bekle */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  p.kill();
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
  async git(url, selector) {
    await this.gonder("Page.navigate", { url });
    for (let i = 0; i < 120; i++) {
      if (await this.eval(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    // Lazy-loaded route chunks (React.lazy + Suspense) mean the target
    // selector can take much longer than "readyState complete" to mount —
    // poll for it instead of a fixed delay (a fixed delay under-waited on
    // the first cold navigation of a lazy chunk and over-waited afterward).
    if (selector) {
      for (let i = 0; i < 60; i++) {
        if (await this.eval((s) => !!document.querySelector(s), selector)) break;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
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

/**
 * Sayfa-içi ölçüm fonksiyonu. `selector` banner'ın <a> köküdür; içindeki
 * <img> (arka plan) ve `[data-hero-text] > span` yerine `[data-hero-text]`
 * bizzat metni taşıyan span'dir (component'te tek span var, doğrudan odur —
 * "yanlış öğe" riskine karşı textContent uzunluğu ve img referansı da
 * raporlanır).
 */
const olc = (selector) => {
  const rgba = (s) => {
    const p = (s.match(/[\d.]+/g) || []).map(Number);
    if (p.length === 3) return [p[0], p[1], p[2], 1];
    return p.length >= 4 ? p : [0, 0, 0, 0];
  };
  const kanal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const parlaklik = (p) => 0.2126 * kanal(p[0]) + 0.7152 * kanal(p[1]) + 0.0722 * kanal(p[2]);
  const oran = (on, arka) => {
    const a = parlaklik(on) + 0.05;
    const b = parlaklik(arka) + 0.05;
    return +(Math.max(a, b) / Math.min(a, b)).toFixed(2);
  };
  /** fg üstüne bg'yi (rgba) alpha-composite eder → opak rgb döner. */
  const over = (fg, bgRgba) => {
    const a = bgRgba[3];
    return [
      bgRgba[0] * a + fg[0] * (1 - a),
      bgRgba[1] * a + fg[1] * (1 - a),
      bgRgba[2] * a + fg[2] * (1 - a),
    ];
  };

  const link = document.querySelector(selector);
  if (!link) return { hata: `bulunamadı: ${selector}` };
  const img = link.querySelector("img");
  const textEl = link.querySelector("[data-hero-text]");
  if (!img || !textEl) return { hata: "img veya data-hero-text yok" };
  if (!img.complete || !img.naturalWidth) return { hata: "görsel henüz yüklenmedi" };

  const metinIcerik = textEl.textContent.trim();
  if (!metinIcerik) return { hata: "ölçülen öğenin metni boş — yanlış öğe olabilir" };

  const st = getComputedStyle(textEl);
  const onRenk = rgba(st.color).slice(0, 3);
  const scrimRgba = rgba(st.backgroundColor); // metnin KENDİ arka planı (scrim), alpha dahil

  const imgRect = img.getBoundingClientRect();
  const textRect = textEl.getBoundingClientRect();

  // object-fit: cover eşlemesi (görüntülenen kutu → natural piksel).
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  const scale = Math.max(imgRect.width / naturalW, imgRect.height / naturalH);
  const scaledW = naturalW * scale;
  const scaledH = naturalH * scale;
  const offX = (scaledW - imgRect.width) / 2;
  const offY = (scaledH - imgRect.height) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const GRID = 10;
  let worst = null;
  const tx0 = textRect.left - imgRect.left;
  const ty0 = textRect.top - imgRect.top;
  for (let gy = 0; gy <= GRID; gy++) {
    for (let gx = 0; gx <= GRID; gx++) {
      const dx = tx0 + (textRect.width * gx) / GRID;
      const dy = ty0 + (textRect.height * gy) / GRID;
      const natXScaled = dx * scale + offX;
      const natYScaled = dy * scale + offY;
      const nx = Math.min(naturalW - 1, Math.max(0, Math.round(natXScaled / scale)));
      const ny = Math.min(naturalH - 1, Math.max(0, Math.round(natYScaled / scale)));
      const pixel = ctx.getImageData(nx, ny, 1, 1).data;
      const imgRgb = [pixel[0], pixel[1], pixel[2]];
      const zemin = over(imgRgb, scrimRgba);
      const k = oran(onRenk, zemin);
      if (!worst || k < worst.kontrast) {
        worst = { kontrast: k, zemin: zemin.map(Math.round), nx, ny };
      }
    }
  }

  const px = parseFloat(st.fontSize);
  const kalin = parseInt(st.fontWeight, 10) >= 700;
  const buyuk = px >= 24 || (kalin && px >= 18.66);

  const sonuc = {
    metinIcerik,
    onRenk: `rgb(${onRenk.join(", ")})`,
    scrimBg: st.backgroundColor,
    fontPx: px,
    kalin,
    buyukMetinMi: buyuk,
    enKotuKontrast: worst.kontrast,
    enKotuZemin: `rgb(${worst.zemin.join(", ")})`,
    enKotuPiksel: { nx: worst.nx, ny: worst.ny },
    esik: 4.5,
    gecti: worst.kontrast >= 4.5,
    imgRect: { w: Math.round(imgRect.width), h: Math.round(imgRect.height) },
    naturalSize: { w: naturalW, h: naturalH },
  };

  return sonuc;
};

/**
 * Odak halkası ölçümü — GERÇEK `:focus-visible` altında. Programatik
 * `element.focus()` tek başına Chromium'da `:focus-visible` eşleşmesini
 * garanti ETMEZ (ilk turda bunu ölçtük: `boxShadow` hep "none" döndü).
 * Sayfanın "son girdi modalitesi"ni klavyeye çevirmek için önce gerçek bir
 * Tab tuşu gönderilir (page-level, `main()`de `sayfa.tus` ile), SONRA bu
 * fonksiyon focus() çağırır — bu sırada `:focus-visible` gerçekten eşleşir.
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const targets = [
    { path: "/", selector: 'a[aria-label="Mağazaya git"]', ad: "landing-magaza-banner" },
    { path: "/magaza", selector: 'a[aria-label="Özel ders eğitmenlerine git"]', ad: "magaza-ozelders-banner" },
  ];
  const viewports = [
    { w: 1280, h: 1000, ad: "1280" },
    { w: 380, h: 900, ad: "380" },
  ];

  const sonuc = {};
  for (const vp of viewports) {
    const { process: chromeProc, port: PORT } = await chromeBaslat(vp.w, vp.h);
    try {
      const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const hedef = hedefler.find((t) => t.type === "page");
      const ws = new WebSocket(hedef.webSocketDebuggerUrl);
      await new Promise((r) => ws.addEventListener("open", r, { once: true }));
      const sayfa = new Sayfa(ws);
      await sayfa.gonder("Page.enable");
      await sayfa.gonder("Runtime.enable");
      await sayfa.gonder("Emulation.setDeviceMetricsOverride", {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: 1,
        mobile: vp.w < 500,
      });

      for (const koyu of [0, 1]) {
        for (const t of targets) {
          const key = `${t.ad}__vp${vp.ad}__${koyu ? "koyu" : "acik"}`;
          const url = `${FRONTEND}${t.path}`;
          await sayfa.git(url, t.selector);
          if (koyu) {
            await sayfa.eval(() => {
              localStorage.setItem("adana-theme", JSON.stringify({ state: { preference: "dark" }, version: 0 }));
              return true;
            });
            await sayfa.git(url, t.selector);
          }
          let olcumSonuc = await sayfa.eval(olc, t.selector);
          for (let i = 0; i < 15 && olcumSonuc.hata; i++) {
            await new Promise((r) => setTimeout(r, 300));
            olcumSonuc = await sayfa.eval(olc, t.selector);
          }
          // Odak halkası: sayfanın "son girdi modalitesi"ni klavyeye çevirmek
          // için gerçek bir Tab tuşu gönderilir, SONRA focus() çağrılır.
          await sayfa.tus("Tab", "Tab", 9);
          await new Promise((r) => setTimeout(r, 300));
          olcumSonuc.odak = await sayfa.eval(odakOlc, t.selector);
          sonuc[key] = olcumSonuc;
          await sayfa.ss(join(OUT, `${key}__vp${vp.ad}.png`));
          console.log(key, JSON.stringify(olcumSonuc));
        }
      }
      ws.close();
    } finally {
      chromeProc.kill();
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  writeFileSync(join(OUT, "kontrast.json"), JSON.stringify(sonuc, null, 2));
  const kalan = Object.values(sonuc).filter((o) => o.gecti === false).length;
  console.log(`\nEŞİK ALTI KALAN: ${kalan}`);
  process.exitCode = kalan === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
