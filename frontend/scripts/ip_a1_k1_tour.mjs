// İP-A1 · K1 storefront regresyon turu — GERÇEK TARAYICI (Chrome + CDP).
//
// Aynı sayfaları AÇIK ve KOYU temada gezer, ekran görüntüsü alır. İki kez
// koşturulur (`--etiket once` / `--etiket sonra`); `--karsilastir` piksel farkını
// ölçer. Fark göz kararı değil ölçümdür.
//
// Kullanım:
//   node scripts/ip_a1_k1_tour.mjs --frontend http://127.0.0.1:5199 --etiket once --out ./k1
//   node scripts/ip_a1_k1_tour.mjs --karsilastir --out ./k1
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] ?? "1"]);
    return acc;
  }, [])
);

const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5199";
const OUT = resolve(ARGS.out ?? "./k1");
const ETIKET = ARGS.etiket ?? "once";
const CHROME =
  ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9231);
const TOKEN = ARGS.token ?? "";

// Gezilecek yüzeyler. `tiklaMetin` verilirse sayfa yüklendikten sonra overlay açılır.
const SAYFALAR = [
  { ad: "01-landing", url: "/" },
  { ad: "02-marketplace", url: "/egitmenler" },
  { ad: "03-libraries", url: "/kutuphaneler" },
  { ad: "04-library-detail", url: "/kutuphaneler/bizim-kutuphane" },
  { ad: "05-store-list", url: "/magaza" },
  { ad: "06-store-product", url: "/magaza/urun/tyt-fizik-soru-kitabi-yz-yayinlari" },
  { ad: "07-tutor-detail", url: "/egitmenler", ilkKart: true },
  { ad: "08-admin-magaza", url: "/yonetim/magaza/urunler", admin: true },
  { ad: "09-admin-envanter", url: "/yonetim/envanter", admin: true },
  {
    ad: "10-kutuphane-overlay",
    url: "/kutuphaneler/bizim-kutuphane",
    tiklaMetin: "Rezervasyon|Koltuk|Yorum Yaz|Değerlendir",
  },
];

const log = (s) => console.log(s);

