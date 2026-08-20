// İP-A7d3 · Görev 6 — göç eden ON ekranın gerçek tarayıcı turu (Chrome + CDP).
//
// ## Tur derinliği ekrana göre ayrılır (Görev 6'nın zorunlu ayrımı)
//
// Turun maliyeti ekran sayısıyla DOĞRUSAL artıyor (A7d2'nin tespiti). On
// ekranın onunu da tam tura sokmak pratik değil; ama iki kusur sınıfı (tema
// kusurları, odak regresyonları) YALNIZ burada görünüyor ve tur silinemez.
//
//   TAM tur (açık+koyu × 1280+380 + etkileşim ölçümleri):
//     • sayim-detayi         — YENİ YAZIM: satır başına form. `number` kutusu
//                              satır içinde; koyu tema `color-scheme` sınavı.
//     • tur-detayi           — YENİ YAZIM: sürükle-bırak sıralama. Sıralama
//                              denetimleri dokunmatikte tek erişim yolu.
//     • operator-kutuphanem  — YENİ YAZIM: yedi bölümlü satır içi düzenleme +
//                              `type="time"` kutuları. SK-6'nın bu dalgada
//                              bulunan İKİNCİ örneği tam burada (ortak `.input`
//                              sınıfını kullanmayan iki saat kutusu).
//
//   KISA tur (mobil 380 + koyu tema):
//     • sayim-listesi · sikayetler · istasyon · odeme · admin-home ·
//       operator-panel · operator-oturumlar — deseni tekrar eden ekranlar.
//
// GERÇEK VERİ KULLANILMAZ: sonda sayfası axios adapter'ını sahte sunucuyla
// değiştirir, hiçbir arka uca bağlanmaz.
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/ip_a7d3_tur.mjs --frontend http://127.0.0.1:5199
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
const OUT = resolve(ARGS.out ?? "../docs/ip-a7d3");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9293);

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

/** Adı verilen etikete (aria-label ya da <label>) sahip alanı yaz. */
const alanaYaz = (ad, deger) => {
  const alanlar = Array.from(document.querySelectorAll("input, textarea"));
  const bul = (el) =>
    el.getAttribute("aria-label") ||
    (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "").trim() ||
    (el.closest("label")?.textContent ?? "").trim();
  const alan = alanlar.find((el) => bul(el).includes(ad));
  if (!alan) return { hata: `alan yok: ${ad}` };
  const proto =
    alan.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(alan, deger);
  alan.dispatchEvent(new Event("input", { bubbles: true }));
  alan.blur();
  return { yazildi: ad };
};

/** Sayfadaki tüm `<button>` adları — ölçüm ve teşhis için. */
const dugmeAdlari = () =>
  Array.from(document.querySelectorAll("button"))
    .map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim())
    .filter(Boolean)
    .slice(0, 40);

