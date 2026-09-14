import { describe, expect, it } from "vitest";
import { OZEL_DOSYA_YOLU, YONETIM_TIKLAMA_MESAJI, istegiTemizle, izleriTemizle, spanVerisiniTemizle, refererBasliklariniTemizle, sorguyuTemizle, stripSensitiveParams, yonetimTiklamasiniMaskele, yonetimYoluMu } from "./monitoring";

/**
 * Hata raporları üçüncü bir servise (Sentry) gider. Bu uygulamada token'lar
 * URL'de taşınabiliyor — WebSocket `?token=`, kargo takip linki, e-posta
 * doğrulama/şifre sıfırlama bağlantıları. Maskelenmezlerse hata izleme paneli
 * geçerli oturum anahtarlarının deposuna dönüşür.
 */
describe("stripSensitiveParams", () => {
  it("token parametresini maskeler", () => {
    expect(stripSensitiveParams("https://x.tr/ws?token=abc123")).toContain(
      "token=%5Bgizlendi%5D"
    );
    expect(stripSensitiveParams("https://x.tr/ws?token=abc123")).not.toContain("abc123");
  });

  it("oturum ve OTP anahtarlarını maskeler", () => {
    for (const key of ["access_token", "refresh_token", "code", "otp"]) {
      const out = stripSensitiveParams(`https://x.tr/y?${key}=SIR`);
      expect(out).not.toContain("SIR");
    }
  });

  it("birden çok hassas parametreyi birlikte maskeler", () => {
    // Not: tek harflik sır değeri kullanmayın — maskelenmiş çıktı
    // `%5Bgizlendi%5D` içerdiğinden "B" gibi harfler yanlış eşleşir.
    const out = stripSensitiveParams(
      "https://x.tr/y?token=ILK_SIR&refresh_token=IKINCI_SIR&sayfa=2"
    );
    expect(out).not.toContain("ILK_SIR");
    expect(out).not.toContain("IKINCI_SIR");
    expect(out).toContain("sayfa=2"); // zararsız parametre korunur
  });

  it("hassas parametre yoksa URL'i değiştirmez", () => {
    const url = "https://x.tr/egitmenler?ilce=Seyhan&sayfa=2";
    expect(stripSensitiveParams(url)).toBe(url);
  });

  it("göreli yolları da işler", () => {
    expect(stripSensitiveParams("/kargo-takip?token=GIZLI")).not.toContain("GIZLI");
  });

  it("ayrıştırılamayan girdide çökmez", () => {
    expect(stripSensitiveParams("http://[bozuk")).toBe("http://[bozuk");
    expect(stripSensitiveParams("")).toBe("");
  });
});

/**
 * Sentry'nin DOM serileştiricisi `aria-label`, `title`, `name`, `alt` özniteliklerini breadcrumb metnine
 * koyar. Yönetim ekranlarında bu öznitelikler aday/müşteri adı, e-posta ya da belge dosya adı taşıyabilir;
 * eleman bazlı düzeltmeler ilk savunma, bu maskeleme MERKEZİ savunmadır.
 */
/**
 * Aday belgeleri `private/` altında tutulur ve kısa ömürlü PRESIGNED adresle sunulur. Böyle bir adres bir
 * hata olayına ya da xhr izine düşerse hem imza/credential hem de dosya adı Sentry'ye taşınır.
 */
