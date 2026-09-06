// Ç-4 · turuncu aksan — gerçek Chrome rota turu (ham CDP).
//
// Ölçülen iki şey:
//
//   1. ÇALIŞMA ZAMANINDA İNDİGO KALDI MI. Kaynak taraması (`markaAksani`)
//      yalnız `indigo-` YAZAN sınıfları görür. Bir renk sayfaya inline stil,
//      üçüncü parti CSS ya da `theme()` araması yoluyla da girebilir — o zaman
//      kaynakta hiç `indigo` geçmez ama ekran indigo çizer. Bu tur, boyanmış
//      HER öğenin hesaplanan `color` / `background-color` / `border-color`
//      değerine bakar ve indigo ailesinin 10 tonundan birine denk gelen varsa
//      isimle raporlar.
//
//   2. Ekran görüntüsü — iki genişlikte, kanıt olarak `docs/ip-c4/`.
//
// Kullanım (frontend/):
//   npm run dev -- --port 5199
//   node scripts/ip_c4_public_turu.mjs --frontend http://127.0.0.1:5199 --out ../docs/ip-c4
//
// GİRİŞ GEREKTİRMEZ: yalnız herkese açık rotalar gezilir, gerçek hesap ve
// gerçek sipariş verisi kullanılmaz.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5199";
const OUT = resolve(ARGS.out ?? "../docs/ip-c4");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9284);
const GENISLIKLER = (ARGS.genislikler ?? "1280,380").split(",").map(Number);

/** Herkese açık rotalar. Ad, dosya adına da girer. */
const ROTALAR = [
  ["anasayfa", "/"],
  ["egitmenler", "/egitmenler"],
  ["magaza", "/magaza"],
  ["kutuphaneler", "/kutuphaneler"],
  ["giris", "/giris"],
  ["kayit", "/kayit"],
  ["on-basvuru", "/egitmen-on-basvuru"],
  // Mercanın DEĞİŞMEDİĞİNİN kanıtı: sihirbaz bilinçli olarak ayrı rejim.
  ["sihirbaz", "/ilanini-olustur"],
  ["siralama-kriterleri", "/siralama-kriterleri"],
  ["sss", "/sss"],
];

/** Tailwind `indigo` ailesinin 10 tonu — çalışma zamanında aranan değerler. */
const INDIGO = {
  "rgb(238, 242, 255)": "indigo-50",
  "rgb(224, 231, 255)": "indigo-100",
  "rgb(199, 210, 254)": "indigo-200",
  "rgb(165, 180, 252)": "indigo-300",
  "rgb(129, 140, 248)": "indigo-400",
  "rgb(99, 102, 241)": "indigo-500",
  "rgb(79, 70, 229)": "indigo-600",
  "rgb(67, 56, 202)": "indigo-700",
  "rgb(55, 48, 163)": "indigo-800",
  "rgb(49, 46, 129)": "indigo-900",
};