/** Genel düzen ölçümü: taşma, en küçük dokunma hedefi, iç içe düğme. */
const duzenOlc = () => {
  const kok = document.documentElement;
  const dugmeler = Array.from(document.querySelectorAll("button")).filter(
    (b) => b.getBoundingClientRect().height > 0
  );
  return {
    govdeGenisligi: document.body.clientWidth,
    yatayTasma: kok.scrollWidth > kok.clientWidth,
    tasmaPiksel: Math.max(0, kok.scrollWidth - kok.clientWidth),
    icIceButon: document.querySelectorAll("button button").length,
    dugmeSayisi: dugmeler.length,
    enKucukDokunmaHedefi: dugmeler.length
      ? Math.min(...dugmeler.map((b) => Math.round(b.getBoundingClientRect().height)))
      : null,
    hamButon: Array.from(document.querySelectorAll("button")).filter(
      (b) => b.getAttribute("aria-pressed") === null && !b.className.includes("inline-flex")
    ).length,
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

  const adres = (ekran, koyu) =>
    `${FRONTEND}/scripts/probe/a7d3-probe.html?ekran=${ekran}&koyu=${koyu}`;

  const TAM = ["sayim-detayi", "tur-detayi", "operator-kutuphanem"];
  const KISA = [
    "sayim-listesi",
    "sikayetler",
    "istasyon",
    "odeme",
    "admin-home",
    "operator-panel",
    "operator-oturumlar",
  ];

  /* ── TAM TUR: üç ekran × iki tema × iki genişlik ── */
  for (const ekran of TAM) {
    sonuc.tamTur[ekran] = {};
    for (const koyu of [0, 1]) {
      for (const genislik of [1280, 380]) {
        await s.genislik(genislik);
        await s.git(adres(ekran, koyu));
        const anahtar = `${koyu ? "koyu" : "acik"}-${genislik}`;
        const olcum = await s.eval(duzenOlc);
        olcum.tema = await s.eval(() =>
          document.documentElement.classList.contains("dark") ? "koyu" : "acik"
        );
        sonuc.tamTur[ekran][anahtar] = olcum;
        kapi(!olcum.yatayTasma, `${ekran}/${anahtar}: yatay taşma (${olcum.tasmaPiksel}px)`);
        kapi(olcum.icIceButon === 0, `${ekran}/${anahtar}: iç içe <button>`);
        await s.ss(join(OUT, `${ekran}-${anahtar}.png`));
      }
    }
  }

  /* ── KISA TUR: yedi ekran, mobil 380 + koyu tema ── */
  for (const ekran of KISA) {
    await s.genislik(380);
    await s.git(adres(ekran, 1));
    const olcum = await s.eval(duzenOlc);
    olcum.dugmeler = await s.eval(dugmeAdlari);
    sonuc.kisaTur[ekran] = olcum;
    kapi(!olcum.yatayTasma, `${ekran}/koyu-380: yatay taşma (${olcum.tasmaPiksel}px)`);
    kapi(olcum.icIceButon === 0, `${ekran}/koyu-380: iç içe <button>`);
    await s.ss(join(OUT, `${ekran}-koyu-380.png`));
  }

  /* ── T1: koyu temada YEREL WIDGET ŞEMASI (SK-6 sınıfı) ── */
  //
  // A6c'nin düzeltmesi ortak `.input` sınıfına yazılmıştı; bu dalga o sınıfı
  // KULLANMAYAN iki `type="time"` kutusu buldu (`OperatorLibrary`). Ölçüm
  // düzeltmenin gerçekten uygulandığını gösterir.
  await s.genislik(1280);
  await s.git(adres("operator-kutuphanem", 1));
  await s.eval(() => {
    const d = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Çalışma Saatleri")
    );
    d?.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await s.eval(() => {
    document
      .querySelectorAll('input[type="checkbox"]')
      .forEach((c) => {
        if (!c.checked) c.click();
      });
  });
  await new Promise((r) => setTimeout(r, 500));
  sonuc.saatSemasi = await s.eval(colorSchemeOlc);
  await s.ss(join(OUT, "kutuphanem-saatler-koyu.png"));
  kapi(
    sonuc.saatSemasi.length > 0 &&
      sonuc.saatSemasi.every((x) => x.colorScheme === "dark"),
    "kütüphanem: koyu temada saat kutularının color-scheme'i 'dark' değil"
  );
  kapi(
    sonuc.saatSemasi.every((x) => !!x.ad),
    "kütüphanem: saat kutularının erişilebilir adı yok"
  );

  // Aynı ölçüm sayım detayında (`type="number"`, satır içi form).
  await s.git(adres("sayim-detayi", 1));
  sonuc.sayimSemasi = await s.eval(colorSchemeOlc);
  kapi(
    sonuc.sayimSemasi.length > 0 &&
      sonuc.sayimSemasi.every((x) => x.colorScheme === "dark"),
    "sayım detayı: koyu temada sayı kutularının color-scheme'i 'dark' değil"
  );

  /* ── T2: odak tuzağı + ESC + odak iadesi (gerçek klavye) ── */
  await s.genislik(1280);
  await s.git(adres("sayim-listesi", 0));
  const acanOdakli = await s.eval(() => {
    const d = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "Yeni sayım"
    );
    if (!d) return false;
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
  kapi(!!odakTuzagi.acildi, "yeni sayım penceresi klavyeyle açılmadı");
  kapi(odakTuzagi.acanOdakliydi, "açan düğme odaklanamadı");
  kapi(!odakTuzagi.tabDisinaCikti, "odak pencereden çıktı");
  kapi(odakTuzagi.shiftTabPencereIcinde, "Shift+Tab odağı pencereden çıkardı");
  kapi(odakTuzagi.escKapatti, "ESC pencereyi kapatmadı");
  kapi(odakTuzagi.odakIadesi.acanaDondu, "odak açan düğmeye iade edilmedi");

  /* ── T3: KİRLİ formda kapatma önce SORAR (gerçek klavye) ── */
  await s.git(adres("sayim-listesi", 0));
  await s.eval(dugmeyeBas, "Yeni sayım");
  await new Promise((r) => setTimeout(r, 800));
  sonuc.kirliYazma = await s.eval(alanaYaz, "Not", "Sonda notu");
  await new Promise((r) => setTimeout(r, 600));
  await s.tus("Escape", { code: 27 });
  await new Promise((r) => setTimeout(r, 800));
  sonuc.kirliKapatma = await s.eval(() => ({
    onaySoruldu: document.body.textContent.includes("Kaydedilmemiş değişiklikler var"),
    editorAyakta: !!document.querySelector('[role="dialog"]'),
  }));
  kapi(sonuc.kirliKapatma.onaySoruldu, "kirli formda kapatma sormadan geçti");
  kapi(sonuc.kirliKapatma.editorAyakta, "onay sorulmadan editör kapandı");
  await s.ss(join(OUT, "sayim-kirli-kapatma.png"));

  /* ── T4: SK-7 — GEREKÇE penceresi de sorar (ortak katman, gerçek tarayıcı) ── */
  await s.genislik(1280);
  await s.git(adres("sayim-detayi", 0));
  await s.eval(dugmeyeBas, "Oturumu iptal et");
  await new Promise((r) => setTimeout(r, 800));
  sonuc.gerekceYazma = await s.eval(alanaYaz, "İptal gerekçesi", "Sonda gerekçesi");
  await new Promise((r) => setTimeout(r, 600));
  await s.tus("Escape", { code: 27 });
  await new Promise((r) => setTimeout(r, 800));
  sonuc.gerekceKapatma = await s.eval(() => ({
    onaySoruldu: document.body.textContent.includes("Kaydedilmemiş değişiklikler var"),
  }));
  kapi(sonuc.gerekceKapatma.onaySoruldu, "SK-7: gerekçe penceresi sormadan kapandı");
  await s.ss(join(OUT, "gerekce-kirli-kapatma.png"));

  /* ── T5: gönderim → odak ilk hatalı alana + hata kontrastı ── */
  for (const koyu of [0, 1]) {
    const tema = koyu ? "koyu" : "acik";
    await s.genislik(1280);
    await s.git(adres("sayim-detayi", koyu));
    // Satır sayım alanını GEÇERSİZ yap ve kaydet.
    await s.eval(alanaYaz, "Sayılan miktar", "12.5");
    await new Promise((r) => setTimeout(r, 400));
    await s.eval(dugmeyeBas, "Kaydet");
    await new Promise((r) => setTimeout(r, 900));
    sonuc.gonderim = sonuc.gonderim ?? {};
    sonuc.gonderim[tema] = {
      odak: await s.eval(odaklanan),
      hata: await s.eval(kontrastOlc),
    };
    await s.ss(join(OUT, `sayim-gonderim-${tema}.png`));
  }
  kapi(
    sonuc.gonderim?.acik?.odak?.ariaInvalid === "true",
    "satır formunda odak ilk hatalı alanda değil"
  );
  for (const tema of ["acik", "koyu"]) {
    const h = sonuc.gonderim?.[tema]?.hata;
    kapi(!!h && h.gecti, `${tema} tema: hata metni kontrastı eşiğin altında`);
  }

  /* ── T6: SÜRÜKLE-BIRAK sıralama denetimleri gerçek ekranda ── */
  await s.genislik(380);
  await s.git(adres("tur-detayi", 1));
  sonuc.siralama = await s.eval(() => {
    const oklar = Array.from(document.querySelectorAll("button")).filter((b) =>
      /taşı$/.test(b.getAttribute("aria-label") ?? "")
    );
    return {
      okSayisi: oklar.length,
      adlar: oklar.map((b) => b.getAttribute("aria-label")).slice(0, 6),
      enKucukHedef: oklar.length
        ? Math.min(...oklar.map((b) => Math.round(b.getBoundingClientRect().height)))
        : null,
      surukleneKapSayisi: document.querySelectorAll('[draggable="true"]').length,
    };
  });
  kapi(sonuc.siralama.okSayisi >= 4, "sıralama ok düğmeleri mobilde basılmıyor");
  kapi(
    (sonuc.siralama.enKucukHedef ?? 0) >= 32,
    `sıralama düğmeleri dokunma hedefi küçük (${sonuc.siralama.enKucukHedef}px)`
  );

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