describe("stripSensitiveParams · presigned adresler", () => {
  const PRESIGNED =
    "https://minio.adanaozelders.tr/private/tutor-pre-applications/42/ayse-yilmaz-diploma.pdf" +
    "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
    "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260914%2Feu-central-1%2Fs3%2Faws4_request" +
    "&X-Amz-Date=20260914T090000Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host" +
    "&X-Amz-Signature=1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c" +
    "&X-Amz-Security-Token=FwoGZXIvYXdzEBYaDExAMPLEtoken";

  it("nesne yolu, credential, signature ve security token çıktıda YOKTUR", () => {
    const temiz = stripSensitiveParams(PRESIGNED);
    for (const sizinti of [
      "ayse-yilmaz-diploma.pdf",
      "tutor-pre-applications",
      "AKIAIOSFODNN7EXAMPLE",
      "1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c",
      "FwoGZXIvYXdzEBYaDExAMPLEtoken",
      "AWS4-HMAC-SHA256",
      "20260914T090000Z",
    ]) {
      expect(temiz).not.toContain(sizinti);
    }
    // Host/protokol teknik olarak yararlıdır, kalır; yol maskelenir.
    expect(temiz).toContain("https://minio.adanaozelders.tr");
    expect(decodeURIComponent(new URL(temiz).pathname)).toBe(OZEL_DOSYA_YOLU);
  });

  it("parametre adları büyük/küçük harften bağımsız temizlenir", () => {
    const temiz = stripSensitiveParams("https://x.tr/ws?TOKEN=abc123&Refresh_Token=def456");
    expect(temiz).not.toContain("abc123");
    expect(temiz).not.toContain("def456");
    const s3 = stripSensitiveParams("https://depo.tr/private/belge.pdf?signature=SIG123&awsaccesskeyid=KEY123&expires=1789000000");
    expect(s3).not.toContain("SIG123");
    expect(s3).not.toContain("KEY123");
    expect(s3).not.toContain("1789000000");
    expect(s3).not.toContain("belge.pdf");
  });

  it("URL içi kimlik bilgisi ve imzalı adresin parçası (fragment) düşer; tekrarlı anahtar da maskelenir", () => {
    const temiz = stripSensitiveParams("https://kullanici:parola@depo.tr/private/ayse.pdf?X-Amz-Signature=SIG#ayse-yilmaz");
    expect(temiz).not.toContain("kullanici");
    expect(temiz).not.toContain("parola");
    expect(temiz).not.toContain("ayse-yilmaz");
    expect(temiz).not.toContain("ayse.pdf");
    expect(temiz).not.toContain("SIG");
    // Tekrarlı anahtarların hepsi tek maskeye iner (değer sızmaz).
    const tekrar = stripSensitiveParams("https://x.tr/ws?token=bir&token=iki");
    expect(tekrar).not.toContain("bir");
    expect(tekrar).not.toContain("iki");
  });

  it("presigned ek alanları (content-disposition/type) ve diğer sağlayıcı imzaları da temizlenir", () => {
    const temiz = stripSensitiveParams(
      'https://depo.tr/private/ayse.pdf?X-Amz-Signature=SIG&response-content-disposition=attachment%3B%20filename%3D%22ayse-diploma.pdf%22',
    );
    expect(temiz).not.toContain("ayse-diploma.pdf");
    expect(temiz).not.toContain("SIG");
    // Azure SAS ve GCS imzaları da presigned sayılır: yol maskelenir.
    for (const ham of ["https://hesap.blob.core.windows.net/ozel/ayse.pdf?sig=SIGVAL&se=2026", "https://gcs-ornek.test/ozel/ayse.pdf?GoogleAccessId=KEY&Signature=SIGVAL"]) {
      const c = stripSensitiveParams(ham);
      expect(c).not.toContain("ayse.pdf");
      expect(c).not.toContain("SIGVAL");
    }
  });

  it("ayrıştırılamayan girdide fail-open değil: hassas görünen adres tamamen gizlenir, sıradan girdi korunur", () => {
    const bozuk = "ht!tp://[::bozuk]/a?X-Amz-Signature=SIG";
    expect(stripSensitiveParams(bozuk)).not.toContain("SIG");
    expect(stripSensitiveParams("düz-metin-adres-değil")).toBe("düz-metin-adres-değil");
  });

  it("sıradan `?expires=` tek başına DEĞİŞTİRİLMEZ (sayfalama/uygulama alanı)", () => {
    const ham = "https://adanaozelders.tr/kampanya?expires=1789000000&sayfa=2";
    expect(stripSensitiveParams(ham)).toBe(ham);
    expect(stripSensitiveParams("/yonetim-yeni/egitmenler/on-basvurular?durum=NEW&sayfa=2")).toBe(
      "/yonetim-yeni/egitmenler/on-basvurular?durum=NEW&sayfa=2",
    );
  });
});

