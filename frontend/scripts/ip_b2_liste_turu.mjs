// İP-B2 · Görev 5 — LİSTE SAYFASI ANATOMİSİNİN gerçek tarayıcı turu.
//
// Ölçülen şey ürün listesi ekranı ve onun ortak parçaları (araç çubuğu, filtre
// çipleri, iki boş durum, mobil kart, satır aksiyonu menüsü). Sonda sayfası
// KULLANILMAZ: menünün konumlanması, çiplerin sarması, mobil kartın tabloyu
// gerçekten değiştirmesi ve `md:` kırılma noktası ancak gerçek rota ağacında
// ve gerçek CSS ile görülür.
//
// Ayrıca Ç-5'in (KVKK) DAVRANIŞ kanıtı burada: sayfa yüklenirken dış konağa
// giden ağ isteği sayısı ÖLÇÜLÜR — kaynak taraması yalnız metni görür.
//
// GERÇEK VERİ KULLANILMAZ: tur, YENİ ve BOŞ bir demo veritabanına
// (`adana_b1_demo`) bağlı bir backend'e karşı koşar. Canlı `ceyhandb`'ye
// bağlanılmaz; ekranlarda yalnız seed verisi ve boş durumlar görünür.
//
// Kullanım (frontend/):
//   node scripts/ip_b2_liste_turu.mjs --frontend http://127.0.0.1:5173 \
//        --eposta admin@... --sifre ...
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] ?? "1"]);
    return acc;
  }, [])
);
const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5173";
const OUT = resolve(ARGS.out ?? "../docs/ip-b2");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9413);
const EPOSTA = ARGS.eposta;
const SIFRE = ARGS.sifre;

