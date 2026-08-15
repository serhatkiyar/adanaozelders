// İP-19 · Filo + gün tahtası — GERÇEK TARAYICI kabulü (Chrome + CDP).
//
// Kök CLAUDE.md §F: "Vitest + typecheck + build'in geçmesi, gerçek tarayıcı
// kabul testinin yerine geçmez." Bu betik F30 boru hattının (aynı dizindeki
// `f30_browser_acceptance.mjs`) altyapı desenini yeniden kullanır: Playwright
// yok, Node 22'nin yerleşik WebSocket'i ile CDP sürülür.
//
// Ölçülenler:
//   1. Yönetici GERÇEK giriş formundan girer (token enjekte edilmez).
//   2. /yonetim/dagitim/araclar — seed araçlar listede; YENİ araç gerçek
//      formdan eklenir ve listede belirir (İP-19'un tezi: araç bir INSERT'tir).
//   3. /yonetim/dagitim — tur formundaki araç seçenekleri SUNUCUDAN gelir
//      (eklenen araç dahil); "Lada ve Corolla" sabit metni yok.
//   4. /yonetim/dagitim/tahta — gün tahtası yüklenir (havuz + optimize butonu).
//   5. /yonetim/dagitim/performans — beş operasyon metriği görünür; veri yok
//      iken "—" (null ≠ %0 ayrımı).
//
// Kullanım:
//   node scripts/ip19_browser_acceptance.mjs \
//     --frontend http://127.0.0.1:5177 --backend http://127.0.0.1:8019 \
//     --admin-email admin@ceyhan.local --admin-password ... --out ./ip19-kabul
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const FRONTEND = ARGS.frontend ?? "http://127.0.0.1:5177";
// MUTLAK yol: Chrome `--user-data-dir`'i göreli yol olarak ÇÖZEMİYOR —
// "veri dizini üzerinde okuma ve yazma işlemi yapamıyor" penceresi açıp
// debug portunu hiç açmadan bekliyordu (ölçüldü, 15 Ağu 2026).
const OUT = resolve(ARGS.out ?? "./ip19-kabul");
const ADMIN_EMAIL = ARGS["admin-email"];
const ADMIN_PASSWORD = ARGS["admin-password"];
const CHROME =
  ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(ARGS.port ?? 9223);

mkdirSync(OUT, { recursive: true });

const adimlar = [];
function kaydet(ad, ok, detay) {
  adimlar.push({ adim: ad, ok, detay });
  console.log(`${ok ? "  \u2713" : "  \u2717"} ${ad}${detay ? ` \u2014 ${detay}` : ""}`);
  if (!ok) process.exitCode = 1;
}
function zorunlu(ad, kosul, detay) {
  kaydet(ad, Boolean(kosul), detay);
  if (!kosul) throw new Error(`KABUL D\u00dc\u015eT\u00dc: ${ad}`);
}

