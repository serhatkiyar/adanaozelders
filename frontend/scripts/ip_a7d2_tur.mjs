// İP-A7d2 · Görev 6 — göç eden ALTI ekranın gerçek tarayıcı turu (Chrome + CDP).
//
// ## Tur derinliği ekrana göre ayrılır (Görev 6'nın öncelik kuralı)
//
//   TAM tur (açık+koyu × 1280+380 + etkileşim ölçümleri):
//     • paketler  — satır tıklaması VE satır aksiyonu bir arada (SK-1/SK-5'in
//                   ilk GERÇEK ekranı; A7d1'de yalnız sentetik sonda vardı)
//     • oturumlar — geniş pencere + tarih/sayı ağırlıklı form
//     • araclar   — on üç alanlı sayısal form (time + number)
//
//   KISA tur (mobil kart + koyu tema):
//     • kataloglar · hakedis · kuryeler — deseni tekrar eden ekranlar
//
// GERÇEK VERİ KULLANILMAZ: sonda sayfası axios adapter'ını sahte sunucuyla
// değiştirir, hiçbir arka uca bağlanmaz.
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/ip_a7d2_tur.mjs --frontend http://127.0.0.1:5199
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
const OUT = resolve(ARGS.out ?? "../docs/ip-a7d2");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9292);

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
    await new Promise((r) => setTimeout(r, 1400));
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
    // `rawKeyDown` odaklanmış bir `<button>`da tıklama ÜRETMEZ (Chrome
    // varsayılan eylemi yalnız metin taşıyan `keyDown`da uygular). A7d1'in
    // sondası `<tr>` üzerinde kendi `onKeyDown`unu dinlediği için fark
    // etmemişti; A7d2'de pencereyi açan şey gerçek bir düğme.
    const metinli = opts.text != null;
    const ortak = { key, windowsVirtualKeyCode: opts.code ?? 0, ...opts.mods };
    await this.gonder("Input.dispatchKeyEvent", {
      type: metinli ? "keyDown" : "rawKeyDown",
      ...(metinli ? { text: opts.text } : {}),
      ...ortak,
    });
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

/** Sayı ve tarih girdilerinin `color-scheme` değeri (A6c düzeltmesi). */
const colorSchemeOlc = () =>
  Array.from(
    document.querySelectorAll(
      'input[type="number"], input[type="time"], input[type="datetime-local"]'
    )
  ).map((el) => ({
    tip: el.getAttribute("type"),
    ad:
      el.getAttribute("aria-label") ||
      (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "").trim() ||
      el.id,
    colorScheme: getComputedStyle(el).colorScheme,
  }));

/** Mobil kartın ölçüleri + taşma kontrolü. */
const mobilKartOlc = () => {
  const kap = document.querySelector("[data-mobil-satirlar]");
  const kok = document.documentElement;
  if (!kap) {
    return {
      mobilKartYok: true,
      govdeGenisligi: document.body.clientWidth,
      yatayTasma: kok.scrollWidth > kok.clientWidth,
    };
  }
  const kart = kap.children[0];
  const acici = kart.querySelector("button[aria-label]");
  const aksiyonlar = Array.from(kart.querySelectorAll("button")).filter((b) => b !== acici);
  return {
    kartSayisi: kap.children.length,
    kartGenisligi: Math.round(kart.getBoundingClientRect().width),
    govdeGenisligi: document.body.clientWidth,
    yatayTasma: kok.scrollWidth > kok.clientWidth,
    aciciVar: !!acici,
    aciciAdi: acici ? acici.getAttribute("aria-label") : null,
    aciciKapliyor:
      !!acici &&
      Math.round(acici.getBoundingClientRect().width) ===
        Math.round(kart.getBoundingClientRect().width),
    icIceButon: kap.querySelectorAll("button button").length,
    aksiyonEtiketleri: aksiyonlar.map((b) => b.textContent.trim()).slice(0, 4),
    enKucukDokunmaHedefi: Math.min(
      ...aksiyonlar.map((b) => Math.round(b.getBoundingClientRect().height)),
      999
    ),
  };
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
    ad:
      el.getAttribute("aria-label") ||
      (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "").trim() ||
      el.id ||
      (el.textContent || "").trim().slice(0, 30),
    ariaInvalid: el.getAttribute("aria-invalid"),
    pencereIcinde: !!el.closest('[role="dialog"]'),
  };
};

/** Adı verilen düğmeye bas. */
const dugmeyeBas = (ad) => {
  const d = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent.trim() === ad
  );
  if (!d) return { hata: `düğme yok: ${ad}` };
  d.click();
  return { basildi: ad };
};

/* ── Tur ── */