async function chromeBaslat(portEk = 0) {
  const port = PORT + portEk;
  const profil = join(OUT, `chrome-profil-${ETIKET}-${port}`);
  rmSync(profil, { recursive: true, force: true });
  mkdirSync(profil, { recursive: true });
  const p = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
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
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return { p, port };
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
    this.hatalar = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Runtime.exceptionThrown") {
        this.hatalar.push(
          m.params?.exceptionDetails?.exception?.description ?? "bilinmeyen"
        );
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
      }, 180000);
    });
  }
  async eval(fn, ...args) {
    const ifade = `(${fn.toString()})(${args
      .map((a) => JSON.stringify(a))
      .join(",")})`;
    const r = await this.gonder("Runtime.evaluate", {
      expression: `(async () => { return ${ifade}; })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      const d =
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
      throw new Error(`Sayfa içi hata: ${d}`);
    }
    return r.result.value;
  }
  async git(url) {
    await this.gonder("Page.navigate", { url });
    for (let i = 0; i < 80; i++) {
      if (await this.eval(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  async ekranGoruntusu(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
}

async function sayfaAc(port) {
  const hedefler = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const sekme = hedefler.find((t) => t.type === "page");
  const ws = new WebSocket(sekme.webSocketDebuggerUrl);
  await new Promise((coz, red) => {
    ws.addEventListener("open", coz, { once: true });
    ws.addEventListener("error", red, { once: true });
  });
  const s = new Sayfa(ws);
  await s.gonder("Page.enable");
  await s.gonder("Runtime.enable");
  return s;
}

/**
 * Kararlı kare bekleyicisi: veri gelene ve YÜKLENİYOR göstergeleri (pulse/spin)
 * durana kadar bekler. Sabit `sleep` yerine bu kullanılır; iskelet ekran
 * yakalamak öncesi/sonrası karşılaştırmasında YALANCI piksel farkı üretir.
 */
async function yuklemeBitsin(sayfa, { ms = 25000 } = {}) {
  const bitis = Date.now() + ms;
  await new Promise((r) => setTimeout(r, 2500));
  while (Date.now() < bitis) {
    const kosan = await sayfa.eval(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => a.animationName || "transition")
    );
    // `snow` sonsuz dekoratif animasyondur; beklemeyi kilitlememeli.
    const yukleniyor = kosan.filter((n) => n === "pulse" || n === "spin");
    if (yukleniyor.length === 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // Giriş animasyonlarının (fade-in/zoom-in) oturması için son bekleme.
  await new Promise((r) => setTimeout(r, 1500));
}

async function tur() {
  mkdirSync(join(OUT, ETIKET), { recursive: true });
  const { p: chrome, port } = await chromeBaslat();
  const rapor = [];
  try {
    const sayfa = await sayfaAc(port);
    // Isınma: Vite soğuk başlangıçta ilk gezinmeyi dakikalarca derleyebilir.
    await sayfa.git(`${FRONTEND}/`);
    await yuklemeBitsin(sayfa);
    if (TOKEN) {
      await sayfa.eval(
        (t) =>
          localStorage.setItem(
            "adana-auth",
            JSON.stringify({ state: { token: t }, version: 0 })
          ),
        TOKEN
      );
    }

    for (const tema of ["light", "dark"]) {
      await sayfa.eval(
        (t) =>
          localStorage.setItem(
            "adana-theme",
            JSON.stringify({ state: { preference: t }, version: 0 })
          ),
        tema
      );

      for (const s of SAYFALAR) {
        if (s.admin && !TOKEN) continue;
        const ad = `${s.ad}-${tema}.png`;
        try {
          await sayfa.git(`${FRONTEND}${s.url}`);
          await yuklemeBitsin(sayfa);

          if (s.ilkKart) {
            const gitti = await sayfa.eval(() => {
              const a = [
                ...document.querySelectorAll("a[href]"),
              ].find((x) => /^\/egitmenler\/.+/.test(x.getAttribute("href") || ""));
              if (!a) return false;
              a.click();
              return true;
            });
            if (!gitti) {
              rapor.push({ ad, ok: false, not: "eğitmen kartı bulunamadı" });
              log(`  ✗ ${ETIKET}/${ad} — eğitmen kartı yok`);
              continue;
            }
            await yuklemeBitsin(sayfa);
          }

          if (s.tiklaMetin) {
            const acildi = await sayfa.eval((desen) => {
              const re = new RegExp(desen, "i");
              const el = [
                ...document.querySelectorAll("button,a"),
              ].find((b) => re.test(b.textContent || ""));
              if (!el) return false;
              el.click();
              return true;
            }, s.tiklaMetin);
            if (!acildi) {
              rapor.push({ ad, ok: false, not: "overlay tetikleyicisi yok" });
              log(`  ✗ ${ETIKET}/${ad} — overlay tetikleyicisi yok`);
              continue;
            }
            await yuklemeBitsin(sayfa);
          }

          const kosanAnim = await sayfa.eval(() =>
            document
              .getAnimations()
              .filter((a) => a.playState === "running")
              .map((a) => a.animationName || "transition")
              .slice(0, 12)
          );
          const dark = await sayfa.eval(() =>
            document.documentElement.classList.contains("dark")
          );
          await sayfa.ekranGoruntusu(join(OUT, ETIKET, ad));
          rapor.push({ ad, ok: true, darkSinifi: dark, kosanAnim });
          log(
            `  ✓ ${ETIKET}/${ad}${
              kosanAnim.length ? ` [koşan anim: ${kosanAnim.join(",")}]` : ""
            }`
          );
        } catch (e) {
          rapor.push({ ad, ok: false, not: String(e.message).slice(0, 200) });
          log(`  ✗ ${ETIKET}/${ad} — ${e.message}`);
        }
      }
    }
    writeFileSync(
      join(OUT, `rapor-${ETIKET}.json`),
      JSON.stringify({ rapor, konsolHatalari: sayfa.hatalar }, null, 2)
    );
  } finally {
    chrome.kill();
  }
}

// İki klasördeki aynı adlı PNG'leri Chrome canvas'ında piksel piksel karşılaştırır.
async function karsilastir() {
  const { p: chrome, port } = await chromeBaslat(1);
  try {
    const sayfa = await sayfaAc(port);
    await sayfa.git("about:blank");
    const dosyalar = readdirSync(join(OUT, "once")).filter((f) =>
      f.endsWith(".png")
    );
    const sonuc = [];
    for (const f of dosyalar) {
      const b = join(OUT, "sonra", f);
      if (!existsSync(b)) {
        sonuc.push({ dosya: f, durum: "sonra YOK" });
        log(`  ${f}: sonra YOK`);
        continue;
      }
      const d = await sayfa.eval(
        async (aB64, bB64) => {
          const yukle = (b64) =>
            new Promise((res, rej) => {
              const img = new Image();
              img.onload = () => res(img);
              img.onerror = rej;
              img.src = "data:image/png;base64," + b64;
            });
          const [ia, ib] = await Promise.all([yukle(aB64), yukle(bB64)]);
          if (ia.width !== ib.width || ia.height !== ib.height) {
            return {
              boyutFarki: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`,
            };
          }
          const veri = (img) => {
            const cv = document.createElement("canvas");
            cv.width = img.width;
            cv.height = img.height;
            const cx = cv.getContext("2d");
            cx.drawImage(img, 0, 0);
            return cx.getImageData(0, 0, img.width, img.height).data;
          };
          const da = veri(ia);
          const db = veri(ib);
          let farkli = 0;
          let maxDelta = 0;
          for (let i = 0; i < da.length; i += 4) {
            const m = Math.max(
              Math.abs(da[i] - db[i]),
              Math.abs(da[i + 1] - db[i + 1]),
              Math.abs(da[i + 2] - db[i + 2])
            );
            if (m > 8) farkli++;
            if (m > maxDelta) maxDelta = m;
          }
          const toplam = da.length / 4;
          return {
            olcu: `${ia.width}x${ia.height}`,
            farkliPiksel: farkli,
            yuzde: +((farkli / toplam) * 100).toFixed(3),
            maxKanalFarki: maxDelta,
          };
        },
        readFileSync(join(OUT, "once", f)).toString("base64"),
        readFileSync(b).toString("base64")
      );
      sonuc.push({ dosya: f, ...d });
      log(`  ${f}: ${JSON.stringify(d)}`);
    }
    writeFileSync(join(OUT, "piksel-fark.json"), JSON.stringify(sonuc, null, 2));
  } finally {
    chrome.kill();
  }
}

if (ARGS.karsilastir) await karsilastir();
else await tur();