describe("yonetimTiklamasiniMaskele", () => {
  const tiklama = (mesaj: string, veri?: Record<string, unknown>) => ({
    category: "ui.click",
    level: "info",
    timestamp: 1_700_000_000,
    message: mesaj,
    ...(veri ? { data: veri } : {}),
  });

  it("yeni panel rotasında ad/e-posta/belge adı taşıyan tıklama tamamen maskelenir", () => {
    const sonuc = yonetimTiklamasiniMaskele(
      tiklama('button[aria-label="Ayşe Yılmaz Arandı"]', { selector: 'a[title="ayse-diploma.pdf"]', text: "ayse@example.com" }),
      "/yonetim-yeni/egitmenler/on-basvurular",
    );
    expect(sonuc.message).toBe(YONETIM_TIKLAMA_MESAJI);
    expect(sonuc).not.toHaveProperty("data");
    expect(JSON.stringify(sonuc)).not.toContain("Ayşe");
    expect(JSON.stringify(sonuc)).not.toContain("ayse@example.com");
    expect(JSON.stringify(sonuc)).not.toContain("diploma");
    // Güvenli teknik alanlar korunur.
    expect(sonuc.category).toBe("ui.click");
    expect(sonuc.level).toBe("info");
    expect(sonuc.timestamp).toBe(1_700_000_000);
  });

  it("eski yönetim rotasında ve kök yönetim yolunda da maskelenir", () => {
    expect(yonetimTiklamasiniMaskele(tiklama("Deniz Kurye"), "/yonetim/egitmen-basvurulari").message).toBe(YONETIM_TIKLAMA_MESAJI);
    expect(yonetimTiklamasiniMaskele(tiklama("Deniz Kurye"), "/yonetim").message).toBe(YONETIM_TIKLAMA_MESAJI);
    expect(yonetimTiklamasiniMaskele(tiklama("Deniz Kurye"), "/yonetim-yeni").message).toBe(YONETIM_TIKLAMA_MESAJI);
  });

  it("public sayfalardaki tıklama ve yalnız önek paylaşan yollar DEĞİŞMEZ", () => {
    const ham = tiklama('button[aria-label="Sepete ekle"]', { selector: "button" });
    expect(yonetimTiklamasiniMaskele(ham, "/magaza")).toBe(ham);
    expect(yonetimTiklamasiniMaskele(ham, "/")).toBe(ham);
    // `/yonetimsel` yalnız önek paylaşır: yönetim yolu DEĞİLDİR.
    expect(yonetimTiklamasiniMaskele(ham, "/yonetimsel/rapor")).toBe(ham);
    expect(yonetimYoluMu("/yonetimsel")).toBe(false);
    expect(yonetimYoluMu("/yonetim")).toBe(true);
    expect(yonetimYoluMu("/yonetim/dagitim/tahta")).toBe(true);
    expect(yonetimYoluMu("/yonetim-yeni/egitmenler")).toBe(true);
    expect(yonetimYoluMu("/yonetim-yenilik")).toBe(false);
  });

  it("yönetim yolunda `ui.input` izi de maskelenir (tuş vuruşu breadcrumb'ı da öznitelik taşır)", () => {
    const sonuc = yonetimTiklamasiniMaskele(
      { category: "ui.input", message: 'input[aria-label="Aday adı ara"]', data: { "ui.component_name": "Ara" } },
      "/yonetim-yeni/egitmenler/on-basvurular",
    );
    expect(sonuc.message).toBe(YONETIM_TIKLAMA_MESAJI);
    expect(sonuc).not.toHaveProperty("data");
  });

  it("yönetim yolunda ui.* DIŞINDAKİ izler (gezinme, http, hata) korunur", () => {
    for (const kategori of ["navigation", "xhr", "fetch", "console", "sentry.event"]) {
      const iz = { category: kategori, message: "/yonetim-yeni/egitmenler?durum=NEW", data: { url: "https://x.tr/api?token=abc" } };
      expect(yonetimTiklamasiniMaskele(iz, "/yonetim-yeni/egitmenler")).toBe(iz);
    }
  });
});

