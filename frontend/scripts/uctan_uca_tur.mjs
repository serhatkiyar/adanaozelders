// Eğitmen kaydı → ilan sihirbazı → yayın: UÇTAN UCA, GERÇEK TIKLAMAYLA.
//
// Fark: `sihirbaz_mobil_turu.mjs` her adımı URL'den açıp ÖLÇER. Bu tur hiçbir
// adıma URL'den atlamaz — sıfırdan kayıt olur, alanları doldurur, düğmelere
// basar ve ilanı yayına gönderir. Yani "adım tek başına render oluyor mu"
// değil, "kullanıcı bu akışı gerçekten bitirebiliyor mu" sorusunu yanıtlar.
//
// Kullanım (frontend/):
//   node scripts/uctan_uca_tur.mjs --frontend http://127.0.0.1:5199
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ARGS = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] ?? "1"]);
    return acc;
  }, []),
);
const FRONT = ARGS.frontend ?? "http://127.0.0.1:5199";
const OUT = resolve(ARGS.out ?? "./uctan-uca");
const GENISLIK = Number(ARGS.genislik ?? 390); // iPhone 12/13/14 genişliği
const PORT = 9444;
const CHROME = ARGS.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DAMGA = Date.now().toString().slice(-7);
const EPOSTA = `tur-${DAMGA}@example.com`;
const PAROLA = "Sifre12345!";

mkdirSync(OUT, { recursive: true });

async function chromeBaslat() {
  // Profil her koşuda BENZERSİZ: önceki koşudan kalan Chrome süreci dizini
  // kilitliyor ve silme EPERM veriyordu.
  const profil = join(OUT, `profil-${Date.now()}`);
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
            .slice(0, 240),
        );
      }
      if (m.method === "Runtime.exceptionThrown") {
        this.konsol.push(
          (
            m.params.exceptionDetails?.exception?.description ??
            m.params.exceptionDetails?.text ??
            ""
          ).slice(0, 240),
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
      }, 45000);
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
    for (let i = 0; i < 120; i++) {
      if (await this.eval(() => document.readyState === "complete")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  async ss(ad) {
    const r = await this.gonder("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, `${ad}.png`), Buffer.from(r.data, "base64"));
  }
}

/* ── sayfa içi yardımcılar ──────────────────────────────────────────── */

// React kontrollü girdiye yazmak: value'yu doğrudan atamak React'in izlediği
// descriptor'ı atlatır ve state güncellenmez. Yerel setter + input olayı şart.
const YAZ = (secici, deger, sira = 0, kok = null) => {
  // Modal açıkken ARKADAKİ sayfa da DOM'da duruyor. Kök verilmezse ilk eşleşme
  // pekâlâ vitrindeki arama kutusu olabilir — tur o zaman kendi kusurunu
  // uygulamanın kusuru sanır.
  const alan = kok ? document.querySelector(kok) : document;
  if (!alan) return { ok: false, sebep: `kök yok: ${kok}` };
  const hepsi = Array.from(alan.querySelectorAll(secici)).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const el = hepsi[sira];
  if (!el) return { ok: false, sebep: `girdi yok: ${secici}[${sira}]` };
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, deger);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
};

const TIKLA = (metin, etiketler = "button,a,label", kok = null) => {
  const alan = kok ? document.querySelector(kok) : document;
  if (!alan) return { ok: false, sebep: `kök yok: ${kok}` };
  const adaylar = Array.from(alan.querySelectorAll(etiketler)).filter((el) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    const t = (el.getAttribute("aria-label") || el.textContent || "").trim();
    return t === metin || t.startsWith(metin);
  });
  if (!adaylar.length) return { ok: false, sebep: `düğme yok: ${metin}` };
  // TAM eşleşme öncelikli. Önek eşleşmesi DOM sırasına düşünce "Kaydet",
  // başlıktaki "Kaydet ve çık"a çarpıp turu sihirbazdan dışarı atıyordu —
  // sondanın kendi kusuru, uygulamanınki değil.
  const tam = adaylar.find(
    (el) => (el.getAttribute("aria-label") || el.textContent || "").trim() === metin,
  );
  (tam ?? adaylar[0]).click();
  return { ok: true, tamEslesme: !!tam };
};

const DURUM = () => {
  const h1 = document.querySelector("h1");
  const birincil = Array.from(document.querySelectorAll("button")).find((b) =>
    /^(Sırada:|Yayına gönder)/.test((b.textContent || "").trim()),
  );
  const uyari = document.querySelector('[role="alert"]');
  return {
    url: location.pathname + location.search,
    baslik: h1 ? h1.textContent.trim() : null,
    birincil: birincil ? birincil.textContent.trim() : null,
    uyari: uyari ? uyari.textContent.trim().slice(0, 160) : null,
  };
};

