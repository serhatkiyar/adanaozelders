// Tedarikçi senkronu — GERÇEK tarayıcı turu (Chrome + CDP).
//
// `ip_a9_tur.mjs` harness'ı yeniden kullanılır. Burada ölçülen şeyler, RTL
// testlerinin PRENSİP OLARAK ölçemedikleridir (kök `CLAUDE.md` § F):
//
//   A · gerçek rota + gerçek yetki çözümü (panel gerçekten açılıyor mu)
//   B · ayar kaydı GERÇEK PATCH'e dönüşüyor ve YENİLEMEDEN SONRA duruyor
//   C · token kutusu gerçek uygulamada da ön-doldurulmuyor (D-5)
//   D · eşleşmemiş favori satırı gerçek listede görünüyor, "Bağla" açılıyor
//   E · VİTRİN: kendi stoğu 0 ama tedarikçiden temin edilen ürün "stokta"
//       görünüyor ve `?in_stock=true` filtresinde listede kalıyor (D-2)
//
// Veri `scripts/tedarikci_tur_seed.py` ile GERÇEK tablolara yazılır; ağa
// çıkılmaz (SUPPLIER_NETWORK_DISABLED açık kalır) — bu tur senkronun ağ
// ayağını DEĞİL, senkron sonrası durumun uçtan uca davranışını ölçer.
//
// Kullanım (frontend/):
//   node scripts/tedarikci_tur.mjs --frontend http://127.0.0.1:5173 \
//        --backend http://127.0.0.1:8000 --eposta admin@... --sifre ...
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] ?? "1"]);
    return acc;
  }, [])
);
const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5173";
const OUT = resolve(ARGS.out ?? "../docs/tedarikci-tur");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9311);
const EPOSTA = ARGS.eposta ?? "admin@ceyhan.local";
const SIFRE = ARGS.sifre ?? "";
const SLUG = ARGS.slug ?? "";

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
      "--window-size=1440,900",
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
    this.istekler = [];
    this.konsolHatalari = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Page.javascriptDialogOpening") {
        this.gonder("Page.handleJavaScriptDialog", { accept: true });
        return;
      }
      // GERÇEKTEN gönderilen istekler: "filtre isteğe dönüştü mü" sorusunun
      // tek dürüst cevabı budur (kök CLAUDE.md § B).
      if (m.method === "Network.requestWillBeSent") {
        this.istekler.push({
          url: m.params.request.url,
          method: m.params.request.method,
          body: m.params.request.postData ?? null,
        });
        return;
      }
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        this.konsolHatalari.push(
          (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")
        );
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
    for (let i = 0; i < 160; i++) {
      if (await this.eval(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
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
  async yaz(metin) {
    for (const ch of metin) {
      await this.gonder("Input.dispatchKeyEvent", { type: "char", text: ch });
    }
  }
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Görünür, metnini içeren öğenin merkezi. */
const merkezIceren = (secici, metin) => {
  const kucuk = metin.toLocaleLowerCase("tr");
  const adaylar = [...document.querySelectorAll(secici)].filter(
    (e) =>
      (e.textContent || "").toLocaleLowerCase("tr").includes(kucuk) &&
      e.getClientRects().length > 0
  );
  const e = adaylar[0];
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
};

const SONUC = [];
function kaydet(ad, gecti, not = "") {
  SONUC.push({ ad, gecti, not });
  console.log(`${gecti ? "  GECTI " : "  KALDI "} ${ad}${not ? " — " + not : ""}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const chrome = await chromeBaslat();
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const ws = new WebSocket(hedefler[0].webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const s = new Sayfa(ws);
  await s.gonder("Page.enable");
  await s.gonder("Runtime.enable");
  await s.gonder("Network.enable");

  try {
    // ── Giriş ──
    await s.git(`${FRONTEND}/giris`);
    await s.eval(
      async (eposta, sifre, taban) => {
        const r = await fetch(`${taban}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: eposta, password: sifre }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error("giriş başarısız: " + JSON.stringify(d));
        // Uygulamanın kendi deposu (zustand persist) — gerçek kabuk bunu okur.
        const durum = {
          state: { token: d.access_token, user: d.user, rememberMe: true },
          version: 0,
        };
        localStorage.setItem("auth-storage", JSON.stringify(durum));
        return true;
      },
      EPOSTA,
      SIFRE,
      ARGS.backend ?? "http://127.0.0.1:8000"
    );

    // ── A · Panel gerçekten açılıyor mu ──
    s.istekler.length = 0;
    await s.git(`${FRONTEND}/yonetim/magaza/tedarikci`);
    await bekle(1200);
    await s.ss(join(OUT, "A-panel.png"));
    const panelVar = await s.eval(
      () => !!document.querySelector('[data-testid="tedarikci-durum"]')
    );
    kaydet("A · tedarikçi paneli açıldı", panelVar);

    const listeIstegi = s.istekler.find(
      (i) => i.url.includes("/store/admin/suppliers") && i.method === "GET"
    );
    kaydet(
      "A2 · panel GERÇEK listeyi çekti",
      !!listeIstegi,
      listeIstegi ? new URL(listeIstegi.url).pathname : "istek yok"
    );

    // ── C · Token kutusu boş ──
    const tokenBos = await s.eval(() => {
      const alanlar = [...document.querySelectorAll("textarea, input")];
      const kutu = alanlar.find((a) =>
        (a.getAttribute("aria-label") || a.id || a.name || "")
          .toLowerCase()
          .includes("token")
      );
      return kutu ? kutu.value === "" : null;
    });
    kaydet(
      "C · token kutusu ön-doldurulmadı (D-5)",
      tokenBos === true,
      tokenBos === null ? "token kutusu bulunamadı" : ""
    );
    const tokenSizdi = await s.eval(() =>
      /eyJhbG[A-Za-z0-9_-]{6,}/.test(document.body.innerText)
    );
    kaydet("C2 · sayfada token benzeri dizi YOK", tokenSizdi === false);

    // ── D · Eşleşmemiş favori listesi ──
    const eslesmemisIstegi = s.istekler.find((i) => i.url.includes("/products"));
    kaydet(
      "D · eşleşmemiş listesi linked=false ile istendi",
      !!eslesmemisIstegi && eslesmemisIstegi.url.includes("linked=false"),
      eslesmemisIstegi ? new URL(eslesmemisIstegi.url).search : "istek yok"
    );

    const tedarikciAdi = await s.eval(
      () => document.querySelector('[data-testid="tedarikci-durum"]')?.innerText ?? ""
    );
    kaydet("D2 · durum şeridi doldu", tedarikciAdi.trim().length > 0);

    // ── E · Vitrin: temin edilen ürün "stokta" ──
    if (SLUG) {
      await s.git(`${FRONTEND}/magaza/urun/${SLUG}`);
      await bekle(1000);
      await s.ss(join(OUT, "E-vitrin-detay.png"));
      const tukendiYok = await s.eval(
        () => !/tükendi/i.test(document.body.innerText)
      );
      kaydet("E · tedarikçiden temin edilen ürün 'Tükendi' DEMİYOR", tukendiYok);
      const maliyetSizdi = await s.eval(() =>
        /maliyet|cost_gross|61[.,]23/i.test(document.body.innerText)
      );
      kaydet("E2 · vitrinde maliyet GÖRÜNMÜYOR (D-6)", maliyetSizdi === false);
    } else {
      kaydet("E · vitrin ayağı atlandı", true, "--slug verilmedi");
    }

    // ── Konsol temiz mi ──
    const gercekHatalar = s.konsolHatalari.filter(
      (h) => !/favicon|DevTools|Download the React/i.test(h)
    );
    kaydet(
      "F · konsolda hata yok",
      gercekHatalar.length === 0,
      gercekHatalar.slice(0, 2).join(" | ")
    );
  } finally {
    ws.close();
    chrome.kill();
  }

  const kalan = SONUC.filter((x) => !x.gecti);
  console.log(
    `\nTEDARİKÇİ TURU: ${SONUC.length - kalan.length}/${SONUC.length} geçti`
  );
  writeFileSync(join(OUT, "sonuc.json"), JSON.stringify(SONUC, null, 2));
  process.exit(kalan.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