/**
 * Sentry `request` gövdesinde adres iki yerden daha sızabilir: `Referer` başlığı (sunucu/SDK'ya göre harf
 * yazımı değişir) ve `query_string` (dize, kayıt ya da çift dizisi olarak gelebilir).
 */
describe("refererBasliklariniTemizle", () => {
  it("referer/referrer her harf varyasyonunda temizlenir, diğer başlıklar korunur", () => {
    const girdi = {
      Referer: "https://adanaozelders.tr/dogrula?token=SIR1",
      referer: "https://adanaozelders.tr/kargo?code=SIR2",
      REFERRER: "https://depo.tr/private/ayse-diploma.pdf?X-Amz-Signature=SIR3",
      "User-Agent": "Mozilla/5.0 (token gibi görünen metin)",
      Accept: "application/json",
    };
    const temiz = refererBasliklariniTemizle(girdi);
    const metin = JSON.stringify(temiz);
    for (const sizinti of ["SIR1", "SIR2", "SIR3", "ayse-diploma.pdf"]) expect(metin).not.toContain(sizinti);
    // Özgün anahtar yazımı korunur.
    expect(Object.keys(temiz)).toEqual(["Referer", "referer", "REFERRER", "User-Agent", "Accept"]);
    // Diğer başlıklar aynen kalır.
    expect(temiz["User-Agent"]).toBe(girdi["User-Agent"]);
    expect(temiz.Accept).toBe("application/json");
  });

  it("temizlenecek bir şey yoksa aynı nesne döner", () => {
    const girdi = { Referer: "https://adanaozelders.tr/hakkimizda", Accept: "text/html" };
    expect(refererBasliklariniTemizle(girdi)).toBe(girdi);
  });
});

