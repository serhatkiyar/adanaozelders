// İP-A7d4 · Görev 5 — göç eden ALTI ekranın gerçek tarayıcı turu (Chrome + CDP).
//
// ## Tur derinliği ekrana göre ayrılır (görev tanımının zorunlu ayrımı)
//
//   TAM tur (açık+koyu × 1280+380 + etkileşim ölçümleri):
//     • yetki   — bu dalganın TEK yeni yazımı: pencere içinde `Form.*` formu +
//                 gruplanmış izin kutusu ızgarası (`fieldset`/`legend`).
//                 SK-9'un gerçek tarayıcı kanıtı da burada.
//     • takvim  — satır içi form + `type="date"`: koyu temada yerel widget
//                 şeması (SK-6 sınıfı) bu dalgada YALNIZ burada ölçülebilir.
//                 Ayrıca kilitli karar düzeltmesi (gönder düğmesi açık).
//
//   KISA tur (mobil 380 + koyu tema):
//     • ayarlar · operasyon · bugun · tahta — göçleri MEKANİKTİR
//       (`useState` → `useDuzenlemeYuzeyi`); pencereleri zaten ortak
//       `ConfirmDialog`/`ReasonDialog` çiziyordu ve o yazım A7d1-A7d3'te tam
//       turdan geçti. Burada ölçülen şey yeni bir yazım değil, göçün mobil
//       düzeni ve pencerenin gerçekten açılıp kapanması.
//
// GERÇEK VERİ KULLANILMAZ: sonda sayfası axios adapter'ını sahte sunucuyla
// değiştirir, hiçbir arka uca bağlanmaz.
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/ip_a7d4_tur.mjs --frontend http://127.0.0.1:5199
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
const OUT = resolve(ARGS.out ?? "../docs/ip-a7d4");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9294);

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

/* ── Sayfa içi ölçüm fonksiyonları (A7d3'ün sondasıyla aynı birimler) ── */

const kontrastOlc = () => {
  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
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
  const arkaPlan = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const p = rgb(getComputedStyle(n).backgroundColor);
      if (p.length >= 3 && (p.length < 4 || p[3] > 0)) return p.slice(0, 3);
    }
    return [255, 255, 255];
  };
  // Alan hatası `Form.ErrorMessage`tir ve `role="alert"` taşır. Metne göre
  // aramak YANLIŞ ölçüm üretiyordu: pencerenin AÇIKLAMA paragrafı ("İzinler
  // en az yetki ilkesine göre seçilmelidir.") desene uyuyor ve ölçüm onun
  // rengini raporluyordu — yani hata renginin kontrastı hiç ölçülmemiş
  // oluyordu. Sonda kendi yalancı yeşilini üretmiş olurdu.
  const el = document.querySelector('[role="dialog"] [role="alert"], [role="alert"]');
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
  Array.from(
    document.querySelectorAll(
      'input[type="number"], input[type="time"], input[type="date"], input[type="datetime-local"]'
    )
  ).map((el) => ({
    tip: el.getAttribute("type"),
    ad:
      el.getAttribute("aria-label") ||
      (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "").trim() ||
      el.id,
    colorScheme: getComputedStyle(el).colorScheme,
  }));

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

const dugmeyeBas = (ad) => {
  // ÖNEK eşleşmesi: bazı düğmeler metnin yanında bir sayaç rozeti taşıyor
  // ("Günü Optimize Et" + "2") ve tam eşleşme onları hiç bulamıyordu —
  // sonda "düğme yok" deyip sessizce ilerliyordu.
  const d = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(ad)
  );
  if (!d) return { hata: `düğme yok: ${ad}` };
  if (d.disabled) return { hata: `düğme kapalı: ${ad}` };
  d.click();
  return { basildi: ad };
};

/** Düğme AÇILANA kadar bekler (veri gelmeden kapalı doğan işlemler için). */
const dugmeAcikMi = (ad) => {
  const d = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(ad)
  );
  return { bulundu: !!d, kapali: d ? d.disabled : null };
};

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

