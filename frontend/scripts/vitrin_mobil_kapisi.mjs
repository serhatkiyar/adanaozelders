// VITRIN MOBIL KAPISI - gercek Chrome, gercek CSS duzeni.
//
// NEDEN VITEST DEGIL: bu bir YERLESIM hatasi. jsdom kutu modeli hesaplamaz;
// `scrollWidth`/`clientWidth` orada hep 0'dir. "Yatay tasma yok" iddiasinin
// tek gecerli kaniti gercek tarayicidir (CLAUDE.md F).
//
// Yakaladigi hata (B-1, olculdu 24 Agu 2026): /magaza 390 px'de 1360 px
// genislige buyuyordu (970 px tasma). Kok neden: vitrin bloklarinin ortak
// kabi `mx-auto ...` ile bir KOLON FLEX ogesi; capraz eksende `auto` kenar
// bosluklari flex `stretch`'i IPTAL eder, boylece bolum 390 px'e uzamak
// yerine icerigine gore (yatay kaydirmali kart seridinin max-content
// genisligi) buyur. Duzeltme kabin acik `w-full` almasidir.
//
// Kullanim (frontend/):
//   node scripts/vitrin_mobil_kapisi.mjs --frontend http://localhost:5173
//
// NOT: adres `localhost` olmali - backend CORS yalniz onu taniyor;
// `127.0.0.1` ile sayfa veri alamaz ve kapi YALANCI YESIL verir (bos sayfa
// tasmaz). Kapi bu yuzden veri geldigini de dogrular.
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
const FRONTEND = ARGS.frontend ?? "http://localhost:5173";
const OUT = resolve(ARGS.out ?? "../docs/vitrin-p0");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9491);
const GENISLIKLER = [360, 390, 414, 768];

async function chromeBaslat() {
  const profil = join(tmpdir(), `vitrin-mobil-kapisi-${process.pid}`);
  rmSync(profil, { recursive: true, force: true });
  mkdirSync(profil, { recursive: true });
  const p = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profil}`,
      "--no-first-run",
      "--disable-gpu",
      "--hide-scrollbars",
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
  throw new Error("Chrome DevTools portu acilmadi");
}

const chrome = await chromeBaslat();
const dusenler = [];
const sonuclar = [];
try {
  mkdirSync(OUT, { recursive: true });
  // Hedef ACIKCA http(s) olmali: `type === "page"` tek basina bir Chrome
  // EKLENTISININ arka plan sayfasini da yakaliyor (olculdu) ve kapi o zaman
  // bos bir belgeyi olcup YALANCI YESIL verir.
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const hedef = hedefler.find(
    (t) => t.type === "page" && /^https?:|^about:blank/.test(t.url ?? "")
  );
  if (!hedef) throw new Error("Olculecek sayfa sekmesi bulunamadi");
  const ws = new WebSocket(hedef.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pend = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      const { c, r } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? r(new Error(JSON.stringify(m.error))) : c(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((c, r) => {
      const i = ++id;
      pend.set(i, { c, r });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  const ev = async (fn) => {
    const r = await send("Runtime.evaluate", {
      expression: `(${fn.toString()})()`,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  for (const genislik of GENISLIKLER) {
    // TAZE yukleme: once daraltip SONRA gitmek sart. Genis yukleyip daraltmak
    // farkli bir seyi olcer (yeniden duzenleme), gercek telefonu degil.
    await send("Emulation.setDeviceMetricsOverride", {
      width: genislik,
      height: 900,
      deviceScaleFactor: 1,
      mobile: genislik < 700,
    });
    await send("Page.navigate", { url: `${FRONTEND}/magaza` });
    for (let i = 0; i < 120; i++) {
      if (await ev(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 2600));

    const olcum = await ev(() => {
      const kok = document.documentElement;
      const gorunur = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      // Tasan elemani ADIYLA bildir: "970 px tasma" cumlesi hangi eleman
      // oldugunu soylemezse duzeltilemez bir olcumdur.
      const suclular = [];
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > kok.clientWidth + 1) {
          const kirpan = el.parentElement?.closest(
            ".overflow-x-auto,.overflow-auto,.overflow-hidden,.overflow-x-hidden"
          );
          if (kirpan) continue; // kaydirma kabinin ICI tasabilir, bu normaldir
          suclular.push({
            etiket: el.tagName.toLowerCase(),
            sinif: (el.className?.toString?.() ?? "").slice(0, 80),
            genislik: Math.round(r.width),
          });
        }
      }
      return {
        govde: kok.clientWidth,
        scrollWidth: kok.scrollWidth,
        tasma: Math.max(0, kok.scrollWidth - kok.clientWidth),
        // YALANCI YESIL NOBETCISI: veri gelmediyse sayfa zaten tasmaz.
        vitrinBloguVar:
          Array.from(document.querySelectorAll("h2")).filter(gorunur).length > 0 ||
          Array.from(document.querySelectorAll("img")).filter(gorunur).length > 2,
        suclular: suclular.slice(0, 6),
      };
    });
    sonuclar.push({ genislik, ...olcum });
    const ok = olcum.tasma === 0 && olcum.vitrinBloguVar;
    console.log(
      `${ok ? "GECTI" : "DUSTU"}  ${genislik}px  tasma=${olcum.tasma}  vitrinBloguVar=${olcum.vitrinBloguVar}` +
        (olcum.suclular.length ? `  suclu=${JSON.stringify(olcum.suclular[0])}` : "")
    );
    if (!olcum.vitrinBloguVar)
      dusenler.push(`${genislik}px: vitrin blogu hic basilmadi (veri gelmedi mi? CORS?)`);
    if (olcum.tasma > 0)
      dusenler.push(
        `${genislik}px: yatay tasma ${olcum.tasma}px - ilk suclu ${JSON.stringify(olcum.suclular[0] ?? null)}`
      );
    if (genislik === 390) {
      const ss = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(OUT, "kapi-390.png"), Buffer.from(ss.data, "base64"));
    }
  }
  writeFileSync(join(OUT, "mobil-kapi.json"), JSON.stringify({ sonuclar, dusenler }, null, 2));
} finally {
  chrome.kill();
}

if (dusenler.length) {
  console.error(`\nKAPI DUSTU (${dusenler.length}):`);
  for (const d of dusenler) console.error("  - " + d);
  process.exit(1);
}
console.log("\nKAPI GECTI: vitrin hicbir genislikte yatay tasma uretmiyor.");
