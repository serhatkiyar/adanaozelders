// ANASAYFA MOBIL TURU - gercek Chrome, gercek CSS duzeni.
//
// NEDEN VITEST DEGIL: burada olculen seyler YERLESIMdir - yatay tasma, iki
// ogenin ust uste binmesi, dokunma hedefinin kac piksel oldugu, ust barin
// ekranin ne kadarini yedigi. jsdom kutu modeli hesaplamaz; orada butun bu
// sayilar 0'dir ve her iddia bedava gecer (kok CLAUDE.md F).
//
// Yakaladigi hatalar (olculdu 9 Eyl 2026, duzeltmeden ONCE, 390x844):
//   - navbar'da kelime logosu (sag kenar 245px) ile "Ders Ver" dugmesi (sol
//     kenar 203px) 42px ust uste biniyordu; dugme metinleri iki satira
//     kirilmisti.
//   - ust bar 224px, yani ekranin %27'si.
//   - 44px'in altinda 27 dokunma hedefi (favori 28x28, kaydirma oklari 28x28,
//     footer linkleri 16-20px).
//
// Kullanim (frontend/):
//   npm run dev -- --port 5199
//   node scripts/anasayfa_mobil_turu.mjs --frontend http://localhost:5199
//
// NOT: adres `localhost` OLMALI - backend CORS yalniz onu taniyor; 127.0.0.1
// ile sayfa veri alamaz ve kapi YALANCI YESIL verir (bos sayfa tasmaz, bos
// sayfada kucuk dokunma hedefi de yoktur). Kapi bu yuzden verinin geldigini
// AYRICA dogrular.
//
// Mutasyon provasi:
//   node scripts/anasayfa_mobil_turu.mjs --frontend http://localhost:5199 --negatif 1
// Kartlari sisirir, alt cubugu gizler ve bir dokunma hedefini kucultur;
// kapilarin KIRMIZI dusmesi beklenir. Dusmezse kapi bir sey olcmuyordur.
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
const OUT = resolve(ARGS.out ?? "../docs/anasayfa-mobil");
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9493);
const NEGATIF = ARGS.negatif === "1";
const GENISLIKLER = [360, 390, 414, 768];

/** Dokunma hedefi esigi - `scripts/sihirbaz_mobil_turu.mjs` ile AYNI sayi. */
const HEDEF_EN_AZ = 44;
/** Ust bar tavani: 224px olculmustu; hedef Airbnb'nin ~120px'i, pay birakildi. */
const UST_BAR_TAVANI = 140;
/** Alt cubuk taban yuksekligi (bilesendeki ALT_SEKME_YUKSEKLIGI ile ayni fikir). */
const ALT_CUBUK_EN_AZ = 56;