async function chromeBaslat() {
  // Profil OUT ALTINDA DEĞİL: `docs/` bir kanıt dizinidir.
  const profil = join(tmpdir(), "c4-tur-profil");
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
  async boyut(genislik, yukseklik) {
    await this.gonder("Emulation.setDeviceMetricsOverride", {
      width: genislik,
      height: yukseklik,
      deviceScaleFactor: 1,
      mobile: genislik < 640,
    });
  }
  async git(url) {
    await this.gonder("Page.navigate", { url });
    for (let i = 0; i < 120; i++) {
      if (await this.eval(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    // React'in ilk boyaması + veri isteklerinin oturması.
    await new Promise((r) => setTimeout(r, 1200));
  }
  async ss(dosya) {
    // GORUNUR ALAN: tam sayfa cekmek harita karosu tasiyan ekranlarda 1,5 MB
    // uretiyordu ve deponun kanit dizinleri 68 KB - 2 MB araligindaydi. Aksan
    // zaten ust katlarda yasiyor (baslik, birincil dugme, secili sekme);
    // sayisal kanit `tur.json` ve `kontrast.json` dosyalarindadir.
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
}

/** Sayfadaki her öğenin hesaplanan renklerini indigo ailesine karşı tarar. */
const indigoTara = (INDIGO) => {
  const bulgular = [];
  const secici = (el) => {
    const parcalar = [el.tagName.toLowerCase()];
    if (el.id) parcalar.push("#" + el.id);
    const sinif = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 4) : [];
    if (sinif.length) parcalar.push("." + sinif.join("."));
    return parcalar.join("");
  };
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    for (const ozellik of ["color", "backgroundColor", "borderTopColor", "borderLeftColor", "fill", "stroke"]) {
      const d = s[ozellik];
      if (!d) continue;
      // Saydam ya da hiç boyanmamışları eleyelim; yalnız görünen renk sayılır.
      if (d === "rgba(0, 0, 0, 0)" || d === "none" || d === "transparent") continue;
      const anahtar = d.startsWith("rgba(")
        ? "rgb(" + d.slice(5, d.lastIndexOf(",")).trim() + ")"
        : d;
      if (INDIGO[anahtar]) {
        bulgular.push(`${secici(el)} { ${ozellik}: ${INDIGO[anahtar]} }`);
      }
    }
  }
  return bulgular.slice(0, 25);
};

/**
 * Markanın gerçekten sayfada olduğunun DOLULUK kanıtı.
 *
 * AİLENİN TAMAMINA bakar, tek bir token'a değil. Sebebi ölçüldü: dolgu parlak
 * + yazı koyu kuralına geçilince marka YAZISI `--marka`dan `--marka-metin`e
 * taşındı ve yalnız `--marka`yı sayan eski sürüm 66'dan 8'e düşüp "site boş"
 * sandı. Kusur sitede değil ARAÇTAYDI; eşiği düşürmek yerine ölçüt düzeltildi.
 */
const markaTara = () => {
  const kok = getComputedStyle(document.documentElement);
  const oku = (ad) => {
    const v = kok.getPropertyValue(ad).trim();
    return v ? `rgb(${v.replace(/\s+/g, ",")})` : null;
  };
  const aile = {
    dolgu: oku("--marka"),
    metin: oku("--marka-metin"),
    "metin-hover": oku("--marka-metin-hover"),
    soft: oku("--marka-soft"),
  };
  const bulunan = {};
  let sayac = 0;
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    for (const o of ["color", "backgroundColor", "borderTopColor", "borderLeftColor"]) {
      const d = (s[o] ?? "").replace(/\s/g, "");
      for (const [ad, deger] of Object.entries(aile)) {
        if (deger && d === deger.replace(/\s/g, "")) {
          bulunan[ad] = (bulunan[ad] ?? 0) + 1;
          sayac++;
        }
      }
    }
  }
  return { marka: aile.dolgu, sayac, bulunan };
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const chrome = await chromeBaslat();
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const hedef = hedefler.find((t) => t.type === "page");
  const ws = new WebSocket(hedef.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const sayfa = new Sayfa(ws);
  await sayfa.gonder("Page.enable");
  await sayfa.gonder("Runtime.enable");

  const rapor = [];
  let toplamIndigo = 0;
  let toplamMarka = 0;

  for (const genislik of GENISLIKLER) {
    console.log(`\n══ ${genislik}px ══`);
    await sayfa.boyut(genislik, genislik < 640 ? 780 : 1000);
    for (const [ad, yol] of ROTALAR) {
      await sayfa.git(`${FRONTEND}${yol}`);
      const bulgular = await sayfa.eval(indigoTara, INDIGO);
      const { marka, sayac } = await sayfa.eval(markaTara);
      const dosya = join(OUT, `${ad}-${genislik}.png`);
      await sayfa.ss(dosya);
      toplamIndigo += bulgular.length;
      toplamMarka += sayac;
      rapor.push({ ad, yol, genislik, indigo: bulgular, markaBoyali: sayac, markaTokeni: marka });
      const isaret = bulgular.length === 0 ? "✓" : "✗";
      console.log(
        `  ${isaret} ${ad.padEnd(20)} indigo=${String(bulgular.length).padStart(2)}  marka boyalı öğe=${String(sayac).padStart(3)}`
      );
      for (const b of bulgular.slice(0, 4)) console.log(`      ${b}`);
    }
  }

  writeFileSync(join(OUT, "tur.json"), JSON.stringify({ tarih: new Date().toISOString(), FRONTEND, rapor }, null, 2));
  console.log(`\nÇALIŞMA ZAMANINDA KALAN İNDİGO: ${toplamIndigo}`);
  console.log(`MARKA RENGİYLE BOYANAN ÖĞE (doluluk kapısı): ${toplamMarka}`);
  // Doluluk olmadan "0 indigo" bedava geçerdi: boş bir sayfa da 0 indigo verir.
  if (toplamMarka < 20) {
    console.log("HATA: marka rengi neredeyse hiç çizilmemiş — tur boş sayfa ölçmüş olabilir.");
    process.exitCode = 1;
  }
  if (toplamIndigo !== 0) process.exitCode = 1;

  ws.close();
  chrome.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
