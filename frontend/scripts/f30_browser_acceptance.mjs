// F30 gerçek tarayıcı kabulü — Chrome DevTools Protocol ile, kütüphanesiz.
//
// ## Neden bu betik var
//
// Kök `CLAUDE.md` §F: baskı ve print CSS, QR boyutu, taşma/yerleşim, kamera ve
// secure-context davranışı **gerçek tarayıcı** gerektirir; Vitest + tsc + build
// bunların yerine geçmez. F26'da tam olarak bu boşluktan iki hata üretime
// gitti: etiket bomboş basıldı (1 KB'lık PDF) ve uzun başlık QR'ı yatay olarak
// ezip okunamaz hâle getirdi.
//
// Playwright bilinçli olarak KURULU DEĞİL (bkz. kök CLAUDE.md). Node 22+ global
// `WebSocket` taşıdığı için CDP'yi sürmek ek bağımlılık istemez; bu betiğin
// tamamı standart kütüphanedir.
//
// ## Ne yapar
//
// 1. Yönetici olarak GERÇEKTEN giriş yapar (token enjekte etmez — oturum
//    katmanını atlamak "çalışıyor" sanmaktır).
// 2. Paketleme kuyruğundan siparişi açar, kalemleri okutur, paketi tamamlar.
// 3. Etiketi UI'dan açar ve `Page.printToPDF` ile GERÇEK baskı çıktısı üretir.
// 4. Kurye olarak giriş yapar, zimmet ekranında yanlış QR / doğru QR / tekrar
//    QR akışını yürütür.
//
// PDF'in ölçüsü, metni ve QR çözümü ayrı bir adımda (`backend/scripts/
// f30_baski_kabul.py`) denetlenir — bu betik yalnız çıktıyı üretir ve UI
// davranışını ölçer.
//
// Kullanım:
//   node scripts/f30_browser_acceptance.mjs --seed <seed.json> --out <dizin>
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const FRONTEND = ARGS.frontend ?? "http://localhost:5174";
const BACKEND = ARGS.backend ?? "http://localhost:8001";
const API = `${BACKEND}/api/v1`;
const OUT = ARGS.out ?? "./f30-kabul";
const SEED = JSON.parse(readFileSync(ARGS.seed, "utf8"));
const ADMIN_EMAIL = SEED.admin_email;
const ADMIN_PASSWORD = ARGS["admin-password"];

mkdirSync(OUT, { recursive: true });

const adimlar = [];
function kaydet(ad, ok, detay) {
  adimlar.push({ adim: ad, ok, detay });
  console.log(`${ok ? "  ✓" : "  ✗"} ${ad}${detay ? ` — ${detay}` : ""}`);
  if (!ok) process.exitCode = 1;
}
function zorunlu(ad, kosul, detay) {
  kaydet(ad, Boolean(kosul), detay);
  if (!kosul) throw new Error(`KABUL DÜŞTÜ: ${ad}${detay ? ` — ${detay}` : ""}`);
}

/* ═══════════════════════ CDP ═══════════════════════ */

const CHROME =
  ARGS.chrome ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(ARGS.port ?? 9333);