async function chromeBaslat() {
  const profil = join(tmpdir(), `anasayfa-mobil-turu-${process.pid}`);
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
  // EKLENTISININ arka plan sayfasini da yakalar ve kapi bos bir belgeyi olcup
  // YALANCI YESIL verir.
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const hedef = hedefler.find(
    (t) => t.type === "page" && /^https?:|^about:blank/.test(t.url ?? "")
  );
  if (!hedef) throw new Error("Olculecek sayfa sekmesi bulunamadi");
  const ws = new WebSocket(hedef.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pend = new Map();
  const konsolHatalari = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") {
      konsolHatalari.push(m.params?.exceptionDetails?.text ?? "istisna");
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") {
      konsolHatalari.push(
        (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")
      );
    }
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
  const ev = async (fn, arg) => {
    const r = await send("Runtime.evaluate", {
      expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  for (const genislik of GENISLIKLER) {
    konsolHatalari.length = 0;
    // TAZE yukleme: once daraltip SONRA gitmek sart. Genis yukleyip daraltmak
    // yeniden duzenlemeyi olcer, gercek telefonu degil.
    await send("Emulation.setDeviceMetricsOverride", {
      width: genislik,
      height: 844,
      deviceScaleFactor: 1,
      mobile: genislik < 700,
    });
    await send("Page.navigate", { url: `${FRONTEND}/` });
    for (let i = 0; i < 120; i++) {
      if (await ev(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 2600));

    if (NEGATIF) {
      // Mutasyon: kapilarin gercekten olctugunu kanitlar.
      await ev(() => {
        const st = document.createElement("style");
        // Her kapi ICIN bir mutasyon: biri eksik kalirsa o kapinin gercekten
        // olctugunu kimse kanitlamamis olur.
        st.textContent = `
          /* tasma kapisi: kaydirma kabinin DISINDA bir oge ekrandan tasar */
          main section { min-width: 900px !important; }
          /* cakisma + ust bar kapilari: mobilde gizlenen logo/dugme satirini
             geri ac - duzeltmeden onceki 42px'lik binisme geri gelir */
          header > div > div:first-child { display: flex !important; }
          /* alt cubuk kapisi */
          nav[aria-label="Alt gezinme"] { display: none !important; }
          /* dokunma hedefi kapisi */
          footer a { min-height: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; }
        `;
        document.head.appendChild(st);
        return true;
      });
      await new Promise((r) => setTimeout(r, 400));
    }

    const olcum = await ev(
      (esikler) => {
        const { HEDEF_EN_AZ, UST_BAR_TAVANI, ALT_CUBUK_EN_AZ } = esikler;
        const kok = document.documentElement;
        const gorunur = (el) => {
          const s = getComputedStyle(el);
          if (s.visibility === "hidden" || s.display === "none") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };

        /* ── 1. Yatay tasma ─────────────────────────────────────────── */
        const suclular = [];
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > kok.clientWidth + 1) {
            const kirpan = el.parentElement?.closest(
              ".overflow-x-auto,.overflow-auto,.overflow-hidden,.overflow-x-hidden"
            );
            if (kirpan) continue; // kaydirma kabinin ICI tasabilir, normaldir
            suclular.push({
              etiket: el.tagName.toLowerCase(),
              sinif: (el.className?.toString?.() ?? "").slice(0, 80),
              genislik: Math.round(r.width),
            });
          }
        }

        /* ── 2. Ust bardaki cakismalar ──────────────────────────────────
           42px'lik logo-dugme binismesi tam olarak buydu: hicbir sey tasmiyor,
           iki oge birbirinin uzerine biniyordu. Tasma olcumu bunu GORMEZ. */
        const bas = document.querySelector("header");
        const cakismalar = [];
        if (bas) {
          const ogeler = Array.from(bas.querySelectorAll("a,button,img,input"))
            .filter(gorunur)
            .map((el) => ({ el, r: el.getBoundingClientRect() }));
          for (let i = 0; i < ogeler.length; i++) {
            for (let j = i + 1; j < ogeler.length; j++) {
              const a = ogeler[i];
              const b = ogeler[j];
              // Ic ice ogeler dogal olarak "cakisir" - onlari elemek sart.
              if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
              const g = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
              const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
              if (g > 1 && y > 1) {
                cakismalar.push({
                  a: (a.el.getAttribute("aria-label") || a.el.textContent || a.el.tagName)
                    .trim()
                    .slice(0, 30),
                  b: (b.el.getAttribute("aria-label") || b.el.textContent || b.el.tagName)
                    .trim()
                    .slice(0, 30),
                  px: Math.round(g),
                });
              }
            }
          }
        }

        /* ── 3. Dokunma hedefleri ───────────────────────────────────── */
        const kucukHedefler = [];
        for (const el of Array.from(
          document.querySelectorAll('a,button,input,select,[role="button"]')
        )) {
          if (!gorunur(el)) continue;
          // React Query devtools dugmesi URUNDE YOKTUR (yalniz `npm run dev`).
          // Olcume katilsaydi kapi hicbir zaman yesile donemezdi.
          if (el.closest(".tsqd-parent-container,[data-tsqd-open-btn]")) continue;
          if ((el.getAttribute("aria-label") || "").includes("Tanstack query")) continue;
          const r = el.getBoundingClientRect();
          if (r.height < HEDEF_EN_AZ - 0.5 || r.width < 24) {
            kucukHedefler.push({
              ad: (el.getAttribute("aria-label") || el.textContent || el.tagName)
                .trim()
                .slice(0, 30),
              w: Math.round(r.width),
              h: Math.round(r.height),
            });
          }
        }

        /* ── 4. Ust bar yuksekligi ──────────────────────────────────── */
        const ustBar = bas ? Math.round(bas.getBoundingClientRect().height) : 0;

        /* ── 5. Alt sekme cubugu ────────────────────────────────────── */
        const cubuk = document.querySelector('nav[aria-label="Alt gezinme"]');
        const cubukR = cubuk ? cubuk.getBoundingClientRect() : null;
        const cubukVar = !!cubuk && gorunur(cubuk);
        const cubukYuksek = cubukR ? Math.round(cubukR.height) : 0;
        // Cubuk sayfanin SON icerigini ortuyor mu: spacer dogru calisiyorsa
        // footer'in alti cubugun ustunde biter.
        const alt = document.querySelector("footer");
        let ortuyor = false;
        let ortmePx = 0;
        if (cubukR && alt) {
          // KAYDIRMADAN olculur. `scrollTo` ile en alta inip okumak yanlisti:
          // `html { scroll-behavior: smooth }` yururlukte oldugu icin kaydirma
          // animasyonludur ve hemen sonraki `getBoundingClientRect` HALA eski
          // konumu dondurur - kapi hayali bir ortme raporluyordu.
          const altDip = alt.getBoundingClientRect().bottom + window.scrollY;
          const sayfaDibi = kok.scrollHeight - Math.round(cubukR.height);
          ortmePx = Math.round(altDip - sayfaDibi);
          ortuyor = ortmePx > 0;
        }

        /* ── 6. Yalanci yesil nobetcisi ─────────────────────────────── */
        const kartVar =
          Array.from(document.querySelectorAll("main a[href^='/egitmenler/']")).filter(
            gorunur
          ).length > 0;

        return {
          govde: kok.clientWidth,
          tasma: Math.max(0, kok.scrollWidth - kok.clientWidth),
          suclular: suclular.slice(0, 6),
          cakismalar: cakismalar.slice(0, 6),
          kucukHedefSayi: kucukHedefler.length,
          kucukHedefler: kucukHedefler.slice(0, 8),
          ustBar,
          ustBarTavani: UST_BAR_TAVANI,
          cubukVar,
          cubukYuksek,
          cubukEnAz: ALT_CUBUK_EN_AZ,
          cubukOrtuyor: ortuyor,
          ortmePx,
          kartVar,
        };
      },
      { HEDEF_EN_AZ, UST_BAR_TAVANI, ALT_CUBUK_EN_AZ }
    );

    // 768px `md` bandidir: orada masaustu duzeni yururlukte, alt cubuk
    // BILEREK cizilmez ve ust bar dogal olarak daha yuksektir.
    const mobilBant = genislik < 768;
    sonuclar.push({ genislik, mobilBant, ...olcum, konsolHatalari: [...konsolHatalari] });

    const kapilar = [
      ["tasma", olcum.tasma === 0],
      ["cakisma", olcum.cakismalar.length === 0],
      ["dokunmaHedefi", !mobilBant || olcum.kucukHedefSayi === 0],
      ["ustBarYuksekligi", !mobilBant || olcum.ustBar <= UST_BAR_TAVANI],
      ["altCubuk", !mobilBant || (olcum.cubukVar && olcum.cubukYuksek >= ALT_CUBUK_EN_AZ)],
      ["cubukOrtmuyor", !mobilBant || !olcum.cubukOrtuyor],
      ["veriGeldi", olcum.kartVar],
      ["konsolTemiz", konsolHatalari.length === 0],
    ];
    const dusenKapi = kapilar.filter(([, ok]) => !ok).map(([ad]) => ad);
    console.log(
      `${dusenKapi.length === 0 ? "GECTI" : "DUSTU"}  ${genislik}px  ` +
        `tasma=${olcum.tasma} cakisma=${olcum.cakismalar.length} ` +
        `kucukHedef=${olcum.kucukHedefSayi} ustBar=${olcum.ustBar}px ` +
        `cubuk=${olcum.cubukVar ? olcum.cubukYuksek + "px" : "yok"}` +
        (dusenKapi.length ? `  -> ${dusenKapi.join(",")}` : "")
    );

    if (olcum.tasma > 0)
      dusenler.push(
        `${genislik}px: yatay tasma ${olcum.tasma}px - ilk suclu ${JSON.stringify(olcum.suclular[0] ?? null)}`
      );
    if (olcum.cakismalar.length)
      dusenler.push(
        `${genislik}px: ust barda ${olcum.cakismalar.length} cakisma - ${JSON.stringify(olcum.cakismalar[0])}`
      );
    if (mobilBant && olcum.kucukHedefSayi > 0)
      dusenler.push(
        `${genislik}px: ${HEDEF_EN_AZ}px alti ${olcum.kucukHedefSayi} dokunma hedefi - ${JSON.stringify(olcum.kucukHedefler.slice(0, 3))}`
      );
    if (mobilBant && olcum.ustBar > UST_BAR_TAVANI)
      dusenler.push(`${genislik}px: ust bar ${olcum.ustBar}px (tavan ${UST_BAR_TAVANI})`);
    if (mobilBant && !olcum.cubukVar)
      dusenler.push(`${genislik}px: alt sekme cubugu cizilmedi`);
    if (mobilBant && olcum.cubukVar && olcum.cubukYuksek < ALT_CUBUK_EN_AZ)
      dusenler.push(
        `${genislik}px: alt cubuk ${olcum.cubukYuksek}px (taban ${ALT_CUBUK_EN_AZ})`
      );
    if (mobilBant && olcum.cubukOrtuyor)
      dusenler.push(
        `${genislik}px: alt cubuk sayfanin son icerigini ${olcum.ortmePx}px ortuyor (spacer yuksekligi?)`
      );
    if (!olcum.kartVar)
      dusenler.push(`${genislik}px: egitmen karti hic basilmadi (veri gelmedi mi? CORS?)`);
    if (konsolHatalari.length)
      dusenler.push(`${genislik}px: konsol hatasi - ${konsolHatalari[0]?.slice(0, 120)}`);

    if (genislik === 390) {
      const ss = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(join(OUT, `kapi-390${NEGATIF ? "-negatif" : ""}.png`), Buffer.from(ss.data, "base64"));
    }
  }
  writeFileSync(
    join(OUT, `mobil-tur${NEGATIF ? "-negatif" : ""}.json`),
    JSON.stringify({ sonuclar, dusenler }, null, 2)
  );
} finally {
  chrome.kill();
}

if (NEGATIF) {
  // Ters prova: mutasyon altinda kapi GECERSE olcmuyordur.
  if (dusenler.length === 0) {
    console.error("\nMUTASYON PROVASI BASARISIZ: bozulmus sayfada kapi GECTI.");
    process.exit(1);
  }
  console.log(`\nMUTASYON PROVASI GECTI: kapi ${dusenler.length} kusuru yakaladi.`);
  for (const d of dusenler) console.log("  - " + d);
  process.exit(0);
}

if (dusenler.length) {
  console.error(`\nKAPI DUSTU (${dusenler.length}):`);
  for (const d of dusenler) console.error("  - " + d);
  process.exit(1);
}
console.log("\nKAPI GECTI: ana sayfa hicbir mobil genislikte tasma, cakisma veya kucuk dokunma hedefi uretmiyor.");