describe("sorguyuTemizle", () => {
  it("dize biçimi: baştaki `?` korunur, yoksa eklenmez (çift `??` yok)", () => {
    expect(sorguyuTemizle("token=SIR&sayfa=2")).toBe("token=%5Bgizlendi%5D&sayfa=2");
    const soruIsaretli = sorguyuTemizle("?token=SIR&sayfa=2") as string;
    expect(soruIsaretli.startsWith("?")).toBe(true);
    expect(soruIsaretli.startsWith("??")).toBe(false);
    expect(soruIsaretli).not.toContain("SIR");
    // Zararsız sorgu aynen kalır.
    expect(sorguyuTemizle("durum=NEW&sayfa=2")).toBe("durum=NEW&sayfa=2");
    expect(sorguyuTemizle("?durum=NEW")).toBe("?durum=NEW");
  });

  it("kayıt biçimi: hassas anahtarlar harf bağımsız maskelenir, zararsız alanlar ve yapı korunur", () => {
    const girdi = { TOKEN: "SIR1", Refresh_Token: "SIR2", durum: "NEW", sayfa: "2" };
    const temiz = sorguyuTemizle(girdi) as Record<string, unknown>;
    expect(temiz.TOKEN).toBe("[gizlendi]");
    expect(temiz.Refresh_Token).toBe("[gizlendi]");
    expect(temiz.durum).toBe("NEW");
    expect(temiz.sayfa).toBe("2");
    expect(Object.keys(temiz)).toEqual(["TOKEN", "Refresh_Token", "durum", "sayfa"]);
    // Hassas alan yoksa aynı nesne döner.
    const zararsiz = { durum: "NEW" };
    expect(sorguyuTemizle(zararsiz)).toBe(zararsiz);
  });

  it("tekrarlı/array değerlerde BÜTÜN değerler maskelenir; çift dizisi biçimi de çalışır", () => {
    const kayit = sorguyuTemizle({ token: ["SIR1", "SIR2"], sayfa: ["1", "2"] }) as Record<string, unknown>;
    expect(kayit.token).toEqual(["[gizlendi]", "[gizlendi]"]);
    expect(kayit.sayfa).toEqual(["1", "2"]);
    const ciftler = sorguyuTemizle([["token", "SIR1"], ["token", "SIR2"], ["sayfa", "2"]]) as [string, unknown][];
    expect(ciftler).toEqual([["token", "[gizlendi]"], ["token", "[gizlendi]"], ["sayfa", "2"]]);
  });

  it("presigned kayıt: x-amz-* ve imza/credential/expires alanları temizlenir; sıradan expires korunur", () => {
    const temiz = sorguyuTemizle({
      "X-Amz-Credential": "AKIAEXAMPLE/20260914/eu-central-1/s3/aws4_request",
      "x-amz-signature": "SIGVAL",
      "X-Amz-Security-Token": "TOKENVAL",
      Expires: "300",
      sayfa: "2",
    }) as Record<string, unknown>;
    const metin = JSON.stringify(temiz);
    for (const sizinti of ["AKIAEXAMPLE", "SIGVAL", "TOKENVAL"]) expect(metin).not.toContain(sizinti);
    expect(temiz.Expires).toBe("[gizlendi]");
    expect(temiz.sayfa).toBe("2");
    // İmza belirteci YOKSA sıradan `expires` korunur.
    const sade = sorguyuTemizle({ expires: "1789000000", sayfa: "2" }) as Record<string, unknown>;
    expect(sade.expires).toBe("1789000000");
  });

  it("bilinmeyen tiplerde çökmez ve gizli değeri String(...) ile açmaz", () => {
    expect(sorguyuTemizle(null)).toBeNull();
    expect(sorguyuTemizle(undefined)).toBeUndefined();
    expect(sorguyuTemizle(42)).toBe(42);
    const nesneDeger = { toString: () => "SIR-GIZLI" };
    const temiz = sorguyuTemizle({ token: nesneDeger, durum: "NEW" }) as Record<string, unknown>;
    expect(temiz.token).toBe("[gizlendi]");
    expect(JSON.stringify(temiz)).not.toContain("SIR-GIZLI");
  });
});

/**
 * `beforeSend` yalnız HATA olaylarına uygulanır; performans (transaction) olayları ayrı kancaya düşer.
 * `httpContext` ise her olay tipinde `request`i doldurduğu için temizlik ortak yardımcıdan yürür.
 */
describe("istegiTemizle", () => {
  it("url, Referer başlığı ve query_string birlikte temizlenir; request yoksa çökmez", () => {
    const event = {
      request: {
        url: "https://adanaozelders.tr/kargo-takip?token=SIR1",
        headers: { Referer: "https://adanaozelders.tr/dogrula?code=SIR2", "User-Agent": "Mozilla/5.0" },
        query_string: "token=SIR3&sayfa=2",
      },
    };
    istegiTemizle(event);
    const metin = JSON.stringify(event);
    for (const sizinti of ["SIR1", "SIR2", "SIR3"]) expect(metin).not.toContain(sizinti);
    expect(event.request.headers["User-Agent"]).toBe("Mozilla/5.0");
    expect(event.request.query_string).toContain("sayfa=2");
    expect(() => istegiTemizle({})).not.toThrow();
  });

  it("dize olmayan Referer değeri fail-open bırakılmaz", () => {
    const dizi = refererBasliklariniTemizle({ Referer: ["https://x.tr/a?token=SIR"] as unknown as string });
    expect(JSON.stringify(dizi)).not.toContain("SIR");
    const nesne = refererBasliklariniTemizle({ referrer: { toString: () => "SIR-GIZLI" } as unknown as string });
    expect(JSON.stringify(nesne)).not.toContain("SIR-GIZLI");
  });

  it("GCS V4 (`x-goog-*`) imzalı adres de presigned sayılır", () => {
    const temiz = stripSensitiveParams("https://gcs-ornek.test/ozel/ayse.pdf?X-Goog-Signature=SIGVAL&X-Goog-Credential=KEYVAL");
    expect(temiz).not.toContain("SIGVAL");
    expect(temiz).not.toContain("KEYVAL");
    expect(temiz).not.toContain("ayse.pdf");
    expect(decodeURIComponent(new URL(temiz).pathname)).toBe(OZEL_DOSYA_YOLU);
  });
});

