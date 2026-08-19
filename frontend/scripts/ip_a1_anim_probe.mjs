// İP-A1 · Canlanan animasyon + kenarlık sondası (Chrome + CDP).
//
// Piksel karşılaştırması DİNGİN kareyi ölçer; "daha önce hiç animasyon olmayan
// bir yerde şimdi animasyon var mı" sorusuna cevap veremez. Bu sonda tam da onu
// ölçer: sayfa yüklendikten hemen sonra
//   · `animate-in/fade-in/zoom-in/slide-in-*` sınıfı taşıyan eleman sayısı
//   · bunlardan KAÇININ computed `animation-name` değeri "none" DEĞİL
//   · o anda gerçekten koşan animasyonlar
//   · `--border-base` değişkeninin çözülen değeri ve `*` kuralının etkisi
//
// Kullanım: node scripts/ip_a1_anim_probe.mjs --frontend http://127.0.0.1:5199 --etiket sonra --out ./k1
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
const OUT = resolve(ARGS.out ?? "./k1");
const ETIKET = ARGS.etiket ?? "sonra";
const CHROME =
  ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9241);
const TOKEN = ARGS.token ?? "";

const SAYFALAR = [
  { ad: "landing", url: "/" },
  { ad: "marketplace", url: "/egitmenler" },
  { ad: "libraries", url: "/kutuphaneler" },
  { ad: "library-detail", url: "/kutuphaneler/bizim-kutuphane" },
  { ad: "store-list", url: "/magaza" },
  { ad: "gorevler", url: "/gorevler", admin: true },
  { ad: "aliskanliklar", url: "/ogren/aliskanliklar", admin: true },
];

async function chromeBaslat() {
  const profil = join(OUT, `probe-profil-${ETIKET}`);
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
      "--window-size=1280,900",
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
      throw new Error(
        `Sayfa içi hata: ${
          r.exceptionDetails.exception?.description ?? r.exceptionDetails.text
        }`
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
}

async function sayfaAc() {
  const hedefler = await (
    await fetch(`http://127.0.0.1:${PORT}/json/list`)
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

const SONDA = () => {
  const ANIM = /(^|\s)(animate-in|fade-in|zoom-in|slide-in-from)/;
  const hepsi = [...document.querySelectorAll("*")];
  const sinifli = hepsi.filter((e) =>
    ANIM.test(typeof e.className === "string" ? e.className : "")
  );
  const canli = sinifli.filter(
    (e) => getComputedStyle(e).animationName !== "none"
  );
  const kokStil = getComputedStyle(document.documentElement);
  // `*` kuralının etkisi: hiçbir açık `border-*` sınıfı olmayan ama border-width'i
  // 0 olan elemanların border-color'ı. Değer değişse de görünmez; yine de raporla.
  const ornek = hepsi.slice(0, 400).map((e) => getComputedStyle(e).borderTopColor);
  const dagilim = {};
  for (const c of ornek) dagilim[c] = (dagilim[c] || 0) + 1;
  return {
    animSinifliEleman: sinifli.length,
    animationNameNoneDegil: canli.length,
    canliOrnek: canli
      .slice(0, 6)
      .map((e) => getComputedStyle(e).animationName + " | " + (typeof e.className === "string" ? e.className.slice(0, 70) : "")),
    kosanAnimasyon: document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => a.animationName || "transition")
      .slice(0, 12),
    borderBaseDegiskeni: kokStil.getPropertyValue("--border-base").trim() || "(tanımsız)",
    // Görünür kenarlığı olan (border-width > 0) eleman renk dağılımı:
    gorunurKenarlikRenkleri: Object.entries(
      hepsi.reduce((acc, e) => {
        const s = getComputedStyle(e);
        if (parseFloat(s.borderTopWidth) > 0) {
          acc[s.borderTopColor] = (acc[s.borderTopColor] || 0) + 1;
        }
        return acc;
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
    varsayilanRenkDagilimi: Object.entries(dagilim)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4),
  };
};

const chrome = await chromeBaslat();
try {
  const sayfa = await sayfaAc();
  await sayfa.git(`${FRONTEND}/`);
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
  const sonuc = {};
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
      await sayfa.git(`${FRONTEND}${s.url}`);
      // Animasyonu YAKALAMAK için kısa bekleme: 150-300 ms'lik giriş
      // animasyonları geçtikten sonra ölçmek onları görünmez kılar.
      await new Promise((r) => setTimeout(r, 900));
      const anlik = await sayfa.eval(SONDA);
      // İkinci ölçüm: veri geldikten sonra (liste kartları geç mount olur).
      await new Promise((r) => setTimeout(r, 4000));
      const gec = await sayfa.eval(SONDA);
      sonuc[`${s.ad}-${tema}`] = { erken: anlik, gec };
      console.log(
        `  ${s.ad}-${tema}: erken sinifli=${anlik.animSinifliEleman} canli=${anlik.animationNameNoneDegil} ` +
          `| gec sinifli=${gec.animSinifliEleman} canli=${gec.animationNameNoneDegil} ` +
          `| --border-base=${gec.borderBaseDegiskeni}`
      );
    }
  }
  writeFileSync(
    join(OUT, `anim-sonda-${ETIKET}.json`),
    JSON.stringify(sonuc, null, 2)
  );
} finally {
  chrome.kill();
}
