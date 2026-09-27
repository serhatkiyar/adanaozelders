// İP-A7d1 · Görev 5 — göç eden üç ekranın gerçek tarayıcı turu (Chrome + CDP).
//
// Ölçülen (hepsi jsdom'da ölçülemez):
//   T1  mobil kart düzeni (380 px): taşma yok, kart tıklanabilir, kart içindeki
//       aksiyon düğmesi satırı AÇMIYOR (Görev 1 kararının gerçek hâli)
//   T2  odak tuzağı: gerçek Tab/Shift+Tab pencereden çıkmıyor, ESC kapatıyor,
//       odak açan düğmeye iade ediliyor
//   T3  gönderim sonrası odak ilk hatalı alana taşınıyor (gerçek klavye)
//   T4  hata kırmızısının kontrastı (A6c: 4,70 → 6,29)
//   T5  sayı girdisinin koyu temadaki `color-scheme` değeri (A6c ekledi)
//
// GERÇEK VERİ KULLANILMAZ: sonda sayfası axios adapter'ını sahte sunucuyla
// değiştirir, hiçbir arka uca bağlanmaz (canlı `ceyhandb`ye bağlanmak
// İP-A1'de bir kez yaşandı; tekrarı yok).
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/ip_a7d1_tur.mjs --frontend http://127.0.0.1:5199
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
const OUT = resolve(ARGS.out ?? "../docs/arsiv/ip-a/ip-a7d1");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9291);

async function chromeBaslat() {
  const profil = join(OUT, "tur-profil");
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
    await new Promise((r) => setTimeout(r, 1200));
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
    const ortak = { key, windowsVirtualKeyCode: opts.code ?? 0, ...opts.mods };
    await this.gonder("Input.dispatchKeyEvent", { type: "rawKeyDown", ...ortak });
    await this.gonder("Input.dispatchKeyEvent", { type: "keyUp", ...ortak });
    await new Promise((r) => setTimeout(r, 120));
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
}

/* ── Sayfa içi ölçüm fonksiyonları ── */

const kontrastOlc = () => {
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
  const el = document.querySelector("[role='alert']");
  if (!el) return null;
  const st = getComputedStyle(el);
  const k = oran(rgb(st.color).slice(0, 3), arkaPlan(el));
  return {
    metin: (el.textContent || "").trim().slice(0, 60),
    renk: st.color,
    fontPx: parseFloat(st.fontSize),
    kontrast: k,
    esik: 4.5,
    gecti: k >= 4.5,
  };
};

const colorSchemeOlc = () =>
  Array.from(document.querySelectorAll('input[type="number"]')).map((el) => ({
    ad: el.getAttribute("aria-label") || el.id,
    colorScheme: getComputedStyle(el).colorScheme,
  }));

/** Mobil kartın ölçüleri + taşma kontrolü. */
const mobilKartOlc = () => {
  const kap = document.querySelector("[data-mobil-satirlar]");
  if (!kap) return { hata: "mobil kart bölümü yok" };
  const kart = kap.children[0];
  const acici = kart.querySelector("button[aria-labelledby]");
  const aksiyonlar = Array.from(kart.querySelectorAll("button")).filter(
    (b) => b !== acici
  );
  return {
    kartSayisi: kap.children.length,
    kartGenisligi: Math.round(kart.getBoundingClientRect().width),
    govdeGenisligi: document.body.clientWidth,
    yatayTasma: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    aciciVar: !!acici,
    aciciAdi: acici ? (acici.getAttribute("aria-labelledby") ? "kart içeriğinden" : "yok") : "yok",
    aciciKapliyor:
      acici &&
      Math.round(acici.getBoundingClientRect().width) ===
        Math.round(kart.getBoundingClientRect().width),
    icIceButon: kap.querySelectorAll("button button").length,
    aksiyonEtiketleri: aksiyonlar.map((b) => b.textContent.trim()).slice(0, 3),
    aksiyonYuksekligi: aksiyonlar[0]
      ? Math.round(aksiyonlar[0].getBoundingClientRect().height)
      : null,
  };
};

/** Kart içindeki aksiyona tıkla: satır AÇILMAMALI. */
const kartAksiyonuTikla = () => {
  const kap = document.querySelector("[data-mobil-satirlar]");
  const kart = kap.children[0];
  const acici = kart.querySelector("button[aria-labelledby]");
  const aksiyon = Array.from(kart.querySelectorAll("button")).find((b) => b !== acici);
  if (!aksiyon) return { hata: "kartta aksiyon yok" };
  aksiyon.click();
  return { basilan: aksiyon.textContent.trim() };
};

const pencereVarMi = () => {
  const p = document.querySelector('[role="dialog"], [role="alertdialog"]');
  return p ? { baslik: (p.querySelector("h2")?.textContent ?? "").trim() } : null;
};