async function chromeBaslat() {
  // Profil HER KOŞUMDA sıfırlanır. Kalıcı profil bir kez yanlış kırmızı üretti:
  // önceki koşumun `localStorage`'daki yönetici oturumu duruyordu, `/giris`
  // anında panele yönlendi ve "giriş formu" beklemesi zaman aşımına düştü.
  // Daha kötüsü ters yönde olurdu — oturum katmanı hiç sınanmadan "geçti"
  // denirdi.
  const profil = join(OUT, "chrome-profil");
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
    { stdio: "ignore", detached: false },
  );
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return p;
    } catch {
      /* henüz açılmadı */
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
        const { çöz, red } = this.bekleyen.get(m.id);
        this.bekleyen.delete(m.id);
        m.error ? red(new Error(JSON.stringify(m.error))) : çöz(m.result);
      }
    });
  }
  gonder(method, params = {}) {
    const id = ++this.id;
    return new Promise((çöz, red) => {
      this.bekleyen.set(id, { çöz, red });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.bekleyen.has(id)) {
          this.bekleyen.delete(id);
          red(new Error(`CDP zaman aşımı: ${method}`));
        }
      }, 60_000);
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
  async git(url) {
    await this.gonder("Page.navigate", { url });
    await this.bekle(() => document.readyState === "complete");
    await new Promise((r) => setTimeout(r, 400));
  }
  /** Sayfa içinde koşul sağlanana kadar bekler. `args` koşula GEÇİRİLİR. */
  async bekle(kosulFn, { ms = 15000, aciklama = "" } = {}, ...args) {
    const bitis = Date.now() + ms;
    let son = null;
    while (Date.now() < bitis) {
      try {
        son = await this.eval(kosulFn, ...args);
        if (son) return son;
      } catch (e) {
        son = e.message;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Bekleme zaman aşımı${aciklama ? `: ${aciklama}` : ""} (son: ${son})`);
  }
  async ekranGoruntusu(ad) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, ad), Buffer.from(r.data, "base64"));
  }
}

async function sayfaAc() {
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const sekme = hedefler.find((t) => t.type === "page");
  const ws = new WebSocket(sekme.webSocketDebuggerUrl);
  await new Promise((çöz, red) => {
    ws.addEventListener("open", çöz, { once: true });
    ws.addEventListener("error", red, { once: true });
  });
  const s = new Sayfa(ws);
  await s.gonder("Page.enable");
  await s.gonder("Runtime.enable");
  await s.gonder("Network.enable");
  return s;
}

/* ═══════════════ Sayfa içinde çalışan yardımcılar ═══════════════ */
// Not: bu fonksiyonlar string'e çevrilip sayfada koşar; dışarıdaki hiçbir
// değişkeni kapatamazlar (closure YOK) — her şey argümandan gelir.

const metinYaz = (secici, deger) => {
  const el = document.querySelector(secici);
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
  setter.call(el, deger);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
};

const metneTikla = (desen, etiket) => {
  const re = new RegExp(desen, "i");
  const adaylar = [...document.querySelectorAll("button, a, [role=button]")].filter(
    (e) =>
      re.test((e.textContent || "").trim()) ||
      re.test((e.getAttribute("aria-label") || "").trim()),
  );
  const gorunur = adaylar.filter((e) => e.offsetParent !== null && !e.disabled);
  if (gorunur.length === 0) return { ok: false, sayi: adaylar.length, etiket };
  gorunur[0].click();
  return { ok: true, sayi: gorunur.length, etiket };
};

const metinVarMi = (desen) => new RegExp(desen, "i").test(document.body.innerText);

const uyariMetni = () =>
  [...document.querySelectorAll('[role="alert"]')].map((e) => e.innerText.trim()).join(" | ");

const govdeMetni = () => document.body.innerText;

/* ═══════════════════════ HTTP (backend) ═══════════════════════ */

async function girisTokeni(email, sifre) {
  // Uç `OAuth2PasswordRequestForm` kullanır: gövde **form-encoded** ve alan adı
  // `username`'dir (e-posta oraya yazılır). JSON gönderen ilk deneme 422 aldı.
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password: sifre }).toString(),
  });
  if (!r.ok) throw new Error(`Login başarısız (${r.status}): ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
}

async function api(token, yol, opts = {}) {
  const r = await fetch(`${API}${yol}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  });
  const govde = await r.text();
  return { status: r.status, json: govde ? JSON.parse(govde) : null, ham: govde };
}

/* ═══════════════════════ UI: giriş ═══════════════════════ */

async function uiGiris(sayfa, email, sifre) {
  await sayfa.git(`${FRONTEND}/giris`);
  await sayfa.bekle(
    () => Boolean(document.querySelector('input[type=password]')),
    { aciklama: "giriş formu" },
  );
  const eSecici = (await sayfa.eval(() =>
    document.querySelector('input[type=email]')
      ? "input[type=email]"
      : document.querySelector('input[name=email]')
        ? "input[name=email]"
        : "input:not([type=password])",
  ));
  await sayfa.eval(metinYaz, eSecici, email);
  await sayfa.eval(metinYaz, "input[type=password]", sifre);
  await sayfa.eval(() => {
    const f = document.querySelector("form");
    const b = f?.querySelector('button[type=submit]') ?? f?.querySelector("button");
    b ? b.click() : f?.requestSubmit();
  });
  await sayfa.bekle(() => !location.pathname.startsWith("/giris"), {
    aciklama: "girişten sonra yönlendirme",
    ms: 20000,
  });
}

/* ═══════════════════════ Akış ═══════════════════════ */

async function ana() {
  console.log("F30 gerçek tarayıcı kabulü\n");
  const chrome = await chromeBaslat();
  const sayfa = await sayfaAc();
  const rapor = { frontend: FRONTEND, backend: BACKEND, seed: SEED };

  try {
    /* ── 0. Backend beklentileri ── */
    const adminToken = await girisTokeni(ADMIN_EMAIL, ADMIN_PASSWORD);
    kaydet("yönetici HTTP girişi", Boolean(adminToken));

    /* ── 1. Yönetici UI: kuyruk → paket aç ── */
    await uiGiris(sayfa, ADMIN_EMAIL, ADMIN_PASSWORD);
    kaydet("yönetici UI girişi", true);

    await sayfa.git(`${FRONTEND}/yonetim/paketleme`);
    await sayfa.bekle((sip) => document.body.innerText.includes("#" + sip), {
      aciklama: "kuyrukta sipariş satırı",
      ms: 20000,
    }, SEED.order_id);
    kaydet("paketleme kuyruğunda sipariş görünüyor", true, `#${SEED.order_id}`);
    await sayfa.ekranGoruntusu("01-kuyruk.png");

    // Desen DAR olmalı: "paketle" kenar çubuğundaki "Paketleme" bağlantısını ve
    // sekmeyi de yakalıyordu (3 eşleşme) ve sürücü yanlış öğeye tıklıyordu.
    const acKlik = await sayfa.eval(metneTikla, "^\s*paketlemeye başla\s*$", "aç");
    zorunlu("kuyruktan paket açma butonu", acKlik.ok, JSON.stringify(acKlik));
    await sayfa.bekle(() => /\/yonetim\/paketleme\/paket\/\d+/.test(location.pathname), {
      aciklama: "istasyon ekranına geçiş",
    });
    const paketId = Number(
      await sayfa.eval(() => location.pathname.split("/").pop()),
    );
    rapor.package_id = paketId;
    kaydet("istasyon ekranı açıldı", paketId > 0, `paket #${paketId}`);

    /* ── 2. Kalemleri okut ── */
    for (const urun of SEED.products) {
      for (let i = 0; i < urun.qty; i++) {
        await sayfa.bekle(
          () => Boolean(document.querySelector('form input[type=text], form input:not([type])')),
          { aciklama: "okutma kutusu" },
        );
        await sayfa.eval(
          metinYaz,
          "form input[type=text], form input:not([type])",
          urun.barcode,
        );
        await sayfa.eval(() => {
          const f = document.querySelector("form");
          const b = f?.querySelector('button[type=submit]');
          b ? b.click() : f?.requestSubmit();
        });
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    const uyari = await sayfa.eval(uyariMetni);
    kaydet("okutma sonucu sayfa içinde görünüyor", uyari.length > 0, uyari.slice(0, 120));
    await sayfa.ekranGoruntusu("02-istasyon.png");

    /* ── 3. Paketi tamamla ── */
    const tamamla = await sayfa.eval(metneTikla, "paketi tamamla|paketi kapat", "tamamla");
    zorunlu("tamamla butonu tıklanabilir", tamamla.ok, JSON.stringify(tamamla));
    // Bekleme ÖLÇÜLEBİLİR bir sonuca bağlanmalı: ilk hâli gövdede "hazır"
    // arıyordu ve sayfanın kendi açıklama metni ("…dağıtıma hazır sayılır")
    // yüzünden ANINDA geçiyordu — sonra backend paketi hâlâ OPEN görüyordu.
    // Etiket düğmesi yalnız kapanmış pakette çıkar, yani doğru sinyal odur.
    await sayfa.bekle(
      () =>
        [...document.querySelectorAll("button")].some(
          (b) => /etiket/i.test(b.textContent || "") && b.offsetParent !== null,
        ),
      { aciklama: "paket kapandı ve etiket düğmesi belirdi", ms: 20000 },
    );
    kaydet("paket tamamlandı ve etiket düğmesi belirdi (UI)", true);

    const paketDurum = await api(adminToken, `/packing/packages/${paketId}`);
    zorunlu(
      "backend paket durumu PACKED",
      paketDurum.json?.status === "PACKED",
      paketDurum.json?.status,
    );
    const beklenenQr = paketDurum.json.qr_payload;
    rapor.qr_payload = beklenenQr;

    /* ── 4. Etiket + gerçek baskı ── */
    const etiket = await sayfa.eval(metneTikla, "etiket", "etiket");
    zorunlu("etiket butonu UI'da erişilebilir", etiket.ok, JSON.stringify(etiket));
    await sayfa.bekle(() => Boolean(document.querySelector(".package-label")), {
      aciklama: "etiket render edildi",
    });
    await sayfa.ekranGoruntusu("03-etiket-ekran.png");

    const qrDeger = await sayfa.eval(() => {
      const svg = document.querySelector(".package-label svg");
      return svg ? svg.getAttribute("data-qr-value") ?? "" : "";
    });
    rapor.qr_svg_attr = qrDeger;

    const pdf = await sayfa.gonder("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
    });
    const pdfYol = join(OUT, "paket-etiketi.pdf");
    writeFileSync(pdfYol, Buffer.from(pdf.data, "base64"));
    rapor.pdf = pdfYol;
    kaydet("baskı PDF'i üretildi", true, pdfYol);

    /* ── 5. Turu hazırla (API — tur planlama UI'si kapsam dışı) ── */
    const ekle = await api(adminToken, `/delivery/runs/${SEED.run_id}/stops`, {
      method: "POST",
      body: JSON.stringify({ order_ids: [SEED.order_id] }),
    });
    zorunlu("sipariş tura eklendi", ekle.status < 300, `${ekle.status} ${ekle.ham.slice(0, 200)}`);

    /* ── 6. Kurye UI: zimmet ── */
    await sayfa.eval(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await uiGiris(sayfa, SEED.courier_email, SEED.courier_password);
    kaydet("kurye UI girişi", true);

    await sayfa.git(`${FRONTEND}/dagitim/${SEED.run_id}/zimmet`);
    await sayfa.bekle(() => /zimmet|teslim al|araca/i.test(document.body.innerText), {
      aciklama: "zimmet ekranı",
      ms: 20000,
    });
    kaydet("kurye zimmet ekranı açıldı", true);
    await sayfa.ekranGoruntusu("04-zimmet.png");

    const sayacVar = await sayfa.eval(metinVarMi, "0\\s*/\\s*1|\\d+\\s*/\\s*\\d+");
    kaydet("zimmet sayacı (N / M) görünüyor", sayacVar);

    // 6a. YANLIŞ QR türü (durak yükü) — istemcide ayırt edilmeli, sunucuya gitmemeli
    const oncekiIstekSayisi = await sayfa.eval(() => {
      window.__f30_istekler = window.__f30_istekler ?? 0;
      if (!window.__f30_yamali) {
        const orj = window.fetch;
        window.fetch = function (...a) {
          if (String(a[0]).includes("/handover/scan")) window.__f30_istekler++;
          return orj.apply(this, a);
        };
        const xhrAc = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, u, ...r) {
          if (String(u).includes("/handover/scan")) window.__f30_istekler++;
          return xhrAc.call(this, m, u, ...r);
        };
        window.__f30_yamali = true;
      }
      return window.__f30_istekler;
    });
    await sayfa.eval(metinYaz, 'input[type=text]', "31:durakTokeni");
    await sayfa.eval(() => {
      const f = document.querySelector("form");
      const b = f?.querySelector('button[type=submit]');
      b ? b.click() : f?.requestSubmit();
    });
    await new Promise((r) => setTimeout(r, 800));
    const yanlisUyari = await sayfa.eval(uyariMetni);
    kaydet(
      "yanlış QR türü sayfa içinde açık hata veriyor",
      /paket|etiket|yanlış/i.test(yanlisUyari),
      yanlisUyari.slice(0, 140),
    );
    const sonrakiIstek = await sayfa.eval(() => window.__f30_istekler ?? 0);
    kaydet(
      "yanlış QR sunucuya GİTMEDİ",
      sonrakiIstek === oncekiIstekSayisi,
      `${oncekiIstekSayisi} → ${sonrakiIstek}`,
    );

    // 6b. DOĞRU QR
    await sayfa.eval(metinYaz, 'input[type=text]', beklenenQr);
    await sayfa.eval(() => {
      const f = document.querySelector("form");
      const b = f?.querySelector('button[type=submit]');
      b ? b.click() : f?.requestSubmit();
    });
    await sayfa.bekle(() => /1\s*\/\s*1|zimmetlendi|teslim alındı|araçta/i.test(document.body.innerText), {
      aciklama: "zimmet başarılı",
    });
    kaydet("doğru QR ile zimmet tamamlandı", true);
    await sayfa.ekranGoruntusu("05-zimmet-sonrasi.png");

    // 6c. TEKRAR QR — ikinci yan etki olmamalı
    await sayfa.eval(metinYaz, 'input[type=text]', beklenenQr);
    await sayfa.eval(() => {
      const f = document.querySelector("form");
      const b = f?.querySelector('button[type=submit]');
      b ? b.click() : f?.requestSubmit();
    });
    await new Promise((r) => setTimeout(r, 900));
    const tekrarUyari = await sayfa.eval(uyariMetni);
    kaydet(
      "tekrar okutma kullanıcıya bildiriliyor",
      tekrarUyari.length > 0,
      tekrarUyari.slice(0, 140),
    );

    const sonPaket = await api(adminToken, `/packing/packages/${paketId}`);
    kaydet(
      "paket HANDED_OVER ve tek damga",
      sonPaket.json?.status === "HANDED_OVER" && Boolean(sonPaket.json?.handed_over_at),
      `${sonPaket.json?.status} @ ${sonPaket.json?.handed_over_at}`,
    );
    rapor.handed_over_at = sonPaket.json?.handed_over_at;
    rapor.handed_to_courier_id = sonPaket.json?.handed_to_courier_id;
    kaydet(
      "handed_to_courier_id doğru kurye",
      sonPaket.json?.handed_to_courier_id === SEED.courier_id,
      `${sonPaket.json?.handed_to_courier_id} (beklenen ${SEED.courier_id})`,
    );

    rapor.govde_sonu = (await sayfa.eval(govdeMetni)).slice(0, 400);
  } catch (e) {
    kaydet("AKIŞ", false, e.message);
    try {
      await sayfa.ekranGoruntusu("99-hata.png");
    } catch {
      /* ekran görüntüsü de alınamadı */
    }
  } finally {
    rapor.adimlar = adimlar;
    writeFileSync(join(OUT, "rapor.json"), JSON.stringify(rapor, null, 2));
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/close/x`).catch(() => {});
    } catch {
      /* yok say */
    }
    chrome.kill();
  }

  const basarisiz = adimlar.filter((a) => !a.ok);
  console.log(
    `\n${adimlar.length - basarisiz.length}/${adimlar.length} adım geçti` +
      (basarisiz.length ? ` — DÜŞEN: ${basarisiz.map((a) => a.adim).join(", ")}` : ""),
  );
  process.exit(basarisiz.length ? 1 : 0);
}

ana();
