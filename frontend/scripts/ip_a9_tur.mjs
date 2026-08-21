// İP-A9 — iki canlı kusurun gerçek tarayıcı turu (Chrome + CDP).
//
//   TB-71 · `/magaza`da oturum kapalıyken "Giriş yap" penceresi açılıp
//           kapandıktan sonra sayfa kaydırılabilmeli (3 tur).
//   TB-72 · Kirli form bekçisinde "Çık" seçilince DÜZENLEME PENCERESİ de
//           kapanmalı — üç kapatma yolunda da (Vazgeç düğmesi, ESC, dış tıklama).
//
// TB-72 sondası hiçbir sunucuya bağlanmaz (`scripts/probe/tb72-probe.html`).
// TB-71 gerçek `/magaza` sayfasında ölçülür: kusurun görüldüğü yol uygulama
// içi gezinmedir ve yalnız gerçek kabuk + gerçek yükseklikle üretilebilir.
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/ip_a9_tur.mjs --frontend http://127.0.0.1:5199
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
const OUT = resolve(ARGS.out ?? "../docs/ip-a9");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9299);

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
      "--force-device-scale-factor=1",
      "--window-size=1280,800",
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
    // Tarayıcı istemleri (`beforeunload`) turu ASMASIN: kirli form bekçisi
    // korumalıyken `Page.navigate` istemin cevabını bekler ve CDP zaman
    // aşımına düşer. İstem görülürse SAYILIR (kusur kanıtı olabilir) ve
    // onaylanır.
    this.istemler = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Page.javascriptDialogOpening") {
        this.istemler.push(m.params.type);
        this.gonder("Page.handleJavaScriptDialog", { accept: true });
        return;
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
  /**
   * GERÇEK fare tıklaması. `element.click()` DEĞİL: Radix'in modal katmanı
   * arka plana `pointer-events: none` yazar ve sentetik `click()` o kilidi
   * hiç görmez — kusur tam olarak orada saklanabilirdi.
   */
  async tikla(x, y) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.gonder("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        clickCount: 1,
        buttons: type === "mousePressed" ? 1 : 0,
      });
    }
  }
  async tus(key, kod) {
    for (const type of ["keyDown", "keyUp"]) {
      await this.gonder("Input.dispatchKeyEvent", {
        type,
        key,
        code: key,
        windowsVirtualKeyCode: kod,
        nativeVirtualKeyCode: kod,
      });
    }
  }
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Metnini İÇEREN görünür bir öğenin merkez koordinatı (büyük/küçük harf duyarsız). */
const merkezIceren = (secici, metin) => {
  const kucuk = metin.toLocaleLowerCase("tr");
  const adaylar = [...document.querySelectorAll(secici)].filter(
    (e) =>
      (e.textContent || "").toLocaleLowerCase("tr").includes(kucuk) &&
      e.getClientRects().length > 0
  );
  // GÖRÜNÜR ALANDAKİ aday seçilir. Aksi hâlde koordinat tıklaması sayfanın
  // çok altındaki bir eşe (ör. footer'daki ikinci "Giriş Yap") gider ve
  // ekranda hiçbir şey olmaz — ölçüm sessizce boşa çıkardı.
  const e =
    adaylar.find((a) => {
      const r = a.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    }) ?? adaylar[adaylar.length - 1];
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
};

/** Metnine göre görünür bir öğenin merkez koordinatı (yoksa null). */
const merkez = (secici, metin) => {
  const adaylar = [...document.querySelectorAll(secici)].filter(
    (e) => (e.textContent || "").trim() === metin && e.getClientRects().length > 0
  );
  const e = adaylar[adaylar.length - 1];
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
};

/* ══════════════════════ TB-71 ══════════════════════ */

const magazaOlc = () => ({
  dialogSayisi: document.querySelectorAll('[role="dialog"]').length,
  overflow: document.body.style.overflow,
  hesaplananOverflow: getComputedStyle(document.body).overflow,
  scrollHeight: document.documentElement.scrollHeight,
  innerHeight: window.innerHeight,
  kaydirilabilir: document.documentElement.scrollHeight > window.innerHeight,
});

/**
 * Kaydırma GERÇEKTEN çalışıyor mu.
 *
 * `behavior: "instant"` şart: `index.css` `html`e `scroll-behavior: smooth`
 * yazıyor ve yumuşak kaydırmada `scrollY` çağrının hemen ardından hâlâ 0'dır
 * — ölçüm, kilit açık olsa bile "kaydırılamadı" derdi (ölçüm aracının kendi
 * yalancı kırmızısı).
 */
const kaydirmaDenemesi = async () => {
  window.scrollTo({ top: 400, behavior: "instant" });
  await new Promise((r) => setTimeout(r, 300));
  return window.scrollY;
};

/* ══════════════════════ TB-72 ══════════════════════ */

