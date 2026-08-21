// Mağaza merge doğrulaması · Görev 1-2 — marka logosu taşıyan üç yüzeyin
// gerçek tarayıcı turu (Chrome + CDP).
//
// Merge turu `logo.png` → `logo.svg` geçişini yaptı; iki varlığın oranı aynı
// değil (PNG 890×140 = 6.36, SVG viewBox 977.21×136.5 = 7.16). Merge raporu
// "flex/shrink-0 olduğu için taşma görmedim" dedi — bu göz kararıdır. Bu tur
// aynı iddiayı px cinsinden ölçer:
//
//   • logo <img> getBoundingClientRect() genişliği/yüksekliği
//   • kapsayıcı (logo'nun ebeveyni + en yakın header/footer) genişliği
//   • kök scrollWidth > clientWidth (yatay taşma) ve taşma px'i
//   • logo ⟂ kategori şeridi bounding box KESİŞİMİ
//   • üç logonun aynı breakpoint'te aynı yükseklikte render edilmesi (Görev 2)
//   • konsol hatası / sayfa istisnası (Görev 2 · footer auth okuması)
//
// NEGATİF KONTROL (--negatif 1): logo genişliği sentetik olarak 3x şişirilir ve
// kapıların KIRMIZI düşmesi beklenir. Gerekçe: İP-A7d4'te sonda kontrastı
// yanlış öğede ölçüp "geçti" diyordu; sondanın gerçekten ölçtüğü kanıtlanmalı.
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/marka_logo_turu.mjs --frontend http://127.0.0.1:5199
//   node scripts/marka_logo_turu.mjs --frontend http://127.0.0.1:5199 --negatif 1
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
const NEGATIF = ARGS.negatif === "1";
const OUT = resolve(ARGS.out ?? "../docs/magaza-merge-dogrulama");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9296);
const GENISLIKLER = [360, 414, 768];
// Yükseklik karşılaştırması YALNIZ marka logolarını kapsar; iyzico ödeme
// rozeti (`/odeme/iyzico-logo-band*.svg`) bir marka lockup'ı değildir ve
// bilerek h-7'dir.
const MARKA_LOGOLARI = ["/logo.svg", "/logo-compact.svg", "/magaza-logo.svg"];

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
    this.konsol = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
        this.konsol.push({
          tur: m.params.type,
          metin: (m.params.args ?? [])
            .map((a) => a.value ?? a.description ?? a.type)
            .join(" ")
            .slice(0, 400),
        });
      }
      if (m.method === "Runtime.exceptionThrown") {
        this.konsol.push({
          tur: "exception",
          metin: (
            m.params.exceptionDetails?.exception?.description ??
            m.params.exceptionDetails?.text ??
            ""
          ).slice(0, 400),
        });
      }
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
    this.konsol = [];
    await this.gonder("Page.navigate", { url });
    for (let i = 0; i < 120; i++) {
      if (await this.eval(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    // `readyState === "complete"` YETMİYOR: sayfa bir React uygulamasıdır ve
    // Vite ilk (soğuk) istekte bağımlılıkları derlerken kök uzun süre boş
    // kalıyor. Sabit beklemeyle sonda BOŞ sayfayı ölçüp "görünür logo yok"
    // diyordu — yani kendi yalancı kırmızısını üretiyordu. Artık marka
    // logosunun DOM'a girmesi beklenir; girmezse ölçüm bunu bildirir.
    this.hazir = false;
    for (let i = 0; i < 80; i++) {
      this.hazir = await this.eval(
        () => !!document.querySelector('img[src*="logo"]')
      );
      if (this.hazir) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  async genislik(px) {
    await this.gonder("Emulation.setDeviceMetricsOverride", {
      width: px,
      height: 900,
      deviceScaleFactor: 1,
      mobile: px < 700,
    });
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
}

/* ── Sayfa içi ölçüm ─────────────────────────────────────────────── */

/** Logo genişliğini sentetik olarak şişirir — negatif kontrolün mutasyonu. */
const logoyuSisir = (kat) => {
  const hedef = Array.from(document.querySelectorAll("img")).filter(
    (el) => /logo/.test(el.getAttribute("src") || "") && el.getBoundingClientRect().width > 0
  );
  hedef.forEach((el) => {
    const r = el.getBoundingClientRect();
    el.style.width = `${r.width * kat}px`;
    el.style.maxWidth = "none";
    el.style.flexShrink = "0";
  });
  return hedef.length;
};

const markaOlc = () => {
  const yuvarla = (n) => Math.round(n * 10) / 10;
  const dikdortgen = (el) => {
    const r = el.getBoundingClientRect();
    return {
      genislik: yuvarla(r.width),
      yukseklik: yuvarla(r.height),
      sol: yuvarla(r.left),
      sag: yuvarla(r.right),
      ust: yuvarla(r.top),
      alt: yuvarla(r.bottom),
    };
  };
  const kesisim = (a, b) => {
    const g = Math.min(a.sag, b.sag) - Math.max(a.sol, b.sol);
    const y = Math.min(a.alt, b.alt) - Math.max(a.ust, b.ust);
    return g > 0.5 && y > 0.5 ? { genislik: yuvarla(g), yukseklik: yuvarla(y) } : null;
  };
  const birlesim = (elemanlar) => {
    const r = elemanlar.map(dikdortgen).filter((x) => x.genislik > 0 && x.yukseklik > 0);
    if (r.length === 0) return null;
    return {
      genislik: yuvarla(Math.max(...r.map((x) => x.sag)) - Math.min(...r.map((x) => x.sol))),
      yukseklik: yuvarla(Math.max(...r.map((x) => x.alt)) - Math.min(...r.map((x) => x.ust))),
      sol: yuvarla(Math.min(...r.map((x) => x.sol))),
      sag: yuvarla(Math.max(...r.map((x) => x.sag))),
      ust: yuvarla(Math.min(...r.map((x) => x.ust))),
      alt: yuvarla(Math.max(...r.map((x) => x.alt))),
      ogeSayisi: r.length,
    };
  };

  const kok = document.documentElement;

  // Kategori şeridi iki yüzeyde farklı bileşendir; ikisi de KENDİ öğelerinden
  // türetilir (sınıf adına bağlanmak kırılgan olurdu):
  //   • Landing  → CategoryBar: /icons/categories/*.webp taşıyan sekmeler
  //   • Mağaza   → StoreCategoryBar: ?category=<id> bağlantıları
  const landingSekmeleri = Array.from(
    document.querySelectorAll('img[src^="/icons/categories/"]')
  ).map((img) => img.closest("a,button") ?? img);
  const magazaLinkleri = Array.from(document.querySelectorAll('a[href*="category="]'));
  const seritOgeleri = landingSekmeleri.length ? landingSekmeleri : magazaLinkleri;
  const serit = birlesim(seritOgeleri);
  const seritKaynagi = landingSekmeleri.length
    ? "CategoryBar (/icons/categories)"
    : magazaLinkleri.length
      ? "StoreCategoryBar (a[href*=category=])"
      : null;

  const logolar = Array.from(document.querySelectorAll("img"))
    .filter((el) => /logo/.test(el.getAttribute("src") || ""))
    .map((el) => {
      const r = dikdortgen(el);
      const st = getComputedStyle(el);
      const kapsayici = el.parentElement ? dikdortgen(el.parentElement) : null;
      const bolge = el.closest("header, footer, nav");
      return {
        src: el.getAttribute("src"),
        alt: el.getAttribute("alt"),
        gorunur: r.genislik > 0 && r.yukseklik > 0,
        sinif: el.className,
        rect: r,
        computedHeight: st.height,
        kapsayici,
        // Kapsayıcıdan taşan logo: yerleşimi kendi kutusundan geniş.
        kapsayiciyiAsiyor: kapsayici ? r.genislik > kapsayici.genislik + 0.5 : null,
        bolge: bolge ? bolge.tagName.toLowerCase() : null,
        bolgeRect: bolge ? dikdortgen(bolge) : null,
        // Görünür alanı taşıyor mu (sağ kenar viewport'un dışına çıkıyor mu)
        gorunurAlaniAsiyor: r.sag > kok.clientWidth + 0.5,
        seritKesisimi: serit ? kesisim(r, serit) : null,
      };
    });

  return {
    gorunurGenislik: kok.clientWidth,
    govdeGenisligi: document.body.clientWidth,
    scrollWidth: kok.scrollWidth,
    clientWidth: kok.clientWidth,
    yatayTasma: kok.scrollWidth > kok.clientWidth,
    tasmaPiksel: Math.max(0, kok.scrollWidth - kok.clientWidth),
    seritKaynagi,
    serit,
    logolar,
  };
};


/* ── Görev 1 · çakışmanın KAYNAĞI: SVG mi getirdi, önceden de var mıydı ──
   Navbar logosu bu dalda `/logo.png` → `/logo.svg` oldu (429a475). İki varlık
   aynı yükseklikte farklı genişliktedir. Aynı DOM'da src'yi geçici olarak
   PNG'ye çevirip yeniden ölçmek, çakışmanın ne kadarının SVG'den geldiğini
   ayırır. DEPODA HİÇBİR ŞEY DEĞİŞMEZ — mutasyon yalnız sayfa içindedir. */
const navbarLogosunuDegistir = async (yeniSrc) => {
  const img = document.querySelector('header img[src*="logo"]:not([src*="compact"])');
  if (!img) return { hata: "navbar logosu bulunamadi" };
  const eski = img.getAttribute("src");
  img.setAttribute("src", yeniSrc);
  try {
    await img.decode();
  } catch {
    /* yok say */
  }
  await new Promise((r) => setTimeout(r, 250));
  return { eski, yeni: yeniSrc };
};


/** Navbar logosunu şeridin üstüne KAYDIRIR — kesişim dedektörünün provası.
    3x şişirme mutasyonu bu kapıyı prova ETMİYOR: logo genişleyince flex satırı
    da genişliyor, şerit sağa kaçıyor ve kesişim tesadüfen kayboluyor (ölçüldü:
    768'de şerit sol kenarı 143.6 → 829.2). Yani o mutasyon taşma kapısını
    kanıtlıyor, çakışma kapısını değil. Bu ikinci mutasyon logoyu YERİNDEN
    OYNATIR (transform; yerleşimi etkilemez) ve doğrudan şeridin üstüne taşır. */
const logoyuSeritUstuneKaydir = () => {
  const img = document.querySelector('header img[src*="logo"]:not([src*="compact"])');
  const sekme = document.querySelector('img[src^="/icons/categories/"]');
  if (!img || !sekme) return { hata: "logo veya serit yok" };
  const l = img.getBoundingClientRect();
  const t = sekme.closest("a,button")?.getBoundingClientRect() ?? sekme.getBoundingClientRect();
  const kaydir = t.left - l.left + 10;
  img.style.transform = `translateX(${kaydir}px)`;
  return { kaydirildi: Math.round(kaydir) };
};

/* ── Tur ─────────────────────────────────────────────────────────── */

const sonuc = {
  olculdu: new Date().toISOString(),
  kip: NEGATIF ? "negatif-kontrol (logo 3x sisirildi)" : "normal",
  genislikler: GENISLIKLER,
  ekranlar: {},
  konsol: {},
};
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
    `${FRONTEND}/scripts/probe/marka-logo-probe.html?ekran=${ekran}&koyu=${koyu}`;

  const EKRANLAR = ["anasayfa", "magaza", "magaza-oturum"];

  for (const ekran of EKRANLAR) {
    sonuc.ekranlar[ekran] = {};
    for (const genislik of GENISLIKLER) {
      await s.genislik(genislik);
      await s.git(adres(ekran, 0));
      if (NEGATIF) {
        const sisen = await s.eval(logoyuSisir, 3);
        kapi(sisen > 0, `${ekran}/${genislik}: negatif kontrol hiç logo bulamadı`);
        await new Promise((r) => setTimeout(r, 400));
      }
      const olcum = await s.eval(markaOlc);
      olcum.sayfaHazir = s.hazir;
      sonuc.ekranlar[ekran][genislik] = olcum;
      kapi(s.hazir, `${ekran}/${genislik}: sayfa hic render olmadi (logo DOM'a girmedi)`);
      sonuc.konsol[`${ekran}-${genislik}`] = s.konsol.slice();

      kapi(!olcum.yatayTasma, `${ekran}/${genislik}: yatay tasma (${olcum.tasmaPiksel}px)`);
      const gorunurLogolar = olcum.logolar.filter((l) => l.gorunur);
      kapi(gorunurLogolar.length > 0, `${ekran}/${genislik}: gorunur logo yok`);
      for (const l of gorunurLogolar) {
        kapi(
          !l.gorunurAlaniAsiyor,
          `${ekran}/${genislik}: ${l.src} gorunur alani asiyor (sag kenar ${l.rect.sag} > ${olcum.gorunurGenislik})`
        );
        kapi(
          !l.kapsayiciyiAsiyor,
          `${ekran}/${genislik}: ${l.src} kapsayicisini asiyor (${l.rect.genislik} > ${l.kapsayici?.genislik})`
        );
        kapi(
          !l.seritKesisimi,
          `${ekran}/${genislik}: ${l.src} kategori seridiyle cakisiyor (${JSON.stringify(l.seritKesisimi)})`
        );
      }
      await s.ss(join(OUT, `${ekran}-${genislik}${NEGATIF ? "-negatif" : ""}.png`));
    }
  }

  /* ── Görev 2: üç logonun aynı breakpoint'te aynı yüksekliği ── */
  // PublicNavbar + SiteFooter aynı sayfada (anasayfa), StoreLayout header +
  // SiteFooter aynı sayfada (magaza). Ortak breakpoint: 768 (md açık).
  const yukseklikler = {};
  for (const ekran of ["anasayfa", "magaza"]) {
    yukseklikler[ekran] = (sonuc.ekranlar[ekran][768].logolar ?? [])
      .filter((l) => l.gorunur && MARKA_LOGOLARI.includes(l.src))
      .map((l) => ({ src: l.src, bolge: l.bolge, yukseklik: l.rect.yukseklik }));
  }
  sonuc.yukseklikKarsilastirmasi = yukseklikler;
  if (!NEGATIF) {
    const hepsi = [...yukseklikler.anasayfa, ...yukseklikler.magaza];
    const benzersiz = [...new Set(hepsi.map((x) => x.yukseklik))];
    kapi(
      benzersiz.length === 1,
      `768px'te logo yukseklikleri esit degil: ${JSON.stringify(hepsi)}`
    );
  }

  /* ── Görev 1: çakışma taraması + SVG/PNG ayrıştırması ── */
  if (!NEGATIF) {
    const TARAMA = [640, 700, 768, 820, 900, 1024, 1280];
    sonuc.cakismaTaramasi = {};
    for (const g of TARAMA) {
      await s.genislik(g);
      await s.git(adres("anasayfa", 0));
      const svgOlcum = await s.eval(markaOlc);
      const navSvg = svgOlcum.logolar.find((l) => l.bolge === "header" && l.gorunur);
      sonuc.cakismaTaramasi[g] = {
        svg: navSvg
          ? {
              src: navSvg.src,
              genislik: navSvg.rect.genislik,
              sag: navSvg.rect.sag,
              seritSol: svgOlcum.serit ? svgOlcum.serit.sol : null,
              kesisim: navSvg.seritKesisimi,
            }
          : null,
      };
      // Aynı sayfada src'yi PNG'ye çevir ve yeniden ölç.
      const takas = await s.eval(navbarLogosunuDegistir, "/logo.png");
      const pngOlcum = await s.eval(markaOlc);
      const navPng = pngOlcum.logolar.find((l) => l.bolge === "header" && l.gorunur);
      sonuc.cakismaTaramasi[g].png = navPng
        ? {
            src: navPng.src,
            genislik: navPng.rect.genislik,
            sag: navPng.rect.sag,
            seritSol: pngOlcum.serit ? pngOlcum.serit.sol : null,
            kesisim: navPng.seritKesisimi,
          }
        : { hata: takas.hata || "olculemedi" };
    }
  }

  /* ── Negatif kontrol · 2. mutasyon: kesişim dedektörü ── */
  if (NEGATIF) {
    // 1280'de normalde çakışma YOKTUR (ölçüldü: şerit sol 440.2, logo sağ
    // 289.7). Önce bunu taban olarak doğrula, sonra logoyu şeridin üstüne
    // kaydırıp dedektörün KIRMIZI düşmesini bekle.
    await s.genislik(1280);
    await s.git(adres("anasayfa", 0));
    const taban = await s.eval(markaOlc);
    const tabanNav = taban.logolar.find((l) => l.bolge === "header" && l.gorunur);
    const kaydirma = await s.eval(logoyuSeritUstuneKaydir);
    await new Promise((r) => setTimeout(r, 300));
    const sonra = await s.eval(markaOlc);
    const sonraNav = sonra.logolar.find((l) => l.bolge === "header" && l.gorunur);
    sonuc.kesisimDedektoruProvasi = {
      tabanKesisim: tabanNav ? tabanNav.seritKesisimi : null,
      kaydirma,
      mutasyonSonrasiKesisim: sonraNav ? sonraNav.seritKesisimi : null,
      dedektorCalisti: !!(tabanNav && !tabanNav.seritKesisimi && sonraNav && sonraNav.seritKesisimi),
    };
    kapi(
      sonuc.kesisimDedektoruProvasi.dedektorCalisti,
      "kesisim dedektoru provasi: mutasyon yakalanmadi (dedektor atil)"
    );
    await s.ss(join(OUT, "kesisim-dedektoru-provasi.png"));
  }

  /* ── Görev 2: SiteFooter DOM'da gerçekten /logo.svg mi ── */
  await s.genislik(768);
  await s.git(adres("magaza-oturum", 0));
  sonuc.footerLogosu = await s.eval(() => {
    const f = document.querySelector("footer");
    const img = f ? f.querySelector("img[src*='logo']") : null;
    if (!img) return null;
    const st = getComputedStyle(img);
    return {
      src: img.getAttribute("src"),
      sinif: img.className,
      computedHeight: st.height,
      rectYuksekligi: Math.round(img.getBoundingClientRect().height * 10) / 10,
    };
  });
  kapi(sonuc.footerLogosu?.src === "/logo.svg", "footer logosu DOM'da /logo.svg degil");
  sonuc.footerKonsolu = s.konsol.slice();
  kapi(
    sonuc.footerKonsolu.length === 0,
    `footer/magaza-oturum: konsol kaydi var (${JSON.stringify(sonuc.footerKonsolu).slice(0, 300)})`
  );

  sonuc.hataliAdim = hataliAdim;
  writeFileSync(
    join(OUT, `marka-logo-olcum${NEGATIF ? "-negatif" : ""}.json`),
    JSON.stringify(sonuc, null, 2)
  );
  console.log(
    JSON.stringify({ kip: sonuc.kip, hataliAdim, dusenKapilar: sonuc.dusenKapilar }, null, 2)
  );
} finally {
  chrome.kill();
}