const odaklanan = () => {
  const el = document.activeElement;
  if (!el) return null;
  return {
    etiket: el.tagName.toLowerCase(),
    tip: el.getAttribute("type"),
    ad: el.getAttribute("aria-label") || el.id || (el.textContent || "").trim().slice(0, 30),
    ariaInvalid: el.getAttribute("aria-invalid"),
    pencereIcinde: !!el.closest('[role="dialog"]'),
  };
};

/* ── Tur ── */

const sonuc = { olculdu: new Date().toISOString(), ekranlar: {} };
let hataliAdim = 0;

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

  for (const [ekran, ad] of [
    ["a", "kutuphane-editoru"],
    ["b", "rezervasyonlar"],
    ["c", "denetim-kayitlari"],
  ]) {
    sonuc.ekranlar[ad] = {};
    for (const koyu of [0, 1]) {
      for (const genislik of [1280, 380]) {
        await s.genislik(genislik);
        await s.git(`${FRONTEND}/scripts/probe/a7d1-probe.html?ekran=${ekran}&koyu=${koyu}`);
        const anahtar = `${koyu ? "koyu" : "acik"}-${genislik}`;
        const olcum = {
          tema: await s.eval(() =>
            document.documentElement.classList.contains("dark") ? "koyu" : "acik"
          ),
          yatayTasma: await s.eval(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth
          ),
        };
        if (ekran !== "a" && genislik === 380) {
          Object.assign(olcum, { mobilKart: await s.eval(mobilKartOlc) });
        }
        if (ekran === "a") {
          olcum.colorScheme = await s.eval(colorSchemeOlc);
        }
        sonuc.ekranlar[ad][anahtar] = olcum;
        await s.ss(join(OUT, `${ad}-${anahtar}.png`));
      }
    }
  }

  /* ── T1a: Görev 1'in kararı — satır tıklaması VE aksiyon BİR ARADA ── */
  //
  // Göç eden üç ekranın hiçbiri ikisini aynı anda istemiyor; karar ortak
  // katmanda verildiği için sentetik ama GERÇEK `DataTable` ile ölçülür.
  for (const koyu of [0, 1]) {
    await s.genislik(380);
    await s.git(`${FRONTEND}/scripts/probe/a7d1-probe.html?ekran=d&koyu=${koyu}`);
    const tema = koyu ? "koyu" : "acik";
    const olcum = await s.eval(mobilKartOlc);
    // 1) Aksiyona bas: satır AÇILMAMALI.
    await s.eval(() => {
      const kart = document.querySelector("[data-mobil-satirlar]").children[0];
      const acici = kart.querySelector("button[aria-labelledby]");
      Array.from(kart.querySelectorAll("button")).find((b) => b !== acici).click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const aksiyonSonrasi = await s.eval(
      () => document.querySelector('[data-sonda="gunluk"]').textContent.trim()
    );
    // 2) Kartın METNİNE bas: satır AÇILMALI.
    await s.eval(() => {
      const kart = document.querySelector("[data-mobil-satirlar]").children[0];
      kart.querySelector("p").click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const metinSonrasi = await s.eval(
      () => document.querySelector('[data-sonda="gunluk"]').textContent.trim()
    );
    sonuc.cakisma = sonuc.cakisma ?? {};
    sonuc.cakisma[tema] = { olcum, aksiyonSonrasi, metinSonrasi };
    await s.ss(join(OUT, `cakisma-${tema}-380.png`));
    if (olcum.icIceButon !== 0) hataliAdim++;
    if (aksiyonSonrasi !== "aksiyon:1") hataliAdim++;
    if (metinSonrasi !== "aksiyon:1 satir:1") hataliAdim++;
  }
  await s.genislik(1280);
  await s.git(`${FRONTEND}/scripts/probe/a7d1-probe.html?ekran=d&koyu=0`);
  await s.ss(join(OUT, "cakisma-acik-1280.png"));

  /* ── T1b: mobil kartta aksiyon satırı AÇMIYOR (gerçek tıklama) ── */
  await s.genislik(380);
  await s.git(`${FRONTEND}/scripts/probe/a7d1-probe.html?ekran=b&koyu=0`);
  const oncePencere = await s.eval(pencereVarMi);
  const basildi = await s.eval(kartAksiyonuTikla);
  await new Promise((r) => setTimeout(r, 600));
  const sonraPencere = await s.eval(pencereVarMi);
  sonuc.satirAksiyonu = {
    oncePencere,
    basildi,
    sonraPencere,
    // Aksiyon kendi penceresini açar; satır tıklaması bu ekranda YOKTUR,
    // dolayısıyla ölçülen şey "aksiyon çalıştı ve kart tek buton değil".
    icIceButon: (await s.eval(mobilKartOlc)).icIceButon,
  };
  if (sonuc.satirAksiyonu.icIceButon !== 0) hataliAdim++;

  /* ── T2: odak tuzağı + ESC + odak iadesi (gerçek klavye) ── */
  await s.genislik(1280);
  await s.git(`${FRONTEND}/scripts/probe/a7d1-probe.html?ekran=c&koyu=0`);
  // Pencereyi KLAVYEYLE aç: odak iadesi ancak açan öğe odaklıysa ölçülebilir.
  // (Fareyle bir hücreye tıklandığında odak hiçbir yerde değildir ve iade
  // edilecek bir şey yoktur — bu bir kusur değil, ölçümün sınırıdır.)
  const acanKimlik = await s.eval(() => {
    const satir = document.querySelector("table tbody tr");
    satir.setAttribute("data-acan", "1");
    satir.focus();
    return document.activeElement === satir;
  });
  await s.tus("Enter", { code: 13 });
  await new Promise((r) => setTimeout(r, 600));
  const odakTuzagi = { acildi: await s.eval(pencereVarMi), acanOdakliydi: acanKimlik };
  const gezinti = [];
  for (let i = 0; i < 12; i++) {
    await s.tus("Tab", { code: 9 });
    gezinti.push(await s.eval(odaklanan));
  }
  odakTuzagi.tabDisinaCikti = gezinti.some((g) => g && !g.pencereIcinde);
  await s.tus("Tab", { code: 9, mods: { modifiers: 8 } });
  odakTuzagi.shiftTabPencereIcinde = (await s.eval(odaklanan))?.pencereIcinde ?? false;
  await s.tus("Escape", { code: 27 });
  await new Promise((r) => setTimeout(r, 500));
  odakTuzagi.escKapatti = (await s.eval(pencereVarMi)) === null;
  odakTuzagi.odakIadesi = await s.eval(() => ({
    acanaDondu: document.activeElement?.getAttribute?.("data-acan") === "1",
    etiket: document.activeElement?.tagName?.toLowerCase() ?? null,
  }));
  sonuc.odakTuzagi = odakTuzagi;
  if (odakTuzagi.tabDisinaCikti || !odakTuzagi.escKapatti) hataliAdim++;
  if (!odakTuzagi.odakIadesi.acanaDondu) hataliAdim++;

  /* ── T3 + T4 + T5: gönderim → ilk hatalı alana odak, kontrast, color-scheme ── */
  for (const koyu of [0, 1]) {
    await s.genislik(1280);
    await s.git(`${FRONTEND}/scripts/probe/a7d1-probe.html?ekran=a&koyu=${koyu}`);
    // Ad alanını BOŞALT (şema en az 2 karakter ister) ve gönder.
    await s.eval(() => {
      const alan = Array.from(document.querySelectorAll("input")).find((i) =>
        (document.querySelector(`label[for="${i.id}"]`)?.textContent ?? "").includes(
          "Kütüphane Adı"
        )
      );
      const set = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      set.call(alan, "");
      alan.dispatchEvent(new Event("input", { bubbles: true }));
      alan.blur();
    });
    await new Promise((r) => setTimeout(r, 400));
    await s.eval(() => {
      const dugme = Array.from(document.querySelectorAll("button")).find((b) =>
        ["Ekle", "Güncelle"].includes(b.textContent.trim())
      );
      dugme.click();
    });
    await new Promise((r) => setTimeout(r, 800));
    const tema = koyu ? "koyu" : "acik";
    sonuc.gonderim = sonuc.gonderim ?? {};
    sonuc.gonderim[tema] = {
      odak: await s.eval(odaklanan),
      hata: await s.eval(kontrastOlc),
      colorScheme: await s.eval(colorSchemeOlc),
    };
    await s.ss(join(OUT, `editor-gonderim-${tema}.png`));
  }

  const acikHata = sonuc.gonderim?.acik?.hata;
  if (!acikHata || !acikHata.gecti || acikHata.kontrast < 5.5) hataliAdim++;
  if (sonuc.gonderim?.acik?.odak?.ariaInvalid !== "true") hataliAdim++;
  const koyuSema = (sonuc.gonderim?.koyu?.colorScheme ?? []).map((x) => x.colorScheme);
  if (koyuSema.length === 0 || koyuSema.some((x) => x !== "dark")) hataliAdim++;

  writeFileSync(join(OUT, "tur-olcum.json"), JSON.stringify(sonuc, null, 2));
  console.log(JSON.stringify(sonuc, null, 2));
} finally {
  chrome.kill();
}

if (hataliAdim > 0) {
  console.error(`\nTUR GEÇERSİZ: ${hataliAdim} kapı düştü.`);
  process.exit(2);
}
console.log("\nTur tamam — kapıların hepsi geçti.");
