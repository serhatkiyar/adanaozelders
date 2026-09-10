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
/**
 * Olculen yuzeyler. Ana sayfa ile arama SONUCU ayni kabugu paylasmaz ve
 * ikisi de mobil icin ayri ayri tasarlandi; birini olcup otekini birakmak
 * "kapi var" duygusu verir ama borcun yarisini serbest birakir.
 */
const KART_SECICI = "main a[href^='/egitmenler/']";
const ROTALAR = [
  {
    yol: "/",
    ad: "anasayfa",
    cubukBekleniyor: true,
    ustBarTavani: 140,
    hazir: KART_SECICI,
    veri: [KART_SECICI],
  },
  {
    yol: "/egitmenler",
    ad: "arama",
    cubukBekleniyor: true,
    ustBarTavani: 140,
    hazir: KART_SECICI,
    veri: [KART_SECICI],
  },
  /*
   * EGITMEN PROFILI — mobil DETAY ekrani (kullanici karari, 10 Eyl 2026).
   *
   * Ust bar da alt sekme cubugu da CIZILMEZ; sayfanin tek eylemi alttaki sabit
   * seritdir. Kapilar bu yuzden otekilerin TERSINI dogrular: cubugun YOKLUGU,
   * ust barin YOKLUGU (tavan 0) ve seridin VARLIGI.
   *
   * Yol SABIT YAZILMAZ: gercek bir egitmen id'si gerekiyor ve sabit yazilirsa
   * veri degisince kapi bir 404 sayfasini olcup YALANCI YESIL verir (bos sayfa
   * tasmaz, bos sayfada kucuk dokunma hedefi de yoktur). Adres arama
   * ekranindaki ilk karttan turetilir; bulunamazsa tur FIRLATIR.
   */
  {
    yol: null,
    ad: "profil",
    coz: true,
    cubukBekleniyor: false,
    seritBekleniyor: true,
    ustBarTavani: 0,
    hazir: '[data-serit="ders-talep"] button',
    veri: ['[data-hero="egitmen"]', "main h1", '[data-serit="ders-talep"] button'],
    // 768px `md` bandinda sayfa MASAUSTU dalini mount eder (`useMobil()`):
    // hero da sabit serit de YOKTUR ve olmamalidir. Kanit orada karttir.
    hazirMasaustu: "main h1",
    veriMasaustu: ["main h1"],
  },
];

/** Dokunma hedefi esigi - `scripts/sihirbaz_mobil_turu.mjs` ile AYNI sayi. */
const HEDEF_EN_AZ = 44;
/**
 * Ust bar tavani ROTA BASINADIR.
 *
 * Sayilar keyfi degil: bu tur ilk kosuldugunda ana sayfanin ust bari 224px'ti
 * (844px ekranin %27'si) ve sikayetin kaynagi oydu. Bugunku olcumler:
 *
 *   anasayfa — arama hapi + kategori cip seridi              → 136 (tavan 140)
 *   arama    — geri/hap/filtre satiri + filtre cip seridi    → 125 (tavan 140)
 *
 * Tavan olculen degerin HEMEN ustunde durur: bir satir daha eklenmesi sessiz
 * kalmasin. Arama sayfasi bir ara 153px'ti ve tavan gecici olarak 160'a
 * cikarilmisti; cipler inceltilince (kullanici itirazi) olcum 125'e dustu ve
 * tavan geri sikilastirildi — yukseltilmis bir tavani geri indirmemek, kapiyi
 * sessizce ise yaramaz hale getirir.
 */
