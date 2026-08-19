// İP-A3a · Karanlık mod paritesi sondası (Chrome + CDP).
//
// İP-A2'nin bilinen sınırlarından biri: "`Form.*` sınıfları `dark:`
// karşılıklarını taşıyor ama ekran görüntüsüyle karşılaştırılmadı."
// Bu sonda o boşluğu ÖLÇÜMLE kapatır — göz kararıyla değil.
//
// Ölçülen üç şey:
//   1. Etiket / hint / hata metinlerinin arka planına göre KONTRAST ORANI
//      (WCAG 2.x formülü; eşik: normal metin 4.5, büyük metin 3.0)
//   2. Hata kırmızısının koyu zeminde okunabilirliği (aynı ölçüm, hata metni)
//   3. Slot yüksekliklerinin iki temada da AYNI olması
//
// GERÇEK VERİ KULLANILMAZ: sonda `damage-probe.html`'i açar, hiçbir sunucuya
// bağlanmaz. (İP-A1 turu canlı `ceyhandb`'ye bağlanmış ve ekran görüntüleri
// gerçek müşteri verisi içermişti; bu tekrarlanmadı.)
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/ip_a3a_karanlik_probe.mjs --frontend http://127.0.0.1:5199
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
const OUT = resolve(ARGS.out ?? "../docs/ip-a3a");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9271);

async function chromeBaslat() {
  const profil = join(OUT, "karanlik-profil");
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

/** Hata doğurmak için miktara geçersiz değer yazar (anlık doğrulama). */
const hataDogur = () => {
  const g = document.querySelector('input[type="number"]');
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

/**
 * Sayfa içi ölçüm. Kontrast WCAG 2.x bağıl parlaklık formülüyle hesaplanır;
 * arka plan, saydam olmayan ilk ataya kadar yürünerek bulunur (metnin kendi
 * arka planı çoğu zaman `transparent`tır).
 */
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
    const on = rgb(st.color).slice(0, 3);
    const arka = arkaPlan(el);
    const px = parseFloat(st.fontSize);
    const kalin = parseInt(st.fontWeight, 10) >= 700;
    // WCAG "büyük metin": >=24px, veya kalınsa >=18.66px.
    const buyuk = px >= 24 || (kalin && px >= 18.66);
    const esik = buyuk ? 3 : 4.5;
    const k = oran(on, arka);
    return {
      metin: (el.textContent || "").trim().slice(0, 40),
      renk: st.color,
      arkaPlan: `rgb(${arka.join(", ")})`,
      fontPx: px,
      kontrast: k,
      esik,
      gecti: k >= esik,
    };
  };

  const panel = document.querySelector('[role="dialog"]');
  const etiketler = [...panel.querySelectorAll("label")].filter((l) => l.htmlFor);
  const hint = panel.querySelector("[data-form-slot] p:not([role='alert'])");
  const hata = panel.querySelector("[data-form-slot] p[role='alert']");
  const slotlar = [...panel.querySelectorAll("[data-form-slot]")].map(
    (s) => +s.getBoundingClientRect().height.toFixed(2)
  );

  return {
    tema: document.documentElement.classList.contains("dark") ? "koyu" : "acik",
    panelArkaPlan: getComputedStyle(panel).backgroundColor,
    etiketSayisi: etiketler.length,
    etiket: olcMetin(etiketler[0]),
    hint: olcMetin(hint),
    hata: olcMetin(hata),
    slotlar,
    panelYuksekligi: +panel.getBoundingClientRect().height.toFixed(2),
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

  await s.git(`${FRONTEND}/damage-probe.html`);
  await new Promise((r) => setTimeout(r, 2000));

  await s.eval(hataDogur);
  await new Promise((r) => setTimeout(r, 800));

  await s.eval(temaKur, false);
  await new Promise((r) => setTimeout(r, 400));
  const acik = await s.eval(olc);
  await s.ss(join(OUT, "damage-acik.png"));

  await s.eval(temaKur, true);
  await new Promise((r) => setTimeout(r, 400));
  const koyu = await s.eval(olc);
  await s.ss(join(OUT, "damage-koyu.png"));

  const slotFarki =
    acik.slotlar.length === koyu.slotlar.length
      ? acik.slotlar.map((v, i) => +(koyu.slotlar[i] - v).toFixed(2))
      : null;

  const rapor = {
    acik,
    koyu,
    slotFarki,
    panelYuksekligiFarkiPx: +(koyu.panelYuksekligi - acik.panelYuksekligi).toFixed(2),
  };
  writeFileSync(join(OUT, "karanlik-mod.json"), JSON.stringify(rapor, null, 2));
  console.log(JSON.stringify(rapor, null, 2));

  // Ölçümün kendi geçerlilik kapısı: hata metni gerçekten doğmadıysa
  // "hata kırmızısı koyu zeminde okunuyor" iddiası boşta kalırdı.
  const sorunlar = [];
  if (!acik.hata || !koyu.hata) sorunlar.push("hata metni hiç doğmadı — ölçüm geçersiz");
  if (!acik.hint || !koyu.hint) sorunlar.push("hint metni bulunamadı — ölçüm geçersiz");
  if (acik.panelArkaPlan === koyu.panelArkaPlan)
    sorunlar.push("tema hiç değişmedi — ölçüm geçersiz");
  for (const [ad, o] of [
    ["etiket", acik.etiket],
    ["hint", acik.hint],
    ["hata", acik.hata],
  ]) {
    if (o && !o.gecti) sorunlar.push(`açık temada ${ad} kontrastı ${o.kontrast} < ${o.esik}`);
  }
  for (const [ad, o] of [
    ["etiket", koyu.etiket],
    ["hint", koyu.hint],
    ["hata", koyu.hata],
  ]) {
    if (o && !o.gecti) sorunlar.push(`koyu temada ${ad} kontrastı ${o.kontrast} < ${o.esik}`);
  }
  if (slotFarki && slotFarki.some((d) => d !== 0))
    sorunlar.push(`slot yükseklikleri farklı: ${slotFarki}`);

  if (sorunlar.length) {
    console.error("SORUN:\n- " + sorunlar.join("\n- "));
    process.exit(2);
  }
  console.log("Karanlık mod paritesi: SORUN YOK.");
  process.exit(0);
} finally {
  chrome.kill();
}