/** Adsız form kontrolü — kapının tarayıcıdaki karşılığı. */
const adsizKontrolOlc = () =>
  Array.from(document.querySelectorAll("input, select, textarea"))
    .filter((el) => !["hidden", "submit", "button", "reset", "image"].includes(el.type))
    .filter((el) => {
      const ad =
        el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") &&
          document.getElementById(el.getAttribute("aria-labelledby"))?.textContent) ||
        (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
        el.closest("label")?.textContent;
      return !(ad || "").trim();
    })
    .map((el) => el.outerHTML.slice(0, 120));

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
  };
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
    `${FRONTEND}/scripts/probe/a7d4-probe.html?ekran=${ekran}&koyu=${koyu}`;

  const TAM = ["yetki", "takvim"];
  const KISA = ["ayarlar", "operasyon", "bugun", "tahta"];

  /* ── TAM TUR ── */
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
        olcum.adsizKontroller = await s.eval(adsizKontrolOlc);
        sonuc.tamTur[ekran][anahtar] = olcum;
        kapi(!olcum.yatayTasma, `${ekran}/${anahtar}: yatay taşma (${olcum.tasmaPiksel}px)`);
        kapi(olcum.icIceButon === 0, `${ekran}/${anahtar}: iç içe <button>`);
        kapi(
          olcum.adsizKontroller.length === 0,
          `${ekran}/${anahtar}: adsız form kontrolü (${olcum.adsizKontroller.length})`
        );
        await s.ss(join(OUT, `${ekran}-${anahtar}.png`));
      }
    }
  }

  /* ── KISA TUR ── */
  for (const ekran of KISA) {
    await s.genislik(380);
    await s.git(adres(ekran, 1));
    const olcum = await s.eval(duzenOlc);
    olcum.adsizKontroller = await s.eval(adsizKontrolOlc);
    sonuc.kisaTur[ekran] = olcum;
    kapi(!olcum.yatayTasma, `${ekran}/koyu-380: yatay taşma (${olcum.tasmaPiksel}px)`);
    kapi(olcum.icIceButon === 0, `${ekran}/koyu-380: iç içe <button>`);
    await s.ss(join(OUT, `${ekran}-koyu-380.png`));
  }

  /* ── T1: koyu temada YEREL WIDGET ŞEMASI — `type="date"` (SK-6 sınıfı) ── */
  await s.genislik(1280);
  await s.git(adres("takvim", 1));
  sonuc.tarihSemasi = await s.eval(colorSchemeOlc);
  kapi(
    sonuc.tarihSemasi.length > 0 && sonuc.tarihSemasi.every((x) => x.colorScheme === "dark"),
    "takvim: koyu temada tarih kutusunun color-scheme'i 'dark' değil"
  );
  kapi(
    sonuc.tarihSemasi.every((x) => !!x.ad),
    "takvim: tarih kutusunun erişilebilir adı yok"
  );
  await s.ss(join(OUT, "takvim-tarih-koyu.png"));

  /* ── T2: odak tuzağı + ESC + odak iadesi (gerçek klavye) ── */
  await s.genislik(1280);
  await s.git(adres("yetki", 0));
  const acanOdakli = await s.eval(() => {
    const d = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "Yeni rol"
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
  for (let i = 0; i < 16; i++) {
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
  kapi(!!odakTuzagi.acildi, "rol penceresi klavyeyle açılmadı");
  kapi(odakTuzagi.acanOdakliydi, "açan düğme odaklanamadı");
  kapi(!odakTuzagi.tabDisinaCikti, "odak pencereden çıktı");
  kapi(odakTuzagi.shiftTabPencereIcinde, "Shift+Tab odağı pencereden çıkardı");
  kapi(odakTuzagi.escKapatti, "ESC pencereyi kapatmadı");
  kapi(odakTuzagi.odakIadesi.acanaDondu, "odak açan düğmeye iade edilmedi");

  /* ── T3: SK-9 — kirli rol formunda kapatma ÖNCE SORAR (gerçek klavye) ── */
  await s.git(adres("yetki", 0));
  await s.eval(dugmeyeBas, "Yeni rol");
  await new Promise((r) => setTimeout(r, 800));
  sonuc.kirliYazma = await s.eval(alanaYaz, "Rol adı", "Sonda rolü");
  await new Promise((r) => setTimeout(r, 600));
  await s.tus("Escape", { code: 27 });
  await new Promise((r) => setTimeout(r, 800));
  sonuc.kirliKapatma = await s.eval(() => ({
    onaySoruldu: document.body.textContent.includes("Kaydedilmemiş değişiklikler var"),
    editorAyakta: !!document.querySelector('[role="dialog"]'),
  }));
  kapi(sonuc.kirliKapatma.onaySoruldu, "SK-9: kirli rol formu sormadan kapandı");
  kapi(sonuc.kirliKapatma.editorAyakta, "onay sorulmadan editör kapandı");
  await s.ss(join(OUT, "yetki-kirli-kapatma.png"));

  /* ── T4: İZİN KUTUSU da kirletir (yalnız metin alanı değil) ── */
  await s.git(adres("yetki", 0));
  await s.eval(dugmeyeBas, "Yeni rol");
  await new Promise((r) => setTimeout(r, 800));
  await s.eval(() => {
    const k = document.querySelector('[role="dialog"] input[type="checkbox"]');
    k?.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await s.tus("Escape", { code: 27 });
  await new Promise((r) => setTimeout(r, 800));
  sonuc.kutuKirletti = await s.eval(() =>
    document.body.textContent.includes("Kaydedilmemiş değişiklikler var")
  );
  kapi(sonuc.kutuKirletti, "izin kutusu formu kirletmedi — kutular sormadan silinirdi");

  /* ── T5: gönderim → odak ilk hatalı alana + hata kontrastı ── */
  for (const koyu of [0, 1]) {
    const tema = koyu ? "koyu" : "acik";
    await s.genislik(1280);
    await s.git(adres("yetki", koyu));
    await s.eval(dugmeyeBas, "Yeni rol");
    await new Promise((r) => setTimeout(r, 800));
    // Boş formda gönder: düğme AÇIK olmalı, istek gitmemeli, hata alanda.
    sonuc.gonderDugmesi = await s.eval(() => {
      const d = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
        (b) => b.textContent.trim() === "Kaydet"
      );
      return { bulundu: !!d, kapali: d ? d.disabled : null };
    });
    await s.eval(dugmeyeBas, "Kaydet");
    await new Promise((r) => setTimeout(r, 900));
    sonuc.gonderim = sonuc.gonderim ?? {};
    sonuc.gonderim[tema] = {
      odak: await s.eval(odaklanan),
      hata: await s.eval(kontrastOlc),
    };
    await s.ss(join(OUT, `yetki-gonderim-${tema}.png`));
  }
  kapi(sonuc.gonderDugmesi?.bulundu, "gönder düğmesi pencerede yok");
  kapi(sonuc.gonderDugmesi?.kapali === false, "gönder düğmesi geçerlilikle KAPANMIŞ");
  kapi(
    sonuc.gonderim?.acik?.odak?.ariaInvalid === "true",
    "odak ilk hatalı alanda değil (aria-invalid yok)"
  );
  kapi(
    sonuc.gonderim?.acik?.odak?.pencereIcinde === true,
    "odak pencerenin DIŞINA düştü"
  );
  for (const tema of ["acik", "koyu"]) {
    const h = sonuc.gonderim?.[tema]?.hata;
    kapi(!!h && h.gecti, `${tema} tema: alan hatası metninin kontrastı eşiğin altında`);
  }

  /* ── T6: takvimde gönder düğmesi AÇIK ve hata alanda (kilitli karar) ── */
  await s.genislik(1280);
  await s.git(adres("takvim", 0));
  sonuc.takvimGonder = await s.eval(() => {
    const d = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "Günü kapat"
    );
    return { bulundu: !!d, kapali: d ? d.disabled : null };
  });
  await s.eval(dugmeyeBas, "Günü kapat");
  await new Promise((r) => setTimeout(r, 700));
  sonuc.takvimHata = await s.eval(() =>
    document.body.textContent.includes("Kapatılacak günü seçin.")
  );
  kapi(sonuc.takvimGonder?.bulundu, "takvimde 'Günü kapat' düğmesi yok");
  kapi(sonuc.takvimGonder?.kapali === false, "takvimde gönder düğmesi geçerlilikle KAPANMIŞ");
  kapi(sonuc.takvimHata, "boş gün gönderiminde hata ALANDA çıkmadı");
  await s.ss(join(OUT, "takvim-bos-gonderim.png"));

  /* ── T7: onay pencereleri gerçekten açılıp ESC ile kapanıyor ── */
  sonuc.onayPencereleri = {};
  for (const [ekran, dugme] of [
    ["operasyon", "Yeniden dene"],
    ["bugun", "Günü Optimize Et"],
    ["tahta", "Günü Optimize Et"],
  ]) {
    await s.genislik(1280);
    await s.git(adres(ekran, 1));
    // "Günü Optimize Et" konumlu sipariş gelmeden KAPALI doğar; beklemeden
    // tıklamak sessizce hiçbir şey yapmaz.
    let durum = null;
    for (let i = 0; i < 20; i++) {
      durum = await s.eval(dugmeAcikMi, dugme);
      if (durum.bulundu && durum.kapali === false) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    kapi(durum?.bulundu === true, `${ekran}: "${dugme}" düğmesi hiç basılmadı`);
    kapi(durum?.kapali === false, `${ekran}: "${dugme}" düğmesi kapalı kaldı`);
    await s.eval(dugmeyeBas, dugme);
    await new Promise((r) => setTimeout(r, 800));
    const acildi = await s.eval(pencereVarMi);
    await s.tus("Escape", { code: 27 });
    await new Promise((r) => setTimeout(r, 600));
    const kapandi = (await s.eval(pencereVarMi)) === null;
    sonuc.onayPencereleri[ekran] = { acildi, kapandi };
    kapi(!!acildi, `${ekran}: onay penceresi açılmadı`);
    kapi(kapandi, `${ekran}: ESC onay penceresini kapatmadı`);
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