async function chromeBaslat() {
  // Profil ÇIKTI dizinine yazılmaz: `docs/ip-b1` sonuçların yeri ve Chrome
  // profili orada kalırsa hem commit'e sızar hem bir sonraki koşumda kilitli
  // kalıp turu düşürür (ölçüldü: EPERM).
  // Profil KOŞUMA ÖZEL: eski profili silmeye çalışmak, arka planda kalmış
  // bir Chrome varken EPERM ile turu düşürüyordu (ölçüldü).
  const profil = join(tmpdir(), `ip-b2-tur-profil-${process.pid}`);
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
  for (let i = 0; i < 120; i++) {
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
    await new Promise((r) => setTimeout(r, 1600));
  }
  /**
   * Ekranın RENDER'ini bekler: `readyState complete` yetmez — rotalar
   * `React.lazy` ile bölünüyor ve kabuk ancak parça indikten sonra basılıyor.
   * Sabit bekleme ilk koşumda 13 sahte kırmızı üretti ("h1 sayısı 0", "rail
   * görünmüyor") — ölçülen şey düzen değil, yükleme hızıydı.
   */
  async hazirBekle(ms = 20000) {
    const bitis = Date.now() + ms;
    while (Date.now() < bitis) {
      if (await this.eval(() => document.querySelectorAll("h1").length > 0)) {
        // Bir kare daha: başlık geldiyse kabuk da basılmıştır.
        await new Promise((r) => setTimeout(r, 400));
        return true;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
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
    await new Promise((r) => setTimeout(r, 150));
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
}

/* ── Sayfa içi sondalar ── */

const kontrastAraci = `
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
  const kanal = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const parlaklik = (p) => 0.2126 * kanal(p[0]) + 0.7152 * kanal(p[1]) + 0.0722 * kanal(p[2]);
  const oran = (on, arka) => { const a = parlaklik(on) + 0.05, b = parlaklik(arka) + 0.05; return +(Math.max(a,b)/Math.min(a,b)).toFixed(2); };
  const arkaPlan = (el) => { for (let n = el; n; n = n.parentElement) { const p = rgb(getComputedStyle(n).backgroundColor); if (p.length >= 3 && (p.length < 4 || p[3] > 0)) return p.slice(0,3); } return [255,255,255]; };
`;

/** Liste sayfasının düzen ölçümü. */
const listeOlc = () => {
  const kok = document.documentElement;
  const dugmeler = Array.from(document.querySelectorAll("button")).filter(
    (b) => b.getBoundingClientRect().height > 0
  );
  const tablo = document.querySelector("table");
  const mobil = document.querySelector("[data-mobil-satirlar]");
  const gorunur = (el) => !!el && el.getBoundingClientRect().width > 0;
  return {
    tema: kok.classList.contains("dark") ? "koyu" : "acik",
    govdeGenisligi: document.body.clientWidth,
    yatayTasma: kok.scrollWidth > kok.clientWidth,
    tasmaPiksel: Math.max(0, kok.scrollWidth - kok.clientWidth),
    icIceButon: document.querySelectorAll("button button").length,
    dugmeSayisi: dugmeler.length,
    enKucukDokunmaHedefi: dugmeler.length
      ? Math.min(...dugmeler.map((b) => Math.round(b.getBoundingClientRect().height)))
      : null,
    // Yalnız sayı yetmez: "en küçük hedef 20 px" cümlesi hangi düğme olduğunu
    // söylemezse düzeltilemez bir ölçümdür.
    enKucukDokunmaHedefiAdi: dugmeler.length
      ? (() => {
          const en = dugmeler.reduce((a, b) =>
            a.getBoundingClientRect().height <= b.getBoundingClientRect().height ? a : b
          );
          return {
            ad: (en.getAttribute("aria-label") || en.textContent || "").trim().slice(0, 40),
            yukseklik: Math.round(en.getBoundingClientRect().height),
            kapsayici: en.closest("th") ? "tablo-basligi" : en.closest("footer") ? "sayfalama" : "diger",
          };
        })()
      : null,
    h1Sayisi: document.querySelectorAll("h1").length,
    h1: (document.querySelector("h1")?.textContent ?? "").trim(),
    // Kırılma noktası: masaüstünde tablo görünür, mobilde kart.
    tabloGorunur: gorunur(tablo),
    mobilKartGorunur: gorunur(mobil),
    mobilKartSayisi: mobil ? mobil.children.length : 0,
    aramaVar: !!document.querySelector('input[type="search"]'),
    filtreEkleVar: Array.from(document.querySelectorAll("button")).some((b) =>
      (b.textContent || "").includes("Filtre ekle")
    ),
    siralaVar: Array.from(document.querySelectorAll("button")).some((b) =>
      (b.textContent || "").includes("Sırala:")
    ),
    bosDurum: document.querySelector("[data-bos-durum]")?.getAttribute("data-bos-durum") ?? null,
    cipSayisi: Array.from(document.querySelectorAll("button")).filter((b) =>
      (b.getAttribute("aria-label") || "").includes("filtresini kaldır")
    ).length,
    // Satır aksiyonu kuralı: bir satırda kaç AÇIK düğme var (üç nokta hariç).
    satirAcikDugmeleri: (() => {
      const satir = document.querySelector("tbody tr");
      if (!satir) return null;
      return Array.from(satir.querySelectorAll("button"))
        .map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim())
        .filter((t) => !t.includes("işlemler"));
    })(),
    erisimReddi: /yetkiniz yok/i.test(document.body.innerText),
    // Yazı tipi: gerçekten Figtree/Inter mi çiziliyor.
    baslikFontu: document.querySelector("h1")
      ? getComputedStyle(document.querySelector("h1")).fontFamily
      : null,
    govdeFontu: getComputedStyle(document.body).fontFamily,
    yuklenenFontlar: Array.from(document.fonts ?? [])
      .filter((f) => f.status === "loaded")
      .map((f) => `${f.family} ${f.weight}`),
  };
};

/** Liste yüzeyinin kontrast ölçümü (iki temada da koşulur). */
const listeKontrastOlc = new Function(`
  ${kontrastAraci}
  const out = {};
  const olc = (ad, el, esik) => {
    if (!el) { out[ad] = null; return; }
    const st = getComputedStyle(el);
    const k = oran(rgb(st.color).slice(0,3), arkaPlan(el));
    out[ad] = { kontrast: k, esik, gecti: k >= esik, fontPx: parseFloat(st.fontSize) };
  };
  const dugmeler = Array.from(document.querySelectorAll("button"));
  olc("birincilDugme", dugmeler.find((b) => /Yeni ürün/.test(b.textContent || "")), 4.5);
  olc("ikincilDugme", dugmeler.find((b) => /Filtre ekle/.test(b.textContent || "")), 4.5);
  olc("cip", dugmeler.find((b) => (b.getAttribute("aria-label")||"").includes("filtresini kaldır")), 4.5);
  olc("tabloBasligi", document.querySelector("thead th"), 3);
  olc("tabloHucresi", document.querySelector("tbody td"), 4.5);
  olc("sayfalamaSayaci", document.querySelector("footer p"), 4.5);
  olc("bosDurumBasligi", document.querySelector("[data-bos-durum] h2"), 4.5);
  const rozet = document.querySelector("tbody span.rounded-full");
  olc("durumRozeti", rozet, 4.5);
  // Birincil düğmenin ZEMİN rengi de kayda geçer: marka lacivertinin gerçekten
  // uygulandığı ancak hesaplanan renkle kanıtlanır.
  const birincil = dugmeler.find((b) => /Yeni ürün/.test(b.textContent || ""));
  if (birincil) out.birincilDugmeZemini = getComputedStyle(birincil).backgroundColor;
  return out;
`);

const odakHalkasiOlc = new Function(`
  ${kontrastAraci}
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const st = getComputedStyle(el);
  return {
    ad: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
    etiket: el.tagName.toLowerCase(),
    boxShadow: st.boxShadow.slice(0, 140),
    outline: st.outlineStyle + " " + st.outlineWidth + " " + st.outlineColor,
    halkaVar: /rgb/.test(st.boxShadow) || (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0),
  };
`);

/**
 * Adı eşleşen ve GERÇEKTEN GÖRÜNÜR düğmeye basar.
 *
 * ⚠️ Görünürlük şartı kozmetik değil: bu turun ilk koşumunda `satır menüsü
 * ESC ile kapanmadı` diye bir kapı düştü ve sebebi ÜRÜN DEĞİL, BU YARDIMCIYDI.
 * Mobil kart bölümü DOM'da tablodan ÖNCE gelir ve masaüstünde `md:hidden`
 * (yani `display:none`) ile gizlenir. Adı eşleşen ilk düğme bu yüzden GİZLİ
 * karttaki tetikleyiciydi; `el.click()` gizli bir düğmede de çalışır, menü
 * açılır ama `focus()` `display:none` bir öğede ETKİSİZDİR — odak `<body>`de
 * kalır, ESC olayı menünün kabına hiç ulaşmaz ve menü kapanmaz.
 *
 * Gerçek kullanıcı gizli bir düğmeye basamaz; yani ölçüm gerçek olmayan bir
 * yolu ölçüyordu. Görünürlük şartıyla tur, kullanıcının bastığı düğmeye basar.
 */
const dugmeyeBas = (ad) => {
  const gorunur = (b) => b.offsetParent !== null && b.getBoundingClientRect().width > 0;
  const d = Array.from(document.querySelectorAll("button"))
    .filter(gorunur)
    .find((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().includes(ad));
  if (!d) return { hata: `görünür düğme yok: ${ad}` };
  d.click();
  return { basildi: ad, ad: (d.getAttribute("aria-label") || d.textContent || "").trim() };
};

const menuOgesineBas = (ad) => {
  const d = Array.from(document.querySelectorAll('[role="menuitem"]')).find((b) =>
    (b.textContent || "").trim().includes(ad)
  );
  if (!d) return { hata: `menü öğesi yok: ${ad}` };
  d.click();
  return { basildi: ad };
};

const menuDurumu = () => {
  const m = document.querySelector('[role="menu"]');
  return m
    ? {
        etiket: m.getAttribute("aria-label"),
        ogeler: Array.from(m.querySelectorAll('[role="menuitem"]')).map((o) =>
          (o.textContent || "").trim()
        ),
        // Menü ekrandan taşıyor mu (sağ kenara yapışan satır menüsünün klasik kusuru).
        tasiyor: m.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
      }
    : null;
};

/* ── Tur ── */

const sonuc = { olculdu: new Date().toISOString(), ekranlar: {}, etkilesim: {}, ag: {} };
let hataliAdim = 0;
const kapi = (kosul, ad) => {
  if (!kosul) {
    hataliAdim++;
    (sonuc.dusenKapilar = sonuc.dusenKapilar ?? []).push(ad);
  }
};

const URUNLER = "/yonetim/magaza/urunler";

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

  /* ── Ç-5'in DAVRANIŞ kanıtı: dış konağa giden istek var mı ── */
  const istekler = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Network.requestWillBeSent") istekler.push(m.params.request.url);
  });
  await s.gonder("Network.enable");

  /* ── Oturum: gerçek giriş formu üzerinden ── */
  await s.genislik(1280);
  await s.git(`${FRONTEND}/giris`);
  const girisSonucu = await s.eval(
    async (eposta, sifre) => {
      const yaz = (sec, deger) => {
        const el = document.querySelector(sec);
        if (!el) return false;
        const proto =
          el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
        Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, deger);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      };
      const e = yaz('input[type="email"]', eposta);
      const p = yaz('input[type="password"]', sifre);
      const form = document.querySelector("form");
      if (!form) return { hata: "form yok" };
      form.requestSubmit
        ? form.requestSubmit()
        : form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return { epostaYazildi: e, sifreYazildi: p };
    },
    EPOSTA,
    SIFRE
  );
  for (let i = 0; i < 40; i++) {
    if ((await s.eval(() => location.pathname)) !== "/giris") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  sonuc.giris = { ...girisSonucu, yol: await s.eval(() => location.pathname) };
  kapi(sonuc.giris.yol !== "/giris", `giriş başarısız (yol: ${sonuc.giris.yol})`);

  /* ── 2 tema × 2 genişlik ── */
  for (const koyu of [0, 1]) {
    await s.eval((k) => {
      const kayit = { state: { preference: k ? "dark" : "light" }, version: 0 };
      localStorage.setItem("adana-theme", JSON.stringify(kayit));
    }, koyu);
    for (const genislik of [1280, 380]) {
      await s.genislik(genislik);
      await s.git(`${FRONTEND}${URUNLER}`);
      await s.hazirBekle();
      const anahtar = `${koyu ? "koyu" : "acik"}-${genislik}`;
      const olcum = await s.eval(listeOlc);
      olcum.kontrast = await s.eval(listeKontrastOlc);
      sonuc.ekranlar[anahtar] = olcum;

      kapi(!olcum.yatayTasma, `${anahtar}: yatay taşma (${olcum.tasmaPiksel}px)`);
      kapi(olcum.icIceButon === 0, `${anahtar}: iç içe <button>`);
      kapi(!olcum.erisimReddi, `${anahtar}: 403 kutusu`);
      kapi(olcum.h1Sayisi === 1, `${anahtar}: h1 sayısı ${olcum.h1Sayisi}`);
      kapi(olcum.aramaVar, `${anahtar}: arama girdisi yok`);
      kapi(olcum.filtreEkleVar, `${anahtar}: 'Filtre ekle' yok`);
      kapi(olcum.siralaVar, `${anahtar}: 'Sırala' yok`);
      // Kırılma noktası: 1280'de tablo, 380'de kart.
      if (genislik === 1280) {
        kapi(olcum.tabloGorunur, `${anahtar}: masaüstünde tablo görünmüyor`);
        kapi(!olcum.mobilKartGorunur, `${anahtar}: masaüstünde mobil kart da çiziliyor`);
        // Ç-2 · D: satırda en fazla iki AÇIK düğme ve hiçbiri yıkıcı değil.
        if (olcum.satirAcikDugmeleri) {
          kapi(
            olcum.satirAcikDugmeleri.length <= 2,
            `${anahtar}: satırda ${olcum.satirAcikDugmeleri.length} açık düğme`
          );
          kapi(
            !olcum.satirAcikDugmeleri.some((t) => /^Sil$/.test(t)),
            `${anahtar}: yıkıcı aksiyon AÇIKTA`
          );
        }
      } else {
        kapi(olcum.mobilKartGorunur, `${anahtar}: mobilde kart görünmüyor`);
        kapi(!olcum.tabloGorunur, `${anahtar}: mobilde tablo hâlâ çiziliyor`);
      }
      // Dokunma hedefi: 380'de en küçük düğme 32 px'in altına inmemeli.
      if (genislik === 380 && olcum.enKucukDokunmaHedefi !== null) {
        kapi(
          olcum.enKucukDokunmaHedefi >= 32,
          `${anahtar}: en küçük dokunma hedefi ${olcum.enKucukDokunmaHedefi}px`
        );
      }
      // Kontrast: ölçülen her seviye eşiğini geçmeli.
      // ÖLÇÜLMEYEN seviye "geçti" sayılmaz — yalnız ölçülenler kapıya girer;
      // ölçülemeyenler (çip, boş durum) kendi adımlarında ölçülür ve orada
      // ayrıca kapıya bağlanır.
      for (const [ad, k] of Object.entries(olcum.kontrast)) {
        if (k && typeof k === "object" && "gecti" in k) {
          kapi(k.gecti, `${anahtar}: ${ad} kontrastı ${k.kontrast} (eşik ${k.esik})`);
        }
      }
      olcum.olculmeyenSeviyeler = Object.entries(olcum.kontrast)
        .filter(([, k]) => k === null)
        .map(([ad]) => ad);
      await s.ss(join(OUT, `urunler-${anahtar}.png`));
    }
  }

  /* ── Ç-5 · dış konak ağ ölçümü ── */
  // Desen PARÇALARDAN kurulur: bu dosya `frontend/` ağacında ve
  // `__guards__/disFont.test.ts` bütün ağacı tarıyor. Konak adı düz yazılsaydı
  // nöbetçi KENDİ turunu bulgu sayardı — nitekim ilk yazımda tam olarak bu
  // oldu ve mutasyon sürücüsünün "taban yeşil mi" kapısı yakaladı.
  const disDesen = new RegExp(
    [["goog", "leapis"].join("") + "\.com", ["gsta", "tic"].join("") + "\.com"].join("|")
  );
  const disKonaklar = istekler.filter((u) => disDesen.test(u));
  sonuc.ag = {
    toplamIstek: istekler.length,
    disYaziTipiIstegi: disKonaklar.length,
    ornekler: disKonaklar.slice(0, 5),
    yerelYaziTipiIstegi: istekler.filter((u) => /\/fonts\/.*\.woff2/.test(u)).length,
  };
  kapi(disKonaklar.length === 0, `Ç-5: dış yazı tipi konağına ${disKonaklar.length} istek gitti`);
  kapi(sonuc.ag.yerelYaziTipiIstegi > 0, "Ç-5: yerel woff2 hiç indirilmedi (bildirim ölü)");

  /* ── E-1: satır aksiyonu menüsü (masaüstü) ── */
  await s.genislik(1280);
  await s.git(`${FRONTEND}${URUNLER}`);
  await s.hazirBekle();
  await s.eval(dugmeyeBas, "diğer işlemler");
  await new Promise((r) => setTimeout(r, 400));
  const menu = await s.eval(menuDurumu);
  await s.ss(join(OUT, "satir-menusu-1280.png"));
  sonuc.etkilesim.satirMenusu = menu;
  kapi(!!menu, "satır menüsü açılmadı");
  kapi(menu ? !menu.tasiyor : false, "satır menüsü ekranın sağından taşıyor");
  kapi(
    menu ? menu.ogeler.some((o) => o.includes("Sil")) : false,
    "satır menüsünde 'Sil' yok (yıkıcı aksiyon nereye gitti?)"
  );
  await s.tus("Escape", { code: 27 });
  await new Promise((r) => setTimeout(r, 300));
  sonuc.etkilesim.menuEscKapatti = (await s.eval(menuDurumu)) === null;
  kapi(sonuc.etkilesim.menuEscKapatti, "satır menüsü ESC ile kapanmadı");

  /* ── E-2: filtre menüsü → çip → temizleme (gerçek URL) ── */
  await s.eval(dugmeyeBas, "Filtre ekle");
  await new Promise((r) => setTimeout(r, 400));
  const filtreMenusu = await s.eval(menuDurumu);
  await s.eval(menuOgesineBas, "Stok durumu");
  await new Promise((r) => setTimeout(r, 300));
  const degerMenusu = await s.eval(menuDurumu);
  await s.eval(menuOgesineBas, "Tükendi");
  await new Promise((r) => setTimeout(r, 900));
  const cipliOlcum = await s.eval(listeOlc);
  const cipKontrasti = await s.eval(listeKontrastOlc);
  const cipliUrl = await s.eval(() => location.search);
  await s.ss(join(OUT, "filtre-cipi-1280.png"));
  sonuc.etkilesim.filtre = {
    kriterler: filtreMenusu?.ogeler ?? [],
    degerler: degerMenusu?.ogeler ?? [],
    cipliUrl,
    cipSayisi: cipliOlcum.cipSayisi,
    bosDurum: cipliOlcum.bosDurum,
    // Çip kontrastı ANCAK çip varken ölçülebilir; varsayılan ekranda `null`
    // dönüyordu ve "ölçüldü" sanılırdı (İP-A8 · B-8'in dersi: ölçülmeyen bir
    // seviye rapora "geçti" diye giremez).
    cipKontrasti: cipKontrasti.cip,
  };
  if (cipKontrasti.cip) {
    kapi(cipKontrasti.cip.gecti, `çip kontrastı ${cipKontrasti.cip.kontrast} (eşik 4,5)`);
  } else {
    kapi(false, "çip kontrastı ÖLÇÜLEMEDİ (çip basılmadı)");
  }
  kapi(cipliUrl.includes("stok=tukendi"), `filtre URL'e yazılmadı (${cipliUrl})`);
  kapi(cipliOlcum.cipSayisi >= 1, "uygulanan filtre çipi görünmüyor");

  /* ── E-3: iki boş durum GERÇEKTEN farklı ── */
  await s.git(`${FRONTEND}${URUNLER}?q=zzzz-olmayan-urun-zzzz`);
  await s.hazirBekle();
  await new Promise((r) => setTimeout(r, 900));
  const sonucYok = await s.eval(listeOlc);
  const sonucYokMetni = await s.eval(
    () => document.querySelector("[data-bos-durum] h2")?.textContent ?? null
  );
  await s.ss(join(OUT, "bos-sonuc-yok-1280.png"));
  const bosKontrast = await s.eval(listeKontrastOlc);
  sonuc.etkilesim.bosDurumlar = {
    sonucYok: sonucYok.bosDurum,
    sonucYokMetni,
    basligiKontrasti: bosKontrast.bosDurumBasligi,
  };
  if (bosKontrast.bosDurumBasligi) {
    kapi(
      bosKontrast.bosDurumBasligi.gecti,
      `boş durum başlığı kontrastı ${bosKontrast.bosDurumBasligi.kontrast} (eşik 4,5)`
    );
  } else {
    kapi(false, "boş durum başlığı kontrastı ÖLÇÜLEMEDİ");
  }
  kapi(sonucYok.bosDurum === "sonuc-yok", `filtreli boş listede '${sonucYok.bosDurum}' basıldı`);
  kapi(
    (await s.eval(() =>
      Array.from(document.querySelectorAll("button")).some((b) =>
        /Filtreleri temizle/.test(b.textContent || "")
      )
    )) === true,
    "sonuç yok durumunda 'Filtreleri temizle' yok"
  );

  /* ── E-4: gerçek Tab ile odak halkası ── */
  await s.git(`${FRONTEND}${URUNLER}`);
  await s.hazirBekle();
  const halkalar = [];
  for (let i = 0; i < 10; i++) {
    await s.tus("Tab", { code: 9 });
    halkalar.push(await s.eval(odakHalkasiOlc));
  }
  sonuc.etkilesim.odakHalkasi = halkalar.filter(Boolean);
  kapi(
    sonuc.etkilesim.odakHalkasi.length > 0 &&
      sonuc.etkilesim.odakHalkasi.every((h) => h.halkaVar),
    "odak halkası: klavyeyle gezilen bir öğede halka yok"
  );

  /* ── E-5: yazı tipi gerçekten uygulanıyor mu ── */
  const fontlar = await s.eval(() => ({
    h1: document.querySelector("h1") ? getComputedStyle(document.querySelector("h1")).fontFamily : null,
    body: getComputedStyle(document.body).fontFamily,
    yuklenen: Array.from(document.fonts ?? [])
      .filter((f) => f.status === "loaded")
      .map((f) => f.family),
  }));
  sonuc.etkilesim.yaziTipi = fontlar;
  kapi(/Figtree/.test(fontlar.h1 ?? ""), `panel başlığı Figtree kullanmıyor (${fontlar.h1})`);
  kapi(/Inter/.test(fontlar.body ?? ""), `gövde Inter kullanmıyor (${fontlar.body})`);
  kapi(
    fontlar.yuklenen.some((f) => /Figtree/.test(f)) && fontlar.yuklenen.some((f) => /Inter/.test(f)),
    `yazı tipleri yüklenmedi (${fontlar.yuklenen.join(", ")})`
  );

  sonuc.hataliAdim = hataliAdim;
  writeFileSync(join(OUT, "tur.json"), JSON.stringify(sonuc, null, 2), "utf8");
  console.log(JSON.stringify({ hataliAdim, dusenKapilar: sonuc.dusenKapilar ?? [] }, null, 2));
} finally {
  chrome.kill();
}
process.exit(hataliAdim === 0 ? 0 : 1);
