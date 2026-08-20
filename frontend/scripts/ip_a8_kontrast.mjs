// İP-A8 · Görev 6 — kontrast + `color-scheme` sondası (Chrome + ham CDP).
//
// Ölçülen:
//   1. BEŞ düğme varyantının metin kontrastı — iki temada (B-8).
//   2. BEŞ rozet tonunun metin kontrastı — iki temada (alfa kompozisyonlu:
//      koyu temanın saydam (alfa) rozetleri, atadan hesaplanmalıdır).
//   3. Yerel widget'ların `color-scheme` değeri — `.input` sınıflı ve
//      sınıfsız, koyu temada (B-9 / SK-6).
//   4. `.input` odak göstergesi (gerçek `:focus-visible`) — B-11.
//
// GERÇEK VERİ KULLANILMAZ: sonda sayfası hiçbir sunucuya bağlanmaz.
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/ip_a8_kontrast.mjs --frontend http://127.0.0.1:5199
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] ?? "1"]);
    return acc;
  }, [])
);
const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5199";
const OUT = resolve(ARGS.out ?? "../docs/ip-a8");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9281);

async function chromeBaslat() {
  // Profil OUT ALTINDA DEGIL: `docs/` bir kanit dizinidir; Chrome'un
  // calisma dizinini oraya yazmak depoya sizardi.
  const profil = join(tmpdir(), "a8-kontrast-profil");
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
  for (let i = 0; i < 100; i++) {
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
    await new Promise((r) => setTimeout(r, 600));
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
  async tus(key, code, keyCode) {
    for (const type of ["keyDown", "keyUp"]) {
      await this.gonder("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    }
  }
}

/**
 * Sayfa içi ölçüm.
 *
 * Zemin ALFA KOMPOZİSYONUYLA hesaplanır: koyu temanın rozet zeminleri
 * saydamdır (alfa kanallı) ve saydam bir katmanı "yok sayıp" ataya atlamak yanlış
 * bir oran üretir (A7d4 · AK-3'ün sınıfı). Katmanlar opak bir zemine kadar
 * toplanır ve `over` operatörüyle birleştirilir.
 */
const olc = () => {
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
  /** Opak zemine kadar katmanları topla, sonra `over` ile birleştir. */
  const zemin = (el) => {
    const katmanlar = [];
    for (let n = el; n; n = n.parentElement) {
      const p = rgba(getComputedStyle(n).backgroundColor);
      if (p[3] > 0) {
        katmanlar.push(p);
        if (p[3] >= 1) break;
      }
    }
    if (!katmanlar.length) return [255, 255, 255];
    let sonuc = katmanlar[katmanlar.length - 1].slice(0, 3);
    for (let i = katmanlar.length - 2; i >= 0; i--) {
      const [r, g, b, a] = katmanlar[i];
      sonuc = [
        r * a + sonuc[0] * (1 - a),
        g * a + sonuc[1] * (1 - a),
        b * a + sonuc[2] * (1 - a),
      ];
    }
    return sonuc.map((v) => Math.round(v));
  };
  const olcMetin = (el, ad) => {
    const st = getComputedStyle(el);
    const on = rgba(st.color).slice(0, 3);
    const arka = zemin(el);
    const px = parseFloat(st.fontSize);
    const kalin = parseInt(st.fontWeight, 10) >= 700;
    const buyuk = px >= 24 || (kalin && px >= 18.66);
    const esik = buyuk ? 3 : 4.5;
    const k = oran(on, arka);
    return {
      ad,
      onPlan: `rgb(${on.join(", ")})`,
      zemin: `rgb(${arka.join(", ")})`,
      fontPx: px,
      kalin,
      kontrast: k,
      esik,
      gecti: k >= esik,
    };
  };

  const dugmeler = [...document.querySelectorAll("[data-varyant]")].map((el) =>
    olcMetin(el, `dugme:${el.getAttribute("data-varyant")}`)
  );
  const rozetler = [...document.querySelectorAll("[data-ton] > span")].map((el) =>
    olcMetin(el, `rozet:${el.parentElement.getAttribute("data-ton")}`)
  );
  const widgetlar = [...document.querySelectorAll("[data-widget]")].map((el) => ({
    ad: el.getAttribute("data-widget"),
    colorScheme: getComputedStyle(el).colorScheme,
  }));

  return {
    tema: document.documentElement.classList.contains("dark") ? "koyu" : "acik",
    kokColorScheme: getComputedStyle(document.documentElement).colorScheme,
    dugmeler,
    rozetler,
    widgetlar,
  };
};

/** Gerçek `:focus-visible` altında `.input` odak göstergesi. */
const odakOlc = () => {
  const rgba = (s) => {
    const p = (s.match(/[\d.]+/g) || []).map(Number);
    return p.length === 3 ? [p[0], p[1], p[2], 1] : p.length >= 4 ? p : [0, 0, 0, 0];
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
  const el = document.querySelector("[data-odak]");
  const st = getComputedStyle(el);
  const sayfaZemin = rgba(getComputedStyle(document.body).backgroundColor).slice(0, 3);
  return {
    odaklandiMi: document.activeElement === el,
    focusVisible: el.matches(":focus-visible"),
    kenarlik: st.borderTopColor,
    kenarlikKontrast: oran(rgba(st.borderTopColor).slice(0, 3), sayfaZemin),
    boxShadow: st.boxShadow,
  };
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const chrome = await chromeBaslat();
  try {
    const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const hedef = hedefler.find((t) => t.type === "page");
    const ws = new WebSocket(hedef.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    const sayfa = new Sayfa(ws);
    await sayfa.gonder("Page.enable");
    await sayfa.gonder("Runtime.enable");

    const sonuc = {};
    for (const koyu of [0, 1]) {
      await sayfa.git(`${FRONTEND}/scripts/probe/a8-probe.html?koyu=${koyu}`);
      const tema = koyu ? "koyu" : "acik";
      sonuc[tema] = await sayfa.eval(olc);
      await sayfa.ss(join(OUT, `kontrast-${tema}.png`));

      // Odak: gerçek Tab tuşuyla — `:focus-visible` ancak klavyeyle açılır.
      await sayfa.eval(() => {
        document.querySelector("[data-widget='select-ciplak']").focus();
        return true;
      });
      await sayfa.tus("Tab", "Tab", 9);
      // `.input` bir `transition` taşıyor: hemen ölçmek geçiş ARASI bir renk
      // okur (ilk turda tam bunu ölçtük — slate-200 ile indigo arası bir ara
      // değer). Geçişin bitmesi beklenir.
      await new Promise((r) => setTimeout(r, 800));
      sonuc[tema].odak = await sayfa.eval(odakOlc);
    }

    writeFileSync(join(OUT, "kontrast.json"), JSON.stringify(sonuc, null, 2));

    let kalan = 0;
    for (const tema of ["acik", "koyu"]) {
      console.log(`\n── ${tema.toUpperCase()} TEMA ──  kök color-scheme: ${sonuc[tema].kokColorScheme}`);
      for (const o of [...sonuc[tema].dugmeler, ...sonuc[tema].rozetler]) {
        if (!o.gecti) kalan += 1;
        console.log(
          `  ${o.gecti ? "✓" : "✗"} ${o.ad.padEnd(20)} ${String(o.kontrast).padStart(6)}  (eşik ${o.esik}, ${o.fontPx}px)  ${o.onPlan} / ${o.zemin}`
        );
      }
      for (const w of sonuc[tema].widgetlar) {
        console.log(`    widget ${w.ad.padEnd(16)} color-scheme=${w.colorScheme}`);
      }
      const f = sonuc[tema].odak;
      console.log(
        `    odak: odaklandi=${f.odaklandiMi} focus-visible=${f.focusVisible} kenarlık=${f.kenarlik} kontrast=${f.kenarlikKontrast}`
      );
    }
    console.log(`\nEŞİK ALTI KALAN: ${kalan}`);
    ws.close();
    process.exitCode = kalan === 0 ? 0 : 1;
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
