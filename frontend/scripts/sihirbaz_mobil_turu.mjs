// İlan sihirbazının MOBİL turu — gerçek Chrome + CDP.
//
// Neden: "mobilde düzgün gözüksün" göz kararıyla doğrulanamaz. Bu tur her
// adımı 360px ve 414px'te açar ve px cinsinden ölçer:
//
//   • kök scrollWidth > clientWidth (yatay taşma) ve taşma px'i
//   • 44px'in altında kalan dokunma hedefleri (görünür, etkileşimli öğeler)
//   • birincil aksiyon düğmesinin görünür alanın İÇİNDE olması
//   • adım başlığının ilk ekranda (fold üstünde) olması
//   • konsol hatası / sayfa istisnası
//
// Kullanım (frontend/):
//   node <bu dosya> --frontend http://127.0.0.1:5199 --api http://127.0.0.1:8011/api/v1
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] ?? "1"]);
    return acc;
  }, []),
);
const FRONT = ARGS.frontend ?? "http://127.0.0.1:5199";
const API = ARGS.api ?? "http://127.0.0.1:8011/api/v1";
const EPOSTA = ARGS.eposta ?? "duman-sihirbaz-01@example.com";
const PAROLA = ARGS.parola ?? "Sifre12345!";
const OUT = resolve(ARGS.out ?? "./sihirbaz-mobil");
const PORT = 9333;
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
// Varsayılan iki mobil genişlik; `--genislikler 360,414,1440` ile masaüstü de
// eklenebilir (iki kolonlu düzen yalnız lg'de açılıyor).
const GENISLIKLER = (ARGS.genislikler ?? "360,414")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter(Boolean);
// Adım sayısı: sözleşme TS'te yaşıyor ve bu script .mjs, import edemiyor.
// 5 Eyl 2026'da müsaitlik ve belge adımları çıkarıldı (11 -> 9). Sözleşme
// değişirse burası da güncellenmeli; `--adim` ile geçici olarak ezilebilir.
const ADIM_SAYISI = Number(ARGS.adim ?? 9);
const HEDEF_EN_AZ = 44; // dokunma hedefi eşiği (px)
// NEGATİF KONTROL: her dokunma hedefi sentetik olarak küçültülür ve kapıların
// KIRMIZI düşmesi beklenir. Gerekçe: sonda "etiket kutusunu ölç" kuralını
// aldıktan sonra, gerçekten hâlâ ölçüp ölçmediği kanıtlanmalı — aksi hâlde
// kural, kusuru gizleyen bir muafiyete dönüşür.
const NEGATIF = ARGS.negatif === "1";

mkdirSync(OUT, { recursive: true });