/**
 * `/kargo-takip/:token` oturumsuz sipariş erişimi verir; token sorgu değil YOL segmentidir, yani sorgu
 * maskesi onu hiç görmez. `httpContext` her olayda `request.url`e tam adresi koyar.
 */
describe("stripSensitiveParams · yoldaki public token", () => {
  it("kargo takip ve paylaşılan liste token'ı maskelenir, göreli adres göreli kalır", () => {
    const kargo = stripSensitiveParams("/kargo-takip/ab12cd34ef56");
    expect(kargo).not.toContain("ab12cd34ef56");
    expect(kargo.startsWith("/kargo-takip/")).toBe(true);
    const liste = stripSensitiveParams("https://adanaozelders.tr/magaza/liste/SIRTOKEN?sayfa=2");
    expect(liste).not.toContain("SIRTOKEN");
    expect(liste).toContain("sayfa=2");
  });

  it("benzer ama token taşımayan yollar değişmez", () => {
    for (const yol of ["/kargo-takip", "/magaza/liste", "/magaza/urun/matematik-seti"]) {
      expect(stripSensitiveParams(yol)).toBe(yol);
    }
  });
});

/**
 * Breadcrumb'lar olay tipinden bağımsız eklenir; span verisi ise performans olaylarıyla gider. İkisi de
 * ham adres taşır, ikisi de aynı maskeden geçmelidir.
 */
describe("izleriTemizle ve spanVerisiniTemizle", () => {
  it("breadcrumb url/from/to alanları temizlenir, diğer alanlar ve data'sız izler korunur", () => {
    const event = {
      breadcrumbs: [
        { data: { url: "https://adanaozelders.tr/ws?token=SIR1", method: "GET" } },
        { data: { from: "/kargo-takip/SIR2", to: "/magaza" } },
        { data: { durum: "NEW" } },
      ],
    };
    izleriTemizle(event);
    const metin = JSON.stringify(event);
    expect(metin).not.toContain("SIR1");
    expect(metin).not.toContain("SIR2");
    expect(event.breadcrumbs[0].data.method).toBe("GET");
    expect(event.breadcrumbs[1].data.to).toBe("/magaza");
    expect(event.breadcrumbs[2].data.durum).toBe("NEW");
    expect(() => izleriTemizle({})).not.toThrow();
  });

  it("span verisinde adres alanları temizlenir, ölçümler bozulmaz, bilinmeyen tip çökmez", () => {
    const veri: Record<string, unknown> = {
      "url.full": "https://adanaozelders.tr/kargo-takip/SIR1",
      "http.query": "?token=SIR2&sayfa=2",
      "http.request.header.referer": "https://depo.tr/ozel/ayse.pdf?X-Amz-Signature=SIR3",
      "http.response.status_code": 200,
    };
    spanVerisiniTemizle(veri);
    const metin = JSON.stringify(veri);
    for (const sizinti of ["SIR1", "SIR2", "SIR3", "ayse.pdf"]) expect(metin).not.toContain(sizinti);
    expect(veri["http.response.status_code"]).toBe(200);
    expect(String(veri["http.query"])).toContain("sayfa=2");
    expect(() => spanVerisiniTemizle(undefined)).not.toThrow();
    expect(() => spanVerisiniTemizle("dize")).not.toThrow();
  });
});
