// İP-A2 · Tek slot piksel sondası (Chrome + CDP).
//
// "hint → hata geçişinde yerleşim zıplamıyor" iddiası jsdom'da ÖLÇÜLEMEZ
// (düzen motoru yok). Bu sonda gerçek Chrome'da alanın kabının yüksekliğini
// ve altındaki komşunun Y konumunu iki durumda da okur.
//
// Kullanım (frontend/): npm run dev -- --port 5199   ve ardından
//                       node scripts/ip_a2_slot_probe.mjs --frontend http://127.0.0.1:5199
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
const OUT = resolve(ARGS.out ?? "../docs/ip-a2");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9261);

async function chromeBaslat() {
  const profil = join(OUT, "slot-profil");
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
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return p;
    } catch { /* bekle */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Chrome DevTools portu açılmadı");
}

class Sayfa {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.bekleyen = new Map();
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
        if (this.bekleyen.has(id)) { this.bekleyen.delete(id); red(new Error(`CDP zaman aşımı: ${method}`)); }
      }, 60000);
    });
  }
  async eval(fn, ...args) {
    const ifade = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`;
    const r = await this.gonder("Runtime.evaluate", {
      expression: `(async () => { return ${ifade}; })()`,
      awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`Sayfa içi hata: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
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

const olc = () => {
  const kap = document.getElementById("olculen");
  const slot = document.querySelector("[data-form-slot]");
  const komsu = document.getElementById("alt-komsu");
  return {
    kapYuksekligi: kap.getBoundingClientRect().height,
    slotYuksekligi: slot.getBoundingClientRect().height,
    komsuY: komsu.getBoundingClientRect().top,
    slotMetni: (slot.textContent || "").trim(),
    slotDugumu: slot.getAttribute("data-form-slot") !== null,
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

  await s.git(`${FRONTEND}/scripts/probe/form-probe.html`);
  await new Promise((r) => setTimeout(r, 1500));

  const once = await s.eval(olc);
  await s.ss(join(OUT, "slot-hint.png"));

  // Alanı kirletip boşalt: hata doğar.
  await s.eval(() => {
    // `Form.Control` çocuğun `id`sini kendi ürettiğiyle EZER; bu yüzden
    // sabit bir id ile değil, kapsam içinden seçilir.
    const g = document.querySelector("#olculen input");
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(g, "x");
    g.dispatchEvent(new Event("input", { bubbles: true }));
    set.call(g, "");
    g.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 800));

  const sonra = await s.eval(olc);
  await s.ss(join(OUT, "slot-hata.png"));

  const rapor = {
    once, sonra,
    kapFarkiPx: +(sonra.kapYuksekligi - once.kapYuksekligi).toFixed(3),
    komsuKaymasiPx: +(sonra.komsuY - once.komsuY).toFixed(3),
  };
  writeFileSync(join(OUT, "slot-piksel.json"), JSON.stringify(rapor, null, 2));
  console.log(JSON.stringify(rapor, null, 2));

  if (!sonra.slotMetni || sonra.slotMetni === once.slotMetni) {
    console.error("HATA: hata durumu hiç oluşmadı — ölçüm geçersiz.");
    process.exit(1);
  }
  process.exit(rapor.kapFarkiPx === 0 && rapor.komsuKaymasiPx === 0 ? 0 : 2);
} finally {
  chrome.kill();
}