/** Alt cubuk taban yuksekligi (bilesendeki ALT_SEKME_YUKSEKLIGI ile ayni fikir). */
const ALT_CUBUK_EN_AZ = 56;
/** Sabit CTA seridi taban yuksekligi (`DersTalepSeridi.SERIT_YUKSEKLIGI` fikri). */
const SERIT_EN_AZ = 56;

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
/** Mutasyon provasinin muhasebesi: "rota:kapi" biciminde dusen kapilar. */
const dusenKapiKumesi = new Set();
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

  /**
   * Profil adresini ARAMA EKRANINDAN turetir. Sabit slug yazmak, veri
   * degisince kapiyi bir 404 sayfasina baktirir ve yalanci yesil verir.
   */
  const profilYoluCoz = async () => {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await send("Page.navigate", { url: `${FRONTEND}/egitmenler` });
    for (let i = 0; i < 60; i++) {
      const yol = await ev((sec) => {
        const a = document.querySelector(sec);
        return a ? new URL(a.href).pathname : null;
      }, KART_SECICI);
      if (yol) return yol;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
      "Profil rotasi cozulemedi: arama ekraninda hic egitmen karti yok " +
        "(backend ayakta mi? CORS icin adres localhost mu?)"
    );
  };

  for (const rota of ROTALAR) {
    if (rota.coz) rota.yol = await profilYoluCoz();
  }

  for (const rota of ROTALAR)
  for (const genislik of GENISLIKLER) {
    const { yol, ad } = rota;
    konsolHatalari.length = 0;
    // TAZE yukleme: once daraltip SONRA gitmek sart. Genis yukleyip daraltmak
    // yeniden duzenlemeyi olcer, gercek telefonu degil.
    await send("Emulation.setDeviceMetricsOverride", {
      width: genislik,
      height: 844,
      deviceScaleFactor: 1,
      mobile: genislik < 700,
    });
    await send("Page.navigate", { url: `${FRONTEND}${yol}` });
    for (let i = 0; i < 120; i++) {
      if (await ev(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 1200));
    // Sabit bekleme YETMIYOR: veri yavas gelirse "yalanci yesil nobetcisi"
    // (kart var mi) kendisi yanlis alarm verir - olculdu, 768px'te bir tur
    // boyle dustu. Kartlari BEKLE, sonra olc; sure dolarsa gercekten yok
    // demektir ve kapi hakli olarak kirmizi duser.
    const mobilBantMi = genislik < 768;
    const hazirSecici =
      (!mobilBantMi && rota.hazirMasaustu) || rota.hazir;
    const veriSecicileri =
      (!mobilBantMi && rota.veriMasaustu) || rota.veri;
    for (let i = 0; i < 32; i++) {
      const hazir = await ev(
        (sec) => document.querySelectorAll(sec).length > 0,
        hazirSecici
      );
      if (hazir) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    if (NEGATIF) {
      /*
       * Mutasyon: kapilarin gercekten olctugunu kanitlar.
       *
       * ROTA BASINA ayri: profil rotasinda kapilarin YONU tersine dondu
       * (cubugun YOKLUGU dogrulaniyor) ve orada `nav{display:none}` kapiyi
       * KIRMAZ, tersine DOGRULAR. Kopyala-yapistir tek bir mutasyon, yeni
       * kapilarin hicbirini kanitlamazdi.
       */
      await ev((profilMi) => {
        const st = document.createElement("style");
        st.textContent = profilMi
          ? `
            /* sabitSerit: seridi ezici sekilde kucult. GIZLEMEK yanlis olurdu:
               gizli serit "ekranin dibine yapisan oge" olmaktan cikar ve
               ortme (cubukOrtmuyor) kapisi hic olculmeden gecerdi. */
            [data-serit="ders-talep"] { min-height: 0 !important; height: 8px !important;
              padding: 0 !important; overflow: hidden !important; }
            /* cubukOrtmuyor: kabugun serit icin BIRAKTIGI bosluğu sifirla.
               Gercek kusur buydu (10 Eyl 2026): serit sayfanin son icerigini
               73px ortuyordu. */
            :root { --sabit-serit: 0px !important; }
            /* veriGeldi: hero'yu yok et */
            [data-hero="egitmen"] { display: none !important; }
            /* dokunmaHedefi */
            main button, footer a { min-height: 0 !important; height: 8px !important;
              padding-top: 0 !important; padding-bottom: 0 !important; }
          `
          : `
            /* cakisma + ust bar kapilari: mobilde gizlenen logo/dugme satirini
               geri ac - duzeltmeden onceki 42px'lik binisme geri gelir */
            header > div > div:first-child { display: flex !important; }
            /* alt cubuk kapisi */
            nav[aria-label="Alt gezinme"] { display: none !important; }
            /* dokunma hedefi kapisi */
            footer a { min-height: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; }
          `;
        document.head.appendChild(st);

        // tasma kapisi: kaydirma kabinin DISINDA, her rotada AYNI sekilde
        // tasan bir kutu. Sinifa/yapiya dayanan bir seciciyle yapilamaz -
        // sayfalarin markup'i ayni degil ve bir rotada sessizce bos kalir.
        const govde = document.querySelector("main");
        if (govde) {
          const tasan = document.createElement("div");
          tasan.style.cssText = "width:900px;height:8px;background:transparent";
          govde.appendChild(tasan);
        }

        if (profilMi) {
          // altCubuk (YOKLUK iddiasi) ancak bir cubuk ENJEKTE edilirse kirilir.
          const n = document.createElement("nav");
          n.setAttribute("aria-label", "Alt gezinme");
          n.style.cssText =
            "position:fixed;left:0;right:0;bottom:0;height:60px;background:#fff;z-index:50";
          document.body.appendChild(n);
          // ustBarYuksekligi (tavan 0) ancak bir ust bar ENJEKTE edilirse kirilir.
          const h = document.createElement("header");
          h.style.cssText = "height:120px;background:#fff";
          document.body.prepend(h);
        }
        return true;
      }, ad === "profil");
      await new Promise((r) => setTimeout(r, 400));
    }

    const UST_BAR_TAVANI = rota.ustBarTavani;
    const olcum = await ev(
      (esikler) => {
        const { HEDEF_EN_AZ, UST_BAR_TAVANI, ALT_CUBUK_EN_AZ, VERI_SECICILERI } =
          esikler;
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

        /* ── 5. Alt sekme cubugu + sabit CTA seridi ─────────────────── */
        const cubuk = document.querySelector('nav[aria-label="Alt gezinme"]');
        const cubukR = cubuk ? cubuk.getBoundingClientRect() : null;
        const cubukVar = !!cubuk && gorunur(cubuk);
        const cubukYuksek = cubukR ? Math.round(cubukR.height) : 0;

        const serit = document.querySelector('[data-serit="ders-talep"]');
        const seritVar = !!serit && gorunur(serit);
        const seritYuksek = serit
          ? Math.round(serit.getBoundingClientRect().height)
          : 0;

        // Ekranin dibine YAPISAN oge hangisiyse ortme onunla olculur: eskiden
        // yalniz alt sekme cubugu bakiliyordu ve sabit CTA seridi hicbir sey
        // olcmuyordu (spacer'i sifirlansa kapi sessiz kalirdi).
        const sabitAlt = cubukVar ? cubuk : seritVar ? serit : null;
        const sabitR = sabitAlt ? sabitAlt.getBoundingClientRect() : null;
        // `footer` yoksa (girisli kabukta yok) sayfanin SON gorunur icerigi.
        let alt = document.querySelector("footer");
        if (!alt || !gorunur(alt)) {
          const govde = document.querySelector("main");
          alt = null;
          if (govde) {
            const cocuklar = Array.from(govde.querySelectorAll("*")).filter(gorunur);
            alt = cocuklar[cocuklar.length - 1] ?? govde;
          }
        }
        let ortuyor = false;
        let ortmePx = 0;
        if (sabitR && alt) {
          // KAYDIRMADAN olculur. `scrollTo` ile en alta inip okumak yanlisti:
          // `html { scroll-behavior: smooth }` yururlukte oldugu icin kaydirma
          // animasyonludur ve hemen sonraki `getBoundingClientRect` HALA eski
          // konumu dondurur - kapi hayali bir ortme raporluyordu.
          const altDip = alt.getBoundingClientRect().bottom + window.scrollY;
          const sayfaDibi = kok.scrollHeight - Math.round(sabitR.height);
          ortmePx = Math.round(altDip - sayfaDibi);
          ortuyor = ortmePx > 0;
        }

        /* ── 6. Yalanci yesil nobetcisi ─────────────────────────────── */
        // Kanit ROTA BASINA: profil rotasinda egitmen karti YOKTUR, orada
        // kanit hero + baslik + sabit serittir. Tek bir "kart var mi"
        // kontrolu o rotada ya hep kirmizi olurdu ya da kaldirilip kapiyi
        // tamamen bosa dusururdu.
        const veriVar = VERI_SECICILERI.every((sec) => {
          const el = document.querySelector(sec);
          if (!el || !gorunur(el)) return false;
          // Baslik gorunur ama BOS olabilir (iskelet/yukleniyor hali).
          return el.tagName !== "H1" || el.textContent.trim().length > 0;
        });

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
          seritVar,
          seritYuksek,
          cubukOrtuyor: ortuyor,
          ortmePx,
          veriVar,
        };
      },
      {
        HEDEF_EN_AZ,
        UST_BAR_TAVANI,
        ALT_CUBUK_EN_AZ,
        VERI_SECICILERI: veriSecicileri,
      }
    );

    // 768px `md` bandidir: orada masaustu duzeni yururlukte, alt cubuk
    // BILEREK cizilmez ve ust bar dogal olarak daha yuksektir.
    const mobilBant = mobilBantMi;
    sonuclar.push({ rota: ad, genislik, mobilBant, ...olcum, konsolHatalari: [...konsolHatalari] });

    const kapilar = [
      ["tasma", olcum.tasma === 0],
      ["cakisma", olcum.cakismalar.length === 0],
      ["dokunmaHedefi", !mobilBant || olcum.kucukHedefSayi === 0],
      ["ustBarYuksekligi", !mobilBant || olcum.ustBar <= UST_BAR_TAVANI],
      // Kapi ROTA BASINA IKI YONLU: cubuk beklenen yuzeyde VARLIGI, mobil
      // detay ekraninda YOKLUGU dogrulanir. Kapiyi "ya var ya yok" diye
      // gevsetmek, ana sayfa ve aramanin korumasini da dusururdu.
      [
        "altCubuk",
        !mobilBant ||
          (rota.cubukBekleniyor
            ? olcum.cubukVar && olcum.cubukYuksek >= ALT_CUBUK_EN_AZ
            : !olcum.cubukVar),
      ],
      [
        "sabitSerit",
        !mobilBant ||
          !rota.seritBekleniyor ||
          (olcum.seritVar && olcum.seritYuksek >= SERIT_EN_AZ),
      ],
      ["cubukOrtmuyor", !mobilBant || !olcum.cubukOrtuyor],
      ["veriGeldi", olcum.veriVar],
      ["konsolTemiz", konsolHatalari.length === 0],
    ];
    const dusenKapi = kapilar.filter(([, ok]) => !ok).map(([ad]) => ad);
    for (const k of dusenKapi) dusenKapiKumesi.add(`${ad}:${k}`);
    console.log(
      `${dusenKapi.length === 0 ? "GECTI" : "DUSTU"}  ${ad.padEnd(9)} ${genislik}px  ` +
        `tasma=${olcum.tasma} cakisma=${olcum.cakismalar.length} ` +
        `kucukHedef=${olcum.kucukHedefSayi} ustBar=${olcum.ustBar}px ` +
        `cubuk=${olcum.cubukVar ? olcum.cubukYuksek + "px" : "yok"} ` +
        `serit=${olcum.seritVar ? olcum.seritYuksek + "px" : "yok"}` +
        (dusenKapi.length ? `  -> ${dusenKapi.join(",")}` : "")
    );

    if (olcum.tasma > 0)
      dusenler.push(
        `${ad} ${genislik}px: yatay tasma ${olcum.tasma}px - ilk suclu ${JSON.stringify(olcum.suclular[0] ?? null)}`
      );
    if (olcum.cakismalar.length)
      dusenler.push(
        `${ad} ${genislik}px: ust barda ${olcum.cakismalar.length} cakisma - ${JSON.stringify(olcum.cakismalar[0])}`
      );
    if (mobilBant && olcum.kucukHedefSayi > 0)
      dusenler.push(
        `${ad} ${genislik}px: ${HEDEF_EN_AZ}px alti ${olcum.kucukHedefSayi} dokunma hedefi - ${JSON.stringify(olcum.kucukHedefler.slice(0, 3))}`
      );
    if (mobilBant && olcum.ustBar > UST_BAR_TAVANI)
      dusenler.push(`${ad} ${genislik}px: ust bar ${olcum.ustBar}px (tavan ${UST_BAR_TAVANI})`);
    if (mobilBant && rota.cubukBekleniyor && !olcum.cubukVar)
      dusenler.push(`${ad} ${genislik}px: alt sekme cubugu cizilmedi`);
    if (mobilBant && !rota.cubukBekleniyor && olcum.cubukVar)
      dusenler.push(
        `${ad} ${genislik}px: mobil detay ekraninda alt sekme cubugu CIZILDI ` +
          `(${olcum.cubukYuksek}px) - kabuga mobilDetayEkrani gecilmis mi?`
      );
    if (mobilBant && rota.seritBekleniyor && !olcum.seritVar)
      dusenler.push(`${ad} ${genislik}px: sabit "Ders talep et" seridi cizilmedi`);
    if (
      mobilBant &&
      rota.seritBekleniyor &&
      olcum.seritVar &&
      olcum.seritYuksek < SERIT_EN_AZ
    )
      dusenler.push(
        `${ad} ${genislik}px: sabit serit ${olcum.seritYuksek}px (taban ${SERIT_EN_AZ})`
      );
    if (mobilBant && olcum.cubukVar && olcum.cubukYuksek < ALT_CUBUK_EN_AZ)
      dusenler.push(
        `${ad} ${genislik}px: alt cubuk ${olcum.cubukYuksek}px (taban ${ALT_CUBUK_EN_AZ})`
      );
    if (mobilBant && olcum.cubukOrtuyor)
      dusenler.push(
        `${ad} ${genislik}px: alt cubuk sayfanin son icerigini ${olcum.ortmePx}px ortuyor (spacer yuksekligi?)`
      );
    if (!olcum.veriVar)
      dusenler.push(
        `${ad} ${genislik}px: sayfa dolmadi - beklenen ogeler ` +
          `${JSON.stringify(veriSecicileri)} (veri gelmedi mi? CORS?)`
      );
    if (konsolHatalari.length)
      dusenler.push(`${ad} ${genislik}px: konsol hatasi - ${konsolHatalari[0]?.slice(0, 120)}`);

    if (genislik === 390) {
      const ss = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(
        join(OUT, `kapi-${ad}-390${NEGATIF ? "-negatif" : ""}.png`),
        Buffer.from(ss.data, "base64")
      );
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
  /*
   * Ters prova: mutasyon altinda kapi GECERSE olcmuyordur.
   *
   * "Hic dusen var mi" TEK BASINA YETMIYOR: yeni bir kapi hicbir sey olcmese
   * bile ESKI kapilardan biri dustugu icin prova yesil gecerdi - yani yeni
   * kapilar sessizce bos olabilirdi. Muhasebe bu yuzden ROTA+KAPI bazinda:
   * her kapinin kendi mutasyonu tarafindan kirildigi ISIMLE dogrulanir.
   */
  const BEKLENEN_MUTASYON = [
    "anasayfa:tasma",
    "anasayfa:altCubuk",
    "anasayfa:dokunmaHedefi",
    "arama:tasma",
    "arama:altCubuk",
    "arama:dokunmaHedefi",
    "profil:tasma",
    "profil:altCubuk",
    "profil:ustBarYuksekligi",
    "profil:sabitSerit",
    "profil:cubukOrtmuyor",
    "profil:veriGeldi",
    "profil:dokunmaHedefi",
  ];
  console.log("\nMUTASYONDA DUSEN KAPILAR:");
  for (const k of [...dusenKapiKumesi].sort()) console.log("  - " + k);
  const kacan = BEKLENEN_MUTASYON.filter((k) => !dusenKapiKumesi.has(k));
  if (kacan.length) {
    console.error(
      "\nMUTASYON PROVASI BASARISIZ: su kapilar bozulmus sayfada GECTI -> " +
        kacan.join(", ")
    );
    process.exit(1);
  }
  console.log(
    `\nMUTASYON PROVASI GECTI: beklenen ${BEKLENEN_MUTASYON.length} kapinin hepsi kirildi.`
  );
  process.exit(0);
}

if (dusenler.length) {
  console.error(`\nKAPI DUSTU (${dusenler.length}):`);
  for (const d of dusenler) console.error("  - " + d);
  process.exit(1);
}
console.log("\nKAPI GECTI: olculen yuzeylerin hicbiri mobil genisliklerde tasma, cakisma veya kucuk dokunma hedefi uretmiyor.");