async function chromeBaslat() {
  const profil = join(OUT, "profil");
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
    { stdio: "ignore" },
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
      if (
        m.method === "Runtime.consoleAPICalled" &&
        ["error", "warning"].includes(m.params.type)
      ) {
        this.konsol.push(
          (m.params.args ?? [])
            .map((a) => a.value ?? a.description ?? a.type)
            .join(" ")
            .slice(0, 300),
        );
      }
      if (m.method === "Runtime.exceptionThrown") {
        this.konsol.push(
          (
            m.params.exceptionDetails?.exception?.description ??
            m.params.exceptionDetails?.text ??
            ""
          ).slice(0, 300),
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
        `Sayfa içi hata: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
      );
    }
    return r.result.value;
  }
  async git(url, bekleSecici) {
    this.konsol = [];
    await this.gonder("Page.navigate", { url });
    for (let i = 0; i < 120; i++) {
      if (await this.eval(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    // readyState YETMEZ: React + Vite soğuk derlemede kök uzun süre boş kalır.
    // Beklenen düğüm DOM'a girene kadar beklenir; girmezse ölçüm bunu bildirir.
    this.hazir = false;
    for (let i = 0; i < 100; i++) {
      this.hazir = await this.eval(
        (s) => !!document.querySelector(s),
        bekleSecici,
      );
      if (this.hazir) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  async genislik(px) {
    await this.gonder("Emulation.setDeviceMetricsOverride", {
      width: px,
      height: 780,
      deviceScaleFactor: 1,
      mobile: true,
    });
  }
  async ss(dosya) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(dosya, Buffer.from(r.data, "base64"));
  }
}

/* ── sayfa içinde koşan ölçüm ───────────────────────────────────────── */
const olc = () => {
  const kok = document.documentElement;
  const gorunur = (el) => {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0")
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const ad = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.textContent ||
      el.getAttribute("placeholder") ||
      el.tagName
    )
      .trim()
      .slice(0, 40);

  const etkilesimli = Array.from(
    document.querySelectorAll("button, a[href], input, select, textarea"),
  ).filter(gorunur);

  // Ölçüm dışı: sr-only, görsel olarak gizli dosya girdileri ve React Query
  // devtools tetikleyicisi (paket üretim derlemesinde no-op'tur, kullanıcıya
  // hiç ulaşmaz — onu ölçmek yalancı kırmızı üretir).
  const kucukHedefler = etkilesimli
    .filter(
      (el) =>
        !el.classList.contains("sr-only") &&
        el.type !== "file" &&
        !/devtools/i.test(el.getAttribute("aria-label") || ""),
    )
    // ETKİN hedef, öğenin kendi kutusu olmayabilir: bir <label> içindeki onay
    // kutusuna dokunmak etiketin her yerinden çalışır, yani gerçek dokunma
    // alanı etiketin kutusudur. Kutunun kendi 20px'ini ölçmek, kullanıcının
    // hiç yaşamadığı bir kusuru rapor eder. Kural GENELDİR, tek bir bileşene
    // özel değil; `--negatif 1` bu kuralın hâlâ ölçtüğünü kanıtlar.
    .map((el) => {
      const et = el.closest("label");
      return { el, r: (et ?? el).getBoundingClientRect() };
    })
    .filter(({ r }) => r.height < 44 - 0.5 || r.width < 24)
    .map(({ el, r }) => ({
      ad: ad(el),
      etiket: el.tagName.toLowerCase(),
      genislik: Math.round(r.width),
      yukseklik: Math.round(r.height),
    }));

  const birincil = etkilesimli.find(
    (el) =>
      el.tagName === "BUTTON" &&
      /^(Sırada:|Yayına gönder)/.test((el.textContent || "").trim()),
  );
  const birincilRect = birincil ? birincil.getBoundingClientRect() : null;

  const h1 = document.querySelector("h1");
  const h1Rect = h1 ? h1.getBoundingClientRect() : null;

  return {
    scrollWidth: kok.scrollWidth,
    clientWidth: kok.clientWidth,
    tasmaPiksel: Math.max(0, kok.scrollWidth - kok.clientWidth),
    baslik: h1 ? h1.textContent.trim().slice(0, 60) : null,
    baslikFoldUstunde: h1Rect ? h1Rect.top >= 0 && h1Rect.bottom <= 780 : null,
    birincilEtiket: birincil ? birincil.textContent.trim() : null,
    birincilGorunurAlanda: birincilRect
      ? birincilRect.right <= kok.clientWidth + 0.5 &&
        birincilRect.left >= -0.5 &&
        birincilRect.bottom <= 780 + 0.5
      : null,
    birincilKirpildi: birincil
      ? birincil.scrollWidth > birincil.clientWidth + 1
      : null,
    kucukHedefler,
  };
};

/* ── tur ────────────────────────────────────────────────────────────── */
const sonuc = { olculdu: new Date().toISOString(), adimlar: {}, dusenKapilar: [] };
const kapi = (kosul, mesaj) => {
  if (!kosul) sonuc.dusenKapilar.push(mesaj);
};

const chrome = await chromeBaslat();
try {
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const hedef = hedefler.find((t) => t.type === "page");
  const ws = new WebSocket(hedef.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const s = new Sayfa(ws);
  await s.gonder("Runtime.enable");
  await s.gonder("Page.enable");

  // 1) Gerçek token al ve oturumu kur (uygulamanın kendi saklama anahtarıyla).
  const govde = new URLSearchParams({
    username: EPOSTA,
    password: PAROLA,
    remember: "true",
  });
  const giris = await (
    await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: govde,
    })
  ).json();
  if (!giris.access_token) throw new Error("giriş başarısız: " + JSON.stringify(giris));

  await s.genislik(360);
  await s.git(FRONT + "/", "body");
  await s.eval((t) => {
    localStorage.setItem("adana-remember", "1");
    localStorage.setItem(
      "adana-auth",
      JSON.stringify({ state: { token: t, user: null }, version: 0 }),
    );
  }, giris.access_token);

  for (const genislik of GENISLIKLER) {
    await s.genislik(genislik);
    sonuc.adimlar[genislik] = {};
    for (let adim = 0; adim < ADIM_SAYISI; adim++) {
      await s.git(`${FRONT}/ilanini-olustur?adim=${adim}`, "h1");
      if (NEGATIF) {
        await s.eval(() => {
          const st = document.createElement("style");
          st.textContent =
            "button, a[href], input, select, textarea, label { min-height: 0 !important; height: 18px !important; padding-top: 0 !important; padding-bottom: 0 !important; }";
          document.head.appendChild(st);
        });
        await new Promise((r) => setTimeout(r, 150));
      }
      const o = await s.eval(olc);
      o.konsol = s.konsol.slice();
      sonuc.adimlar[genislik][adim] = o;
      // Görsel kanıt: `--ss 0,1,8` ile hangi adımların yakalanacağı seçilir;
      // verilmezse mobil turda birkaç temsilci adım kaydedilir.
      const ssAdimlari = ARGS.ss
        ? ARGS.ss.split(",").map((x) => Number(x.trim()))
        : genislik === 360
          ? [0, 1, 5]
          : [];
      if (!NEGATIF && ssAdimlari.includes(adim)) {
        await s.ss(join(OUT, `adim-${adim}-${genislik}.png`));
      }

      kapi(o.tasmaPiksel === 0, `adim ${adim}/${genislik}: yatay taşma (${o.tasmaPiksel}px)`);
      kapi(
        o.birincilEtiket !== null,
        `adim ${adim}/${genislik}: birincil düğme bulunamadı`,
      );
      // Bu kural YALNIZ mobilde geçerli. Aksiyon çubuğu `sm` (640px) altında
      // ekrana SABİTLENİR ve orada görünmemesi akışı keser; `sm` üstünde
      // bilerek akışa döner ve uzun bir sayfada (ör. Özet) aşağıda kalması
      // normaldir. Kuralı masaüstünde de uygulamak, olmayan bir kusuru
      // raporlar ve gerçek kusurları gürültüye boğardı.
      if (genislik < 640) {
        kapi(
          o.birincilGorunurAlanda !== false,
          `adim ${adim}/${genislik}: birincil düğme görünür alanın dışında`,
        );
      }
      kapi(
        o.birincilKirpildi !== true,
        `adim ${adim}/${genislik}: birincil düğme etiketi kırpıldı (${o.birincilEtiket})`,
      );
      kapi(
        o.baslikFoldUstunde !== false,
        `adim ${adim}/${genislik}: adım başlığı ilk ekranda değil`,
      );
      kapi(
        o.kucukHedefler.length === 0,
        `adim ${adim}/${genislik}: ${HEDEF_EN_AZ}px altı dokunma hedefi: ${JSON.stringify(o.kucukHedefler).slice(0, 200)}`,
      );
      kapi(
        o.konsol.length === 0,
        `adim ${adim}/${genislik}: konsol kaydı ${JSON.stringify(o.konsol).slice(0, 200)}`,
      );
    }
  }

  writeFileSync(
    join(OUT, `olcum${NEGATIF ? "-negatif" : ""}.json`),
    JSON.stringify(sonuc, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        kip: NEGATIF ? "negatif" : "normal",
        kapiSayisi: sonuc.dusenKapilar.length,
        dusenKapilar: sonuc.dusenKapilar.slice(0, 6),
      },
      null,
      2,
    ),
  );
} finally {
  chrome.kill();
}
