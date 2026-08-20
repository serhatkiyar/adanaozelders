// İP-A1 · Modal giriş animasyonu sondası (Chrome + CDP).
//
// `zoom-in-95` / `slide-in-from-*` sınıfları YALNIZ modal açılışında DOM'a girer;
// sayfa turu bunlara hiç dokunmaz. Bu sonda modalı açar ve açılıştan hemen sonra
// (~120 ms) ölçer: sınıf canlı mı, kaç kare boyunca sürüyor, açılış anındaki
// dönüşüm (transform/opacity) ne. Ayrıca açılış anının ekran görüntüsünü alır —
// dingin kare karşılaştırması bu farkı göremez.
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
const PORT = Number(ARGS.port ?? 9251);

const HEDEFLER = [
  {
    ad: "share-modal",
    url: "/kutuphaneler/bizim-kutuphane",
    ac: () => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        /paylaş/i.test(x.getAttribute("aria-label") || x.title || "")
      );
      if (!b) return false;
      b.click();
      return true;
    },
  },
  {
    ad: "auth-modal",
    url: "/magaza",
    ac: () => {
      const b = [...document.querySelectorAll("button,a")].find((x) =>
        /giriş yap/i.test(x.textContent || "")
      );
      if (!b) return false;
      b.click();
      return true;
    },
  },
];

async function chromeBaslat() {
  const profil = join(OUT, `modal-profil-${ETIKET}`);
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
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
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

const OLC = () => {
  const ANIM = /(^|\s)(animate-in|zoom-in|slide-in-from|fade-in)/;
  const el = [...document.querySelectorAll("*")].filter((e) =>
    ANIM.test(typeof e.className === "string" ? e.className : "")
  );
  return {
    sinifliEleman: el.length,
    detay: el.slice(0, 6).map((e) => {
      const s = getComputedStyle(e);
      return {
        sinif: (typeof e.className === "string" ? e.className : "").slice(0, 90),
        animationName: s.animationName,
        animationDuration: s.animationDuration,
        transform: s.transform,
        opacity: s.opacity,
      };
    }),
    kosan: document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => a.animationName || "transition"),
  };
};

mkdirSync(join(OUT, `modal-${ETIKET}`), { recursive: true });
const chrome = await chromeBaslat();
const rapor = {};
try {
  const sayfa = await sayfaAc();
  await sayfa.git(`${FRONTEND}/`);
  await new Promise((r) => setTimeout(r, 5000));
  for (const tema of ["light", "dark"]) {
    await sayfa.eval(
      (t) =>
        localStorage.setItem(
          "adana-theme",
          JSON.stringify({ state: { preference: t }, version: 0 })
        ),
      tema
    );
    for (const h of HEDEFLER) {
      const anahtar = `${h.ad}-${tema}`;
      try {
        await sayfa.git(`${FRONTEND}${h.url}`);
        await new Promise((r) => setTimeout(r, 5000));
        const acildi = await sayfa.eval(h.ac);
        if (!acildi) {
          rapor[anahtar] = { hata: "tetikleyici bulunamadı" };
          console.log(`  ✗ ${anahtar} — tetikleyici yok`);
          continue;
        }
        // Açılıştan HEMEN sonra: animasyon devam ederken.
        await new Promise((r) => setTimeout(r, 120));
        const acilis = await sayfa.eval(OLC);
        await sayfa.ss(join(OUT, `modal-${ETIKET}`, `${anahtar}-acilis.png`));
        // Dingin hâl.
        await new Promise((r) => setTimeout(r, 1500));
        const dingin = await sayfa.eval(OLC);
        await sayfa.ss(join(OUT, `modal-${ETIKET}`, `${anahtar}-dingin.png`));
        rapor[anahtar] = { acilis, dingin };
        console.log(
          `  ✓ ${anahtar} — açılışta koşan: [${acilis.kosan.join(",")}] ` +
            `anim=${acilis.detay[0]?.animationName} transform=${acilis.detay[0]?.transform}`
        );
      } catch (e) {
        rapor[anahtar] = { hata: String(e.message).slice(0, 200) };
        console.log(`  ✗ ${anahtar} — ${e.message}`);
      }
    }
  }
  writeFileSync(
    join(OUT, `modal-sonda-${ETIKET}.json`),
    JSON.stringify(rapor, null, 2)
  );
} finally {
  chrome.kill();
}
