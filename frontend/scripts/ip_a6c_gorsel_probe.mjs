// İP-A6c · Görev 6 — iki görsel kusurun gerçek tarayıcı ölçümü (Chrome + CDP).
//
// Ölçülen:
//   6a — hata mesajının kontrastı, İKİ temada (WCAG 2.x bağıl parlaklık).
//        Denetim `rose-600` için açık temada 4,70 ölçmüştü — eşiğin 0,20
//        üstünde ve 12 px metinde. `rose-700`ün marjı burada ölçülür.
//   6b — `<input type="number">`ın `color-scheme` hesaplanmış değeri ve
//        ekran görüntüsü; onarımlı/onarımsız alan yan yana basılır.
//
// GERÇEK VERİ KULLANILMAZ — sonda kendi sayfasını açar, hiçbir sunucuya
// bağlanmaz (canlı `ceyhandb`ye bağlanmak İP-A1'de bir kez yaşandı, tekrarı yok).
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/ip_a6c_gorsel_probe.mjs --frontend http://127.0.0.1:5199
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] ?? "1"]);
    return acc;
  }, [])
);
const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5199";
const OUT = resolve(ARGS.out ?? "../docs/ip-a6c");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9281);

async function chromeBaslat() {
  const profil = join(OUT, "a6c-profil");
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
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
}


/** Hata doğurmak için miktarı geçersiz yapar (anlık doğrulama). */
const hataDogur = () => {
  const g = document.querySelector('[data-sonda="onarimli"]');
  const set = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  set.call(g, "0");
  g.dispatchEvent(new Event("input", { bubbles: true }));
};

const temaKur = (koyu) => {
  document.documentElement.classList.toggle("dark", koyu);
  return document.documentElement.className;
};

const olc = () => {
  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const kanal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const parlaklik = (p) =>
    0.2126 * kanal(p[0]) + 0.7152 * kanal(p[1]) + 0.0722 * kanal(p[2]);
  const oran = (on, arka) => {
    const a = parlaklik(on) + 0.05;
    const b = parlaklik(arka) + 0.05;
    return +(Math.max(a, b) / Math.min(a, b)).toFixed(2);
  };
  const arkaPlan = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const p = rgb(getComputedStyle(n).backgroundColor);
      if (p.length >= 3 && (p.length < 4 || p[3] > 0)) return p.slice(0, 3);
    }
    return [255, 255, 255];
  };
  const olcMetin = (el) => {
    if (!el) return null;
    const st = getComputedStyle(el);
    const px = parseFloat(st.fontSize);
    const kalin = parseInt(st.fontWeight, 10) >= 700;
    const buyuk = px >= 24 || (kalin && px >= 18.66);
    const esik = buyuk ? 3 : 4.5;
    const k = oran(rgb(st.color).slice(0, 3), arkaPlan(el));
    return {
      metin: (el.textContent || "").trim().slice(0, 40),
      renk: st.color,
      arkaPlan: `rgb(${arkaPlan(el).join(", ")})`,
      fontPx: px,
      kontrast: k,
      esik,
      gecti: k >= esik,
    };
  };
  const sema = (sec) => {
    const el = document.querySelector(sec);
    return el ? getComputedStyle(el).colorScheme : null;
  };
  return {
    tema: document.documentElement.classList.contains("dark") ? "koyu" : "acik",
    hata: olcMetin(document.querySelector("p[role='alert']")),
    colorScheme: {
      onarimli: sema('[data-sonda="onarimli"]'),
      onarimsiz: sema('[data-sonda="onarimsiz"]'),
    },
  };
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

  await s.git(`${FRONTEND}/scripts/probe/a6c-probe.html`);
  await new Promise((r) => setTimeout(r, 2000));
  await s.eval(hataDogur);
  await new Promise((r) => setTimeout(r, 800));

  await s.eval(temaKur, false);
  await new Promise((r) => setTimeout(r, 400));
  const acik = await s.eval(olc);
  await s.ss(join(OUT, "a6c-acik.png"));

  await s.eval(temaKur, true);
  await new Promise((r) => setTimeout(r, 400));
  const koyu = await s.eval(olc);
  await s.ss(join(OUT, "a6c-koyu.png"));

  const rapor = { acik, koyu };
  writeFileSync(join(OUT, "gorsel-olcum.json"), JSON.stringify(rapor, null, 2));
  console.log(JSON.stringify(rapor, null, 2));

  const sorunlar = [];
  // Ölçümün kendi geçerlilik kapısı: hata metni doğmadıysa iddia boşta kalır.
  if (!acik.hata || !koyu.hata) sorunlar.push("hata metni hiç doğmadı — ölçüm geçersiz");
  if (acik.hata?.arkaPlan === koyu.hata?.arkaPlan)
    sorunlar.push("tema hiç değişmedi — ölçüm geçersiz");
  if (acik.hata && !acik.hata.gecti)
    sorunlar.push(`açık temada hata kontrastı ${acik.hata.kontrast} < ${acik.hata.esik}`);
  if (koyu.hata && !koyu.hata.gecti)
    sorunlar.push(`koyu temada hata kontrastı ${koyu.hata.kontrast} < ${koyu.hata.esik}`);
  // 6a'nın asıl amacı marjı rahatlatmaktı: 4,70'e geri düşmek onarımın
  // sessizce geri alınması demektir.
  if (acik.hata && acik.hata.kontrast < 5.5)
    sorunlar.push(`açık tema marjı hâlâ dar: ${acik.hata.kontrast}`);
  if (koyu.colorScheme.onarimli !== "dark")
    sorunlar.push(`koyu temada onarımlı alanın color-scheme'i "${koyu.colorScheme.onarimli}"`);
  if (acik.colorScheme.onarimli === "dark")
    sorunlar.push("açık temada da koyu şema uygulanmış (kör çekiç)");

  if (sorunlar.length) {
    console.error(["SORUN:"].concat(sorunlar).join(String.fromCharCode(10) + "- "));
    process.exit(2);
  }
  console.log("İP-A6c görsel ölçümü: SORUN YOK.");
  process.exit(0);
} finally {
  chrome.kill();
}