async function chromeBaslat() {
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
      /* bekle */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Chrome DevTools portu a\u00e7\u0131lmad\u0131");
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
          red(new Error(`CDP zaman a\u015f\u0131m\u0131: ${method}`));
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
        `Sayfa i\u00e7i hata: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
      );
    }
    return r.result.value;
  }
  async git(url) {
    await this.gonder("Page.navigate", { url });
    await this.bekle(() => document.readyState === "complete");
    await new Promise((r) => setTimeout(r, 400));
  }
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
    throw new Error(
      `Bekleme zaman a\u015f\u0131m\u0131${aciklama ? `: ${aciklama}` : ""} (son: ${son})`,
    );
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
  await new Promise((coz, red) => {
    ws.addEventListener("open", coz, { once: true });
    ws.addEventListener("error", red, { once: true });
  });
  const s = new Sayfa(ws);
  await s.gonder("Page.enable");
  await s.gonder("Runtime.enable");
  return s;
}

/* Sayfa içinde koşan yardımcılar (closure YOK — her şey argümandan) */
const metinYaz = (secici, deger) => {
  const el = document.querySelector(secici);
  if (!el) return false;
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
  setter.call(el, deger);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
};
const metneTikla = (desen) => {
  const re = new RegExp(desen, "i");
  const adaylar = [...document.querySelectorAll("button, a, [role=button]")].filter(
    (e) =>
      re.test((e.textContent || "").trim()) ||
      re.test((e.getAttribute("aria-label") || "").trim()),
  );
  const gorunur = adaylar.filter((e) => e.offsetParent !== null && !e.disabled);
  if (!gorunur.length) return false;
  gorunur[0].click();
  return true;
};
const metinVarMi = (desen) => new RegExp(desen, "i").test(document.body.innerText);

async function uiGiris(sayfa) {
  await sayfa.git(`${FRONTEND}/giris`);
  await sayfa.bekle(() => Boolean(document.querySelector("input[type=password]")), {
    aciklama: "giri\u015f formu",
  });
  const eSecici = await sayfa.eval(() =>
    document.querySelector("input[type=email]")
      ? "input[type=email]"
      : document.querySelector("input[name=email]")
        ? "input[name=email]"
        : "input:not([type=password])",
  );
  await sayfa.eval(metinYaz, eSecici, ADMIN_EMAIL);
  await sayfa.eval(metinYaz, "input[type=password]", ADMIN_PASSWORD);
  await sayfa.eval(() => {
    const f = document.querySelector("form");
    const b = f?.querySelector("button[type=submit]") ?? f?.querySelector("button");
    b ? b.click() : f?.requestSubmit();
  });
  await sayfa.bekle(() => !location.pathname.startsWith("/giris"), {
    aciklama: "giri\u015ften sonra y\u00f6nlendirme",
    ms: 20000,
  });
}

async function ana() {
  const chrome = await chromeBaslat();
  try {
    const sayfa = await sayfaAc();

    // 1 · Gerçek giriş
    await uiGiris(sayfa);
    kaydet("1. Y\u00f6netici ger\u00e7ek formdan giri\u015f yapt\u0131", true, "");

    // 2 · Araçlar sekmesi: seed + canlı-eklenen listede
    await sayfa.git(`${FRONTEND}/yonetim/dagitim/araclar`);
    await sayfa.bekle(metinVarMi, { aciklama: "ara\u00e7 listesi" }, "Corolla");
    zorunlu(
      "2a. Seed ara\u00e7lar listede (Lada + Corolla)",
      (await sayfa.eval(metinVarMi, "Lada")) &&
        (await sayfa.eval(metinVarMi, "Corolla")),
    );

    // 2b · GERÇEK formdan yeni araç ekle — İP-19'un tezi
    const kod = `KANGOO${Date.now() % 1000}`;
    zorunlu("2b-1. 'Yeni ara\u00e7' formu a\u00e7\u0131ld\u0131",
      await sayfa.eval(metneTikla, "yeni ara\u00e7|ara\u00e7 ekle"));
    await sayfa.bekle(
      () =>
        [...document.querySelectorAll("input")].filter((i) => i.offsetParent)
          .length >= 2,
      { aciklama: "form alanlar\u0131" },
    );
    const dolduruldu = await sayfa.eval(
      (kodArg) => {
        const gorunur = [...document.querySelectorAll("input")].filter(
          (i) => i.offsetParent !== null && i.type !== "checkbox",
        );
        // Alan adları <Field label="..."> sarmalayıcısında yaşıyor — input'un
        // kendi öznitelikleri boş. En yakın label/sarmalayıcı metniyle eşle.
        const bul = (ph) =>
          gorunur.find((i) => {
            const kendi =
              (i.placeholder || "") + (i.name || "") + (i.id || "") +
              (i.getAttribute("aria-label") || "");
            const sarma =
              i.closest("label")?.textContent ??
              i.parentElement?.textContent ??
              "";
            return (kendi + " " + sarma).toLowerCase().includes(ph);
          });
        const yaz = (el, v) => {
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set;
          setter.call(el, v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        };
        const etiketOk = yaz(bul("etiket") ?? bul("label") ?? gorunur[0], `Kangoo ${kodArg}`);
        const kodOk = yaz(bul("kod") ?? bul("code"), kodArg);
        return { etiketOk, kodOk, alanlar: gorunur.length };
      },
      kod,
    );
    zorunlu(
      "2b-2. Form dolduruldu (etiket+kod)",
      dolduruldu.etiketOk && dolduruldu.kodOk,
      JSON.stringify(dolduruldu),
    );
    zorunlu("2b-3. Kaydet t\u0131kland\u0131",
      await sayfa.eval(metneTikla, "kaydet|ekle$|olu\u015ftur"));
    await sayfa.bekle(metinVarMi, { aciklama: "yeni ara\u00e7 listede", ms: 15000 }, "Kangoo");
    kaydet("2b. Yeni ara\u00e7 GER\u00c7EK formdan eklendi ve listede", true, kod);
    await sayfa.ekranGoruntusu("araclar.png");

    // 3 · Bugün: tur formu araç seçenekleri SUNUCUDAN
    await sayfa.git(`${FRONTEND}/yonetim/dagitim`);
    await sayfa.bekle(metinVarMi, { aciklama: "bug\u00fcn sayfas\u0131" }, "tur|da\u011f\u0131t\u0131m");
    const secenekler = await sayfa.bekle(
      () => {
        const s = [...document.querySelectorAll("select")].find((el) =>
          [...el.options].some((o) => /corolla/i.test(o.textContent || "")),
        );
        return s ? [...s.options].map((o) => o.textContent.trim()) : null;
      },
      { aciklama: "ara\u00e7 se\u00e7imi", ms: 15000 },
    );
    zorunlu(
      "3a. Ara\u00e7 se\u00e7enekleri sunucudan (Kangoo dahil)",
      secenekler.some((o) => /kangoo/i.test(o)),
      secenekler.join(", "),
    );
    zorunlu(
      "3b. 'Lada ve Corolla' sabit metni YOK",
      !(await sayfa.eval(metinVarMi, "Lada ve Corolla")),
    );

    // 4 · Gün tahtası
    await sayfa.git(`${FRONTEND}/yonetim/dagitim/tahta`);
    await sayfa.bekle(
      metinVarMi,
      { aciklama: "tahta y\u00fcklendi" },
      "havuz|atanmam\u0131\u015f|tur yok|optimize",
    );
    kaydet("4. G\u00fcn tahtas\u0131 ger\u00e7ek taray\u0131c\u0131da y\u00fcklendi", true, "");
    await sayfa.ekranGoruntusu("tahta.png");

    // 5 · Performans: beş metrik + null → "—"
    await sayfa.git(`${FRONTEND}/yonetim/dagitim/performans`);
    await sayfa.bekle(metinVarMi, { aciklama: "metrikler" }, "Zaman\u0131nda");
    for (const m of ["Zaman\u0131nda", "\u0130lk denemede", "Durak", "km"]) {
      zorunlu(`5. Metrik g\u00f6r\u00fcn\u00fcr: ${m}`, await sayfa.eval(metinVarMi, m));
    }
    zorunlu(
      "5e. Veri yokken '\u2014' (null \u2260 %0)",
      await sayfa.eval(metinVarMi, "\u2014"),
    );
    await sayfa.ekranGoruntusu("performans.png");

    // ── Bağımsız denetim düzeltmeleri (15 Ağu) ──────────────────────────
    //
    // 6 · B-9: başlangıç noktası GERÇEK formdan düzenlenebilir. K-9'un
    //     gerekçesi "nokta veridir, deploy'suz düzenlenir" idi; uç yalnız
    //     GET+POST taşıdığı için yanlış koordinat kalıcı olabiliyordu ve
    //     koordinat, müşteriye gösterilen varış penceresinin başlangıcıdır.
    // "Düzenle" sayfada birden çok yerde var (araç satırları da taşıyor);
    // tıklama BÖLÜME sabitlenir, yoksa ilk görünen buton yakalanır ve yanlış
    // form açılır (ilk koşumda tam bu oldu).
    const bolumdeTikla = (bolumBasligi, desen) => {
      const re = new RegExp(desen, "i");
      const bolum = [...document.querySelectorAll("section")].find((sec) =>
        new RegExp(bolumBasligi, "i").test(sec.innerText || ""),
      );
      if (!bolum) return false;
      const aday = [...bolum.querySelectorAll("button, a, [role=button]")].find(
        (e) =>
          re.test((e.textContent || "").trim()) &&
          e.offsetParent !== null &&
          !e.disabled,
      );
      if (!aday) return false;
      aday.click();
      return true;
    };
    const bolumdeYaz = (bolumBasligi, etiket, deger) => {
      const bolum = [...document.querySelectorAll("section")].find((sec) =>
        new RegExp(bolumBasligi, "i").test(sec.innerText || ""),
      );
      if (!bolum) return false;
      const el = [...bolum.querySelectorAll("input")]
        .filter((i) => i.offsetParent !== null && i.type !== "checkbox")
        .find((i) =>
          ((i.closest("label")?.textContent ?? "") + (i.placeholder || ""))
            .toLowerCase()
            .includes(etiket),
        );
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(el, deger);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };
    const NOKTA = "Başlangıç Noktası";

    await sayfa.git(`${FRONTEND}/yonetim/dagitim/araclar`);
    await sayfa.bekle(metinVarMi, { aciklama: "nokta bolumu" }, "Başlangıç Noktası");
    if (!(await sayfa.eval(metinVarMi, "Düzenle"))) {
      // Migration artık uydurma nokta seed'lemiyor (B-9) — önce gerçeğini ekle.
      zorunlu("6a-0. 'Nokta ekle' açıldı", await sayfa.eval(bolumdeTikla, NOKTA, "nokta ekle"));
      await sayfa.bekle(() => document.querySelectorAll("input").length >= 3, {
        aciklama: "nokta formu",
      });
      await sayfa.eval(bolumdeYaz, NOKTA, "nokta ad", "Kabul Deposu");
      await sayfa.eval(bolumdeYaz, NOKTA, "enlem", "36.98550");
      await sayfa.eval(bolumdeYaz, NOKTA, "boylam", "35.32530");
      zorunlu("6a-1. Nokta eklendi", await sayfa.eval(bolumdeTikla, NOKTA, "^ekle$"));
      await sayfa.bekle(metinVarMi, { aciklama: "nokta listede", ms: 15000 }, "Kabul Deposu");
    }
    zorunlu("6a. Nokta satırında 'Düzenle' var", await sayfa.eval(metinVarMi, "Düzenle"));
    zorunlu("6b. Düzenleme formu açıldı", await sayfa.eval(bolumdeTikla, NOKTA, "^düzenle$"));
    await sayfa.bekle(() => document.querySelectorAll("input").length >= 3, {
      aciklama: "düzenleme formu",
    });
    zorunlu("6c. Enlem alanı dolduruldu", await sayfa.eval(bolumdeYaz, NOKTA, "enlem", "37.00250"));
    zorunlu("6d. Kaydet tıklandı", await sayfa.eval(bolumdeTikla, NOKTA, "^kaydet$"));
    await sayfa.bekle(metinVarMi, { aciklama: "guncellendi", ms: 15000 }, "37\.00250|güncellendi");

    // Kalıcı mı — sayfa yeniden yüklenip SUNUCUDAN okunur.
    await sayfa.git(`${FRONTEND}/yonetim/dagitim/araclar`);
    await sayfa.bekle(metinVarMi, { aciklama: "yeniden yüklendi" }, "Başlangıç Noktası");
    zorunlu(
      "6e. Düzenlenen koordinat SUNUCUDA kalıcı",
      await sayfa.eval(metinVarMi, "37\.00250"),
    );
    await sayfa.ekranGoruntusu("nokta-duzenleme.png");

    // 7 · B-12: tahta ile araçlar sekmesi AYNI uçtan/anahtardan okur.
    //     Gözlemlenebilir iddia: canlı eklenen araçla GERÇEK bir tur kurulur
    //     ve tahtada O ARACIN ETİKETİYLE görünür. (İlk kurgum "araç tahtada
    //     listelenir" idi — yanlıştı: tahta araç listesini yalnız
    //     `vehicle_id → araç` eşlemesi için kullanır, tur yoksa hiçbir araç
    //     çizilmez. Yanlış beklenti düzeltildi, iddia güçlendi.)
    const secimYap = (desen) => {
      const re = new RegExp(desen, "i");
      const sec = [...document.querySelectorAll("select")].find((el) =>
        [...el.options].some((o) => re.test(o.textContent || "")),
      );
      if (!sec) return false;
      const opt = [...sec.options].find((o) => re.test(o.textContent || ""));
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      ).set;
      setter.call(sec, opt.value);
      sec.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };

    await sayfa.git(`${FRONTEND}/yonetim/dagitim`);
    await sayfa.bekle(metinVarMi, { aciklama: "bugün sayfası" }, "tur|dağıtım");
    zorunlu("7a. Yeni araç seçildi", await sayfa.eval(secimYap, kod));
    zorunlu("7b. 'Yeni Tur' tıklandı", await sayfa.eval(metneTikla, "yeni tur"));
    await sayfa.bekle(metinVarMi, { aciklama: "tur oluştu", ms: 20000 }, kod);

    await sayfa.git(`${FRONTEND}/yonetim/dagitim/tahta`);
    await sayfa.bekle(
      metinVarMi,
      { aciklama: "tahta yüklendi" },
      "havuz|atanmamış|tur yok|optimize",
    );
    zorunlu(
      "7c. Tahta, turu ARACIN ETIKETİYLE çiziyor (tek liste, tek anahtar)",
      await sayfa.eval(metinVarMi, kod),
      kod,
    );
    await sayfa.ekranGoruntusu("tahta-denetim.png");
  } finally {
    chrome.kill();
  }

  writeFileSync(join(OUT, "sonuc.json"), JSON.stringify(adimlar, null, 2));
  const kirik = adimlar.filter((a) => !a.ok).length;
  console.log(`\n${adimlar.length} ad\u0131m, ${kirik} k\u0131r\u0131k`);
}

ana().catch((e) => {
  console.error("KABUL HATASI:", e.message);
  process.exitCode = 1;
});
