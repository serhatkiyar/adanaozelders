// PANEL UYARI KAPISI - gercek Chrome, gercek oturum, gercek API.
//
// NEDEN VAR (B-2b): backend blok basina `warnings` uretiyordu, yanitla
// gonderiyordu ve panel bunu taslak kurarken ATIYORDU; hicbir yerde
// basilmiyordu. Yani yonetici "bu kart hicbir yere gitmiyor" veya "N sabit
// urun gizlendi" uyarilarini HIC gormuyordu.
//
// Vitest bunu kanitlayamaz: bilesen testi uyarinin BASILDIGINI gosterir,
// ama panelin onizleme verisinden uyariyi GERCEKTEN cekip bagladigini
// gostermez. Kapi bu yuzden gercek panelde, gercek veriyle kosar.
//
// Kullanim (frontend/):
//   P0_EPOSTA=... P0_SIFRE=... node scripts/vitrin_panel_uyari_kapisi.mjs \
//     --frontend http://localhost:5174
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
const FRONTEND = ARGS.frontend ?? "http://localhost:5174";
const OUT = resolve(ARGS.out ?? "../docs/vitrin-p0");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9495);
const EPOSTA = ARGS.eposta ?? process.env.P0_EPOSTA;
const SIFRE = ARGS.sifre ?? process.env.P0_SIFRE;
if (!EPOSTA || !SIFRE) {
  console.error("P0_EPOSTA ve P0_SIFRE gerekli.");
  process.exit(2);
}

const profil = join(tmpdir(), `panel-uyari-${process.pid}`);
rmSync(profil, { recursive: true, force: true });
mkdirSync(profil, { recursive: true });
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profil}`,
    "--no-first-run",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1400,1100",
    "about:blank",
  ],
  { stdio: "ignore" }
);
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break;
  } catch {
    /* bekle */
  }
  await new Promise((r) => setTimeout(r, 200));
}

const dusenler = [];
try {
  mkdirSync(OUT, { recursive: true });
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
  const ev = async (fn, ...a) => {
    const r = await send("Runtime.evaluate", {
      expression: `(async () => { return (${fn.toString()})(${a.map((x) => JSON.stringify(x)).join(",")}); })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const git = async (url) => {
    await send("Page.navigate", { url });
    for (let i = 0; i < 120; i++) {
      if (await ev(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 2600));
  };

  await git(`${FRONTEND}/giris`);
  await ev(
    (eposta, sifre) => {
      const yaz = (el, deger) => {
        const proto =
          el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
        Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, deger);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const e = document.querySelector('input[type="email"], input[name="email"]');
      const p = document.querySelector('input[type="password"]');
      yaz(e, eposta);
      yaz(p, sifre);
      const f = p.closest("form");
      f.requestSubmit ? f.requestSubmit() : f.querySelector('button[type="submit"]')?.click();
      return true;
    },
    EPOSTA,
    SIFRE
  );
  await new Promise((r) => setTimeout(r, 3500));

  await git(`${FRONTEND}/yonetim/magaza/ana-sayfa`);

  // Once listede uyari sayaci gorunmeli, sonra hedefsiz blok secilince
  // uyarinin METNI basilmali. Ikisi ayri iddia: sayac gorunup metin
  // basilmayabilir.
  const listeDurumu = await ev(() => {
    const dugmeler = Array.from(document.querySelectorAll("button"));
    const uyariliBloklar = dugmeler.filter((b) => /\d+\s*uyarı/.test(b.textContent ?? ""));
    return {
      blokDugmesiSayisi: dugmeler.filter((b) => /^\s*\d+\./.test(b.textContent ?? "")).length,
      uyariliBlokSayisi: uyariliBloklar.length,
      ilkUyariliMetin: uyariliBloklar[0]?.textContent?.trim().slice(0, 80) ?? null,
    };
  });
  console.log("liste:", JSON.stringify(listeDurumu));
  if (listeDurumu.blokDugmesiSayisi === 0)
    dusenler.push("panelde hic blok listelenmedi (veri gelmedi mi?)");
  if (listeDurumu.uyariliBlokSayisi === 0)
    dusenler.push("blok listesinde hicbir uyari sayaci gorunmuyor");

  const secim = await ev(() => {
    const dugme = Array.from(document.querySelectorAll("button")).find((b) =>
      /\d+\s*uyarı/.test(b.textContent ?? "")
    );
    if (!dugme) return { secildi: false };
    dugme.click();
    return { secildi: true };
  });
  await new Promise((r) => setTimeout(r, 1200));

  const uyariMetni = await ev(() => {
    const kutu = document.querySelector('[role="alert"]');
    return {
      alertVar: !!kutu,
      metin: kutu?.textContent?.trim().slice(0, 200) ?? null,
    };
  });
  console.log("secim:", JSON.stringify(secim), "| uyari:", JSON.stringify(uyariMetni));
  if (!secim.secildi) dusenler.push("uyarili blok secilemedi");
  if (!uyariMetni.alertVar) dusenler.push('secili blokta role="alert" uyari kutusu YOK');
  else if (!/hiçbir yere gitmiyor|hedef adres boş/i.test(uyariMetni.metin ?? ""))
    dusenler.push(`uyari kutusu bekleneni yazmiyor: ${uyariMetni.metin}`);

  const ss = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, "panel-uyari.png"), Buffer.from(ss.data, "base64"));
} finally {
  chrome.kill();
}

if (dusenler.length) {
  console.error(`\nKAPI DUSTU (${dusenler.length}):`);
  for (const d of dusenler) console.error("  - " + d);
  process.exit(1);
}
console.log("\nKAPI GECTI: yonetici blok uyarilarini panelde gercekten goruyor.");