const sonuc = { olculdu: new Date().toISOString(), tamTur: {}, kisaTur: {} };
let hataliAdim = 0;
const kapi = (kosul, ad) => {
  if (!kosul) {
    hataliAdim++;
    (sonuc.dusenKapilar = sonuc.dusenKapilar ?? []).push(ad);
  }
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

  const adres = (ekran, koyu) =>
    `${FRONTEND}/scripts/probe/a7d2-probe.html?ekran=${ekran}&koyu=${koyu}`;

  /* ── TAM TUR: üç ekran × iki tema × iki genişlik ── */
  for (const ekran of ["paketler", "oturumlar", "araclar"]) {
    sonuc.tamTur[ekran] = {};
    for (const koyu of [0, 1]) {
      for (const genislik of [1280, 380]) {
        await s.genislik(genislik);
        await s.git(adres(ekran, koyu));
        const anahtar = `${koyu ? "koyu" : "acik"}-${genislik}`;
        const olcum = {
          tema: await s.eval(() =>
            document.documentElement.classList.contains("dark") ? "koyu" : "acik"
          ),
          yatayTasma: await s.eval(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth
          ),
        };
        if (genislik === 380) olcum.mobilKart = await s.eval(mobilKartOlc);
        sonuc.tamTur[ekran][anahtar] = olcum;
        kapi(!olcum.yatayTasma, `${ekran}/${anahtar}: yatay taşma`);
        await s.ss(join(OUT, `${ekran}-${anahtar}.png`));
      }
    }
  }

  /* ── KISA TUR: üç ekran, mobil + koyu ── */
  for (const ekran of ["kataloglar", "hakedis", "kuryeler"]) {
    await s.genislik(380);
    await s.git(adres(ekran, 1));
    const olcum = await s.eval(mobilKartOlc);
    sonuc.kisaTur[ekran] = olcum;
    kapi(!olcum.yatayTasma, `${ekran}/koyu-380: yatay taşma`);
    await s.ss(join(OUT, `${ekran}-koyu-380.png`));
  }

  /* ── T1: SK-1 + SK-5, GERÇEK ekranda (paketler, 380 px) ── */
  for (const koyu of [0, 1]) {
    const tema = koyu ? "koyu" : "acik";
    await s.genislik(380);
    await s.git(adres("paketler", koyu));
    const kart = await s.eval(mobilKartOlc);
    // 1) Satır aksiyonuna bas: satır AÇILMAMALI (detay sayfasına gitmemeli).
    const aksiyonSonrasi = await s.eval(() => {
      const kap = document.querySelector("[data-mobil-satirlar]");
      const k = kap.children[1]; // RETURNED satırı — "Yeniden paketle" taşır
      const acici = k.querySelector("button[aria-label]");
      const aksiyon = Array.from(k.querySelectorAll("button")).find(
        (b) => b !== acici && b.textContent.trim() === "Yeniden paketle"
      );
      if (!aksiyon) return { hata: "aksiyon bulunamadı" };
      aksiyon.click();
      return { basildi: aksiyon.textContent.trim() };
    });
    await new Promise((r) => setTimeout(r, 500));
    const aksiyonDurumu = {
      pencere: await s.eval(pencereVarMi),
      detaydaMi: await s.eval(() => document.body.textContent.includes("PAKET DETAYI")),
    };
    sonuc.satirCakismasi = sonuc.satirCakismasi ?? {};
    sonuc.satirCakismasi[tema] = { kart, aksiyonSonrasi, aksiyonDurumu };
    kapi(kart.icIceButon === 0, `paketler/${tema}: iç içe <button>`);
    kapi(!aksiyonDurumu.detaydaMi, `paketler/${tema}: aksiyon satırı da açtı`);
    kapi(
      !!aksiyonDurumu.pencere,
      `paketler/${tema}: aksiyonun kendi penceresi açılmadı`
    );
    // SK-5: satırı açan görünmez düğmenin adı kartın AKSİYONLARINI içermemeli.
    kapi(
      !!kart.aciciAdi && !/Yeniden paketle|Etiket|Bozuldu/.test(kart.aciciAdi),
      `paketler/${tema}: satırı açan denetimin adı aksiyonları yutuyor (SK-5)`
    );
  }

  /* ── T2: odak tuzağı + ESC + odak iadesi (gerçek klavye, oturum editörü) ── */
  await s.genislik(1280);
  await s.git(adres("oturumlar", 0));
  const acanOdakli = await s.eval(() => {
    const d = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "+ Oturum"
    );
    d.setAttribute("data-acan", "1");
    d.focus();
    return document.activeElement === d;
  });
  await s.tus("Enter", { code: 13, text: String.fromCharCode(13) });
  await new Promise((r) => setTimeout(r, 900));
  const odakTuzagi = { acildi: await s.eval(pencereVarMi), acanOdakliydi: acanOdakli };
  const gezinti = [];
  for (let i = 0; i < 14; i++) {
    await s.tus("Tab", { code: 9 });
    gezinti.push(await s.eval(odaklanan));
  }
  odakTuzagi.tabDisinaCikti = gezinti.some((g) => g && !g.pencereIcinde);
  await s.tus("Tab", { code: 9, mods: { modifiers: 8 } });
  odakTuzagi.shiftTabPencereIcinde = (await s.eval(odaklanan))?.pencereIcinde ?? false;
  await s.tus("Escape", { code: 27 });
  await new Promise((r) => setTimeout(r, 600));
  odakTuzagi.escKapatti = (await s.eval(pencereVarMi)) === null;
  odakTuzagi.odakIadesi = await s.eval(() => ({
    acanaDondu: document.activeElement?.getAttribute?.("data-acan") === "1",
    etiket: document.activeElement?.tagName?.toLowerCase() ?? null,
  }));
  sonuc.odakTuzagi = odakTuzagi;
  kapi(!!odakTuzagi.acildi, "oturum editörü klavyeyle açılmadı");
  kapi(!odakTuzagi.tabDisinaCikti, "odak pencereden çıktı");
  kapi(odakTuzagi.escKapatti, "ESC pencereyi kapatmadı");
  kapi(odakTuzagi.odakIadesi.acanaDondu, "odak açan düğmeye iade edilmedi");

  /* ── T3: KİRLİ formda kapatma önce SORAR (gerçek klavye) ── */
  await s.git(adres("oturumlar", 0));
  await s.eval(dugmeyeBas, "+ Oturum");
  await new Promise((r) => setTimeout(r, 700));
  await s.eval(() => {
    const alan = Array.from(document.querySelectorAll("input")).find((i) =>
      (document.querySelector(`label[for="${i.id}"]`)?.textContent ?? "").includes("Başlık")
    );
    const set = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    set.call(alan, "Sonda başlığı");
    alan.dispatchEvent(new Event("input", { bubbles: true }));
    alan.blur();
  });
  await new Promise((r) => setTimeout(r, 600));
  await s.tus("Escape", { code: 27 });
  await new Promise((r) => setTimeout(r, 700));
  sonuc.kirliKapatma = await s.eval(() => ({
    onaySoruldu: document.body.textContent.includes("Kaydedilmemiş değişiklikler var"),
    editorAyakta: !!document.querySelector('[role="dialog"]'),
  }));
  kapi(sonuc.kirliKapatma.onaySoruldu, "kirli formda kapatma sormadan geçti");
  kapi(sonuc.kirliKapatma.editorAyakta, "onay sorulmadan editör kapandı");
  await s.ss(join(OUT, "oturum-kirli-kapatma.png"));

  /* ── T4 + T5: gönderim → ilk hatalı alana odak · kontrast · color-scheme ── */
  for (const koyu of [0, 1]) {
    const tema = koyu ? "koyu" : "acik";
    await s.genislik(1280);
    await s.git(adres("oturumlar", koyu));
    await s.eval(dugmeyeBas, "+ Oturum");
    await new Promise((r) => setTimeout(r, 700));
    await s.eval(dugmeyeBas, "Ekle");
    await new Promise((r) => setTimeout(r, 900));
    sonuc.gonderim = sonuc.gonderim ?? {};
    sonuc.gonderim[tema] = {
      odak: await s.eval(odaklanan),
      hata: await s.eval(kontrastOlc),
      colorScheme: await s.eval(colorSchemeOlc),
    };
    await s.ss(join(OUT, `oturum-gonderim-${tema}.png`));
  }

  // Sayısal ağırlıklı ikinci ekran: araçlar (number + time bir arada).
  for (const koyu of [0, 1]) {
    const tema = koyu ? "koyu" : "acik";
    await s.genislik(1280);
    await s.git(adres("araclar", koyu));
    await s.eval(dugmeyeBas, "Araç ekle");
    await new Promise((r) => setTimeout(r, 600));
    await s.eval(dugmeyeBas, "Ekle");
    await new Promise((r) => setTimeout(r, 800));
    sonuc.aracGonderim = sonuc.aracGonderim ?? {};
    sonuc.aracGonderim[tema] = {
      odak: await s.eval(odaklanan),
      hata: await s.eval(kontrastOlc),
      colorScheme: await s.eval(colorSchemeOlc),
    };
    await s.ss(join(OUT, `arac-gonderim-${tema}.png`));
  }

  const acikHata = sonuc.gonderim?.acik?.hata;
  kapi(!!acikHata && acikHata.gecti && acikHata.kontrast >= 5.5, "hata kontrastı düşük");
  kapi(sonuc.gonderim?.acik?.odak?.ariaInvalid === "true", "odak ilk hatalı alanda değil");
  kapi(
    sonuc.aracGonderim?.acik?.odak?.ariaInvalid === "true",
    "araç formunda odak ilk hatalı alanda değil"
  );
  for (const [ad, kaynak] of [
    ["oturum", sonuc.gonderim?.koyu?.colorScheme],
    ["arac", sonuc.aracGonderim?.koyu?.colorScheme],
  ]) {
    const semalar = (kaynak ?? []).map((x) => x.colorScheme);
    kapi(
      semalar.length > 0 && semalar.every((x) => x === "dark"),
      `${ad}: koyu temada color-scheme 'dark' değil`
    );
  }

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