/* ── tur ────────────────────────────────────────────────────────────── */
const adimlar = [];
const kir = [];
const kaydet = (ad, sonuc, ek = {}) => {
  adimlar.push({ ad, ...sonuc, ...ek });
  if (sonuc && sonuc.ok === false) kir.push(`${ad}: ${sonuc.sebep}`);
  // Adım adım bas: tur ortada patlarsa nerede saptığı görünsün.
  const im = sonuc?.ok === false ? "KIRIK" : "ok   ";
  console.error(
    `  ${im} ${ad}` +
      (ek.baslik ? ` | ${ek.baslik}` : "") +
      (ek.uyari ? ` | uyari: ${ek.uyari}` : "") +
      (sonuc?.sebep && sonuc.ok === false ? ` | ${sonuc.sebep}` : ""),
  );
};

const chrome = await chromeBaslat();
try {
  const hedefler = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const ws = new WebSocket(hedefler.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const s = new Sayfa(ws);
  await s.gonder("Runtime.enable");
  await s.gonder("Page.enable");
  await s.gonder("Emulation.setDeviceMetricsOverride", {
    width: GENISLIK,
    height: 800,
    deviceScaleFactor: 1,
    mobile: true,
  });

  const bekle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
  // Tıklamanın başarısı YETMEZ: adım gerçekten değişmiş mi diye başlığa
  // bakılır. Önceki sürüm, doğrulama takıldığında da "ok" diyordu — turun
  // kendi yalancı yeşili.
  const ilerle = async (etiket) => {
    const once = await s.eval(DURUM);
    await s.eval(TIKLA, "Sırada:");
    await bekle(1200);
    const d = await s.eval(DURUM);
    kaydet(
      etiket,
      {
        ok: d.baslik !== once.baslik,
        sebep: `adım ilerlemedi, hâlâ "${d.baslik}"${d.uyari ? ` (uyarı: ${d.uyari})` : ""}`,
      },
      d,
    );
    return d;
  };

  /* 1 — ana sayfa, "Ders Ver" */
  await s.git(FRONT + "/");
  await bekle(1500);
  s.konsol = [];
  await s.ss("01-anasayfa");
  kaydet("anasayfa · Ders Ver düğmesi", await s.eval(TIKLA, "Ders Ver"));
  await bekle(1200);
  await s.ss("02-kayit-modali");

  /* 2 — dört alanlı kayıt */
  const alanSayisi = await s.eval(() => {
    const m = document.querySelector('[role="dialog"]');
    if (!m) return -1;
    return Array.from(m.querySelectorAll("form input")).filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 0 && i.type !== "checkbox";
    }).length;
  });
  kaydet("kayıt formu alan sayısı", { ok: alanSayisi === 4, sebep: `4 bekleniyordu, ${alanSayisi} var` }, { alanSayisi });

  const MODAL = '[role="dialog"]';
  await s.eval(YAZ, 'form input[type="text"]', "Duman", 0, MODAL);
  await s.eval(YAZ, 'form input[type="text"]', "Turcu", 1, MODAL);
  await s.eval(YAZ, 'form input[type="email"]', EPOSTA, 0, MODAL);
  await s.eval(YAZ, 'form input[type="password"]', PAROLA, 0, MODAL);
  await s.eval(() => {
    const k = document.querySelector('[role="dialog"] form input[type="checkbox"]');
    if (k && !k.checked) k.click();
    return !!k;
  });
  await bekle(300);
  await s.ss("03-kayit-dolu");
  // Gönderim düğmesi: modal içindeki type=submit. Metinle aramak rol
  // sekmesindeki "Kayıt Ol" ile karışıyordu.
  kaydet("kayıt gönder", await s.eval(() => {
    const b = document.querySelector('[role="dialog"] form button[type="submit"]');
    if (!b) return { ok: false, sebep: "modalda submit düğmesi yok" };
    b.click();
    return { ok: true };
  }));
  await bekle(4000);

  let d = await s.eval(DURUM);
  kaydet("kayıt sonrası sihirbaza düştü", {
    ok: d.url.startsWith("/ilanini-olustur"),
    sebep: `beklenen /ilanini-olustur, gelen ${d.url}`,
  }, d);
  await s.ss("04-adim1-dersler");

  /* 3 — adım 1: ders + seviye */
  await s.eval(YAZ, 'input[type="search"]', "arkeoloji");
  await bekle(900);
  kaydet("ders seç", await s.eval(TIKLA, "Arkeoloji"));
  await bekle(700);
  kaydet("seviye seç", await s.eval(TIKLA, "Lise"));
  await bekle(400);
  await s.ss("05-ders-secildi");

  /* 3b — BOŞ BIRAKMADAN önce: düğme kilitli mi, hata görünüyor mu (adım 2'de) */
  d = await ilerle("adım 1 → 2");

  const kilitli = await s.eval(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) =>
      /^Sırada:/.test((x.textContent || "").trim()),
    );
    return b ? b.disabled : null;
  });
  kaydet("boş adımda düğme KİLİTLİ DEĞİL", { ok: kilitli === false, sebep: `disabled=${kilitli}` });
  await s.eval(TIKLA, "Sırada:");
  await bekle(700);
  d = await s.eval(DURUM);
  kaydet("boş adımda hata alanda göründü", {
    ok: !!d.uyari,
    sebep: "role=alert yok",
  }, { uyari: d.uyari });
  await s.ss("06-bos-adim-hatasi");

  /* 4 — adım 2: başlık */
  await s.eval(
    YAZ,
    "textarea",
    "Lise ve universite hazirlik ogrencilerine sekiz yildir birebir ders veren muhendislik mezunu bir egitmenim",
  );
  await bekle(400);
  d = await ilerle("adım 2 → 3 (başlık)");

  /* 5 — adım 3: dersin işleyişi */
  await s.eval(
    YAZ,
    "textarea",
    "Ilk derste ogrencinin seviyesini kisa bir deneme sinaviyla olcuyorum ve eksik konulari cikariyorum. Sonrasinda haftalik plan yapip her ders sonunda kisa odev veriyorum, bir sonraki derste birlikte kontrol ediyoruz.",
  );
  await bekle(400);
  d = await ilerle("adım 3 → 4 (yöntem)");

  /* 6 — adım 4: sen kimsin */
  await s.eval(
    YAZ,
    "textarea",
    "Cukurova Universitesi muhendislik bolumu mezunuyum ve sekiz yildir duzenli olarak ozel ders veriyorum. Ogrencilerimin buyuk cogunlugu hedefledigi bolume yerlesti; ozellikle temel konularda eksigi olan ogrencilerle sabirla calismaktan gercekten keyif aliyorum ve her ogrenciye ayri bir plan hazirliyorum.",
  );
  await bekle(400);
  d = await ilerle("adım 4 → 5 (hakkında)");

  /* 7 — adım 5: ders nerede */
  kaydet("ders şekli seç", await s.eval(TIKLA, "Uzaktan"));
  await bekle(500);
  d = await ilerle("adım 5 → 6 (yer)");

  /* 8 — adım 6: ücret */
  await s.eval(YAZ, 'input[inputmode="decimal"]', "400");
  await bekle(400);
  await s.ss("07-ucret");
  d = await ilerle("adım 6 → 7 (ücret)");

  /* 9 — adım 7: müsaitlik (atla) */
  kaydet("müsaitlik atla", await s.eval(TIKLA, "Bu adımı şimdilik atla"));
  await bekle(1100);
  d = await s.eval(DURUM);
  kaydet("atlama adım 8'e götürdü", { ok: /Foto/.test(d.baslik ?? ""), sebep: `başlık: ${d.baslik}` }, d);

  /* 10 — adım 8: fotoğraf (atla) */
  await s.eval(TIKLA, "Bu adımı şimdilik atla");
  await bekle(1100);
  d = await s.eval(DURUM);
  kaydet("fotoğraf atlandı → belgeler", { ok: /belgele/i.test(d.baslik ?? ""), sebep: `başlık: ${d.baslik}` }, d);
  await s.ss("08-belgeler");

  /* 11 — adım 9: diploma — YAYIN KAPISI */
  const kapiHatasi = await s.eval(async () => {
    const b = Array.from(document.querySelectorAll("button")).find((x) =>
      /^Sırada:/.test((x.textContent || "").trim()),
    );
    if (!b) return "BIRINCIL DUGME YOK";
    b.click();
    await new Promise((r) => setTimeout(r, 700));
    const u = document.querySelector('[role="alert"]');
    return u ? u.textContent.trim().slice(0, 140) : null;
  });
  kaydet("belgesiz geçilemiyor", { ok: !!kapiHatasi, sebep: "uyarı çıkmadı" }, { uyari: kapiHatasi });

  // Eğitim kaydını UI'dan ekle: okul + e-Devlet barkodu
  kaydet("eğitim ekle formunu aç", await s.eval(TIKLA, "+ Ekle"));
  await bekle(900);
  await s.ss("09-egitim-formu");
  const egitimAlanlari = await s.eval(() =>
    Array.from(document.querySelectorAll("input"))
      .filter((i) => i.getBoundingClientRect().width > 0)
      .map((i) => ({
        ph: i.getAttribute("placeholder"),
        etiket: (document.querySelector(`label[for="${i.id}"]`) || {}).textContent?.trim(),
        tip: i.type,
      })),
  );
  adimlar.push({ ad: "eğitim formu alanları", alanlar: egitimAlanlari });

  /* 12 — eğitim kaydını doldur (okul + e-Devlet barkodu) ve kaydet */
  const yazPh = async (ph, deger) =>
    s.eval(
      (ph, deger) => {
        const el = Array.from(document.querySelectorAll("input")).find(
          (i) => i.getAttribute("placeholder") === ph && i.getBoundingClientRect().width > 0,
        );
        if (!el) return { ok: false, sebep: `alan yok: ${ph}` };
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(el, deger);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      },
      ph,
      deger,
    );

  kaydet("okul alanı", await yazPh("Örn. Boğaziçi Üniversitesi", "Çukurova Üniversitesi"));
  kaydet("derece alanı", await yazPh("Lisans, Yüksek Lisans…", "Lisans"));
  kaydet("barkod alanı", await yazPh("Örn. AB12-CD34-…", "AB12-CD34-EF56"));
  await bekle(300);
  await s.ss("10-egitim-dolu");
  kaydet("eğitimi kaydet", await s.eval(TIKLA, "Kaydet"));
  await bekle(2200);
  await s.ss("11-egitim-kayitli");

  d = await ilerle("adım 9 → 10 (belgeler)");

  /* 13 — adım 10: telefon (atla) */
  kaydet("telefon atla", await s.eval(TIKLA, "Bu adımı şimdilik atla"));
  await bekle(1300);
  d = await s.eval(DURUM);
  kaydet("telefon atlandı → özet", { ok: /hazır/i.test(d.baslik ?? ""), sebep: `başlık: ${d.baslik}` }, d);
  await s.ss("12-ozet");

  /* 14 — özet: eksik kalmamalı */
  const eksikler = await s.eval(() => {
    const kutu = Array.from(document.querySelectorAll("div")).find((el) =>
      /Yayına göndermeden önce tamamlanması gerekenler/.test(el.textContent || ""),
    );
    return kutu ? kutu.textContent.trim().slice(0, 200) : null;
  });
  kaydet("özette eksik kalmadı", { ok: eksikler === null, sebep: `eksik kutusu var: ${eksikler}` });

  /* 15 — YAYINLA */
  kaydet("yayına gönder", await s.eval(TIKLA, "Yayına gönder"));
  await bekle(3000);
  d = await s.eval(DURUM);
  kaydet("tebrikler ekranı geldi", {
    ok: /incelemeye alındı|yayında/i.test(d.baslik ?? ""),
    sebep: `başlık: ${d.baslik}`,
  }, d);
  await s.ss("13-tebrikler");

  // Onay bekleyen ilanın public adresi 404 döner. Paylaşımın bu aşamada
  // SUNULMAMASI sözleşmedir: aksi hâlde eğitmen çevresine ölü bağlantı
  // gönderir. Onaylandıktan sonra paylaşım görünür — o dalı admin onayı
  // gerektirdiği için bu tur ölçmez, ayrıca not düşülür.
  const paylasVar = await s.eval(
    () => !!Array.from(document.querySelectorAll("button,a")).find((b) =>
      /paylaş/i.test((b.textContent || "").trim()),
    ),
  );
  kaydet("onay beklerken ölü paylaş bağlantısı SUNULMUYOR", {
    ok: !paylasVar,
    sebep: "onay beklerken paylaş düğmesi görünüyor (public sayfa 404 verir)",
  });

  writeFileSync(join(OUT, "tur.json"), JSON.stringify({ eposta: EPOSTA, adimlar, kir, konsol: s.konsol }, null, 2));
  console.log(
    JSON.stringify(
      {
        eposta: EPOSTA,
        kirikSayisi: kir.length,
        kir,
        konsol: s.konsol.slice(0, 5),
        sonDurum: d,
        egitimAlanlari,
      },
      null,
      2,
    ),
  );
} finally {
  chrome.kill();
}