const sondaDurumu = () => {
  const pencere = document.querySelector('[role="dialog"]');
  const miktar = document.querySelector('input[type="number"]');
  return {
    yuzeyAcik: document.getElementById("sonda-durum")?.dataset.acik === "1",
    dialogSayisi: document.querySelectorAll('[role="dialog"]').length,
    alertdialogSayisi: document.querySelectorAll('[role="alertdialog"]').length,
    pencereGorunur: !!pencere && pencere.getClientRects().length > 0,
    miktar: miktar ? miktar.value : null,
    overflow: document.body.style.overflow,
    bodyPointerEvents: document.body.style.pointerEvents,
  };
};

const miktarYaz = (deger) => {
  const g = document.querySelector('input[type="number"]');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(g, deger);
  g.dispatchEvent(new Event("input", { bubbles: true }));
};

const chrome = await chromeBaslat();
const sonuc = { tb71: [], tb72: [] };
const sorunlar = [];
try {
  mkdirSync(OUT, { recursive: true });
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const hedef = hedefler.find((t) => t.type === "page");
  const ws = new WebSocket(hedef.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const s = new Sayfa(ws);
  await s.gonder("Page.enable");
  await s.gonder("Runtime.enable");

  /* ── TB-71: /magaza, oturum kapalı, üç tur ── */
  await s.git(`${FRONTEND}/magaza`);
  await bekle(2000);
  await s.eval(() => {
    localStorage.clear();
    return true;
  });
  await s.git(`${FRONTEND}/magaza`);
  await bekle(4000);

  const baslangic = await s.eval(magazaOlc);
  sonuc.tb71Baslangic = baslangic;
  if (!baslangic.kaydirilabilir)
    sorunlar.push("TB-71 ölçümü GEÇERSİZ: /magaza zaten kaydırılamıyor (sayfa kısa)");

  for (let tur = 1; tur <= 3; tur++) {
    const girisNoktasi = await s.eval(merkezIceren, 'a[href*="modal=login"], button', "Giriş Yap");
    if (!girisNoktasi) {
      sorunlar.push(`TB-71 tur ${tur}: "Giriş yap" bulunamadı — ölçüm geçersiz`);
      break;
    }
    await s.tikla(girisNoktasi.x, girisNoktasi.y);
    await bekle(1500);
    const acikken = await s.eval(magazaOlc);

    await s.tus("Escape", 27);
    await bekle(1500);
    const kapandiktanSonra = await s.eval(magazaOlc);
    await s.eval(() => window.scrollTo(0, 0));
    const kaydirma = await s.eval(kaydirmaDenemesi);
    await s.eval(() => window.scrollTo(0, 0));

    sonuc.tb71.push({ tur, acikken, kapandiktanSonra, kaydirmaSonrasiScrollY: kaydirma });

    if (acikken.dialogSayisi !== 1)
      sorunlar.push(`TB-71 tur ${tur}: açık pencere sayısı ${acikken.dialogSayisi} (beklenen 1)`);
    if (kapandiktanSonra.dialogSayisi !== 0)
      sorunlar.push(`TB-71 tur ${tur}: pencere kapanmadı (${kapandiktanSonra.dialogSayisi})`);
    if (kapandiktanSonra.overflow === "hidden")
      sorunlar.push(`TB-71 tur ${tur}: body.style.overflow "hidden" kaldı`);
    if (kaydirma <= 0)
      sorunlar.push(`TB-71 tur ${tur}: sayfa kaydırılamadı (scrollY=${kaydirma})`);
  }
  await s.ss(join(OUT, "tb71-magaza.png"));

  /* ── TB-72: üç kapatma yolu × "Çık" ── */
  const YOLLAR = [
    { ad: "Vazgeç düğmesi", tip: "vazgec" },
    { ad: "ESC", tip: "esc" },
    { ad: "dış tıklama", tip: "dis" },
  ];

  for (const yol of YOLLAR) {
    await s.git(`${FRONTEND}/scripts/probe/tb72-probe.html`);
    await bekle(3000);
    const ac = await s.eval(merkez, "button", "Hasara ayır");
    if (!ac) {
      sorunlar.push(`TB-72 [${yol.ad}]: sonda açılmadı`);
      continue;
    }
    await s.tikla(ac.x, ac.y);
    await bekle(1000);
    await s.eval(miktarYaz, "3");
    await bekle(800);

    if (yol.tip === "vazgec") {
      const n = await s.eval(merkez, "button", "Vazgeç");
      await s.tikla(n.x, n.y);
    } else if (yol.tip === "esc") {
      await s.tus("Escape", 27);
    } else {
      const p = await s.eval(() => {
        const b = document.querySelector('[aria-label="Pencereyi kapat"]');
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + 10), y: Math.round(r.top + 10) };
      });
      await s.tikla(p.x, p.y);
    }
    await bekle(1500);

    const istem = await s.eval(sondaDurumu);
    if (istem.alertdialogSayisi !== 1) {
      sorunlar.push(`TB-72 [${yol.ad}]: onay istemi açılmadı — ölçüm geçersiz`);
      sonuc.tb72.push({ yol: yol.ad, istem });
      continue;
    }

    const cik = await s.eval(merkez, "button", "Çık");
    if (!cik) {
      sorunlar.push(`TB-72 [${yol.ad}]: "Çık" düğmesi bulunamadı`);
      sonuc.tb72.push({ yol: yol.ad, istem });
      continue;
    }
    await s.tikla(cik.x, cik.y);
    await bekle(2500);
    const sonra = await s.eval(sondaDurumu);
    sonuc.tb72.push({ yol: yol.ad, istem, sonra });
    await s.ss(join(OUT, `tb72-${yol.tip}.png`));

    if (sonra.yuzeyAcik) sorunlar.push(`TB-72 [${yol.ad}]: yüzey hâlâ AÇIK`);
    if (sonra.pencereGorunur)
      sorunlar.push(`TB-72 [${yol.ad}]: düzenleme penceresi hâlâ görünür`);
    if (sonra.overflow === "hidden")
      sorunlar.push(`TB-72 [${yol.ad}]: body.style.overflow "hidden" kaldı`);
  }

  /* ── TB-72b: GERÇEK ekran (`/yonetim/envanter/hasar`) ──
   *
   * Sonda sayfası kusuru üretmedi; TB-72 kaydı gerçek panel ekranında
   * ölçülmüştü. Fark ekranın kendisindedir (rota, sorgu, yönetim kabuğu), bu
   * yüzden ölçüm ORADA tekrarlanır. Oturum API'den alınan gerçek admin
   * token'ıyla kurulur; hiçbir veri YAZILMAZ (form gönderilmez). */
  if (ARGS.token) {
    for (const yol of YOLLAR) {
      await s.git(`${FRONTEND}/`);
      await s.eval(
        (t) => {
          localStorage.setItem("adana-auth", JSON.stringify({ state: { token: t }, version: 0 }));
          return true;
        },
        ARGS.token
      );
      await s.git(`${FRONTEND}/yonetim/envanter/hasar`);
      await bekle(5000);
      const ac = await s.eval(merkezIceren, "button", "Hasara ayır");
      if (!ac) {
        sorunlar.push("TB-72b: hasar ekranı açılmadı — ölçüm geçersiz");
        break;
      }
      await s.tikla(ac.x, ac.y);
      await bekle(1500);
      await s.eval(miktarYaz, "3");
      await bekle(1000);

      if (yol.tip === "vazgec") {
        const n = await s.eval(merkez, "button", "Vazgeç");
        await s.tikla(n.x, n.y);
      } else if (yol.tip === "esc") {
        await s.tus("Escape", 27);
      } else {
        const p = await s.eval(() => {
          const b = document.querySelector('[aria-label="Pencereyi kapat"]');
          const r = b.getBoundingClientRect();
          return { x: Math.round(r.left + 10), y: Math.round(r.top + 10) };
        });
        await s.tikla(p.x, p.y);
      }
      await bekle(1500);
      const istem = await s.eval(sondaDurumu);
      if (istem.alertdialogSayisi !== 1) {
        sorunlar.push(`TB-72b [${yol.ad}]: onay istemi açılmadı — ölçüm geçersiz`);
        sonuc.tb72.push({ yol: `gerçek ekran · ${yol.ad}`, istem });
        continue;
      }
      const cik = await s.eval(merkez, "button", "Çık");
      if (!cik) {
        sorunlar.push(`TB-72b [${yol.ad}]: "Çık" bulunamadı`);
        continue;
      }
      await s.tikla(cik.x, cik.y);
      await bekle(3000);
      const sonra = await s.eval(sondaDurumu);
      sonuc.tb72.push({ yol: `gerçek ekran · ${yol.ad}`, istem, sonra });
      await s.ss(join(OUT, `tb72-gercek-${yol.tip}.png`));
      if (sonra.pencereGorunur)
        sorunlar.push(`TB-72b [${yol.ad}]: düzenleme penceresi hâlâ görünür`);
      if (sonra.overflow === "hidden")
        sorunlar.push(`TB-72b [${yol.ad}]: body.style.overflow "hidden" kaldı`);
    }
  } else {
    sorunlar.push("TB-72b atlandı: --token verilmedi (gerçek ekran ölçülmedi)");
  }

  writeFileSync(join(OUT, "ip-a9-tur.json"), JSON.stringify({ sonuc, sorunlar }, null, 2));
  console.log(JSON.stringify(sonuc, null, 2));
  if (sorunlar.length) {
    console.error("SORUN:\n- " + sorunlar.join("\n- "));
    process.exit(2);
  }
  console.log("İP-A9 turu: SORUN YOK.");
  process.exit(0);
} finally {
  chrome.kill();
}
