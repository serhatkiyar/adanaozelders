/**
 * Ana sayfadaki iki arama hapı İKİZDİR — nöbetçi.
 *
 * ## Karar (kullanıcı, 7 Eyl 2026)
 *
 * Ana sayfada sekme değiştirince arama çubuğunun TASARIMI da değişiyordu:
 * eğitmende yazılabilir iki eşit bölme (`DersArama`), kütüphanede pin + açılır
 * ilçe menüsü + serbest metin (`BigSearch`). Aynı çubuğun iki farklı hâli
 * olmasının bir gerekçesi yoktu. Kütüphane hapı `KutuphaneArama` olarak
 * eğitmen hapının ikizi yazıldı.
 *
 * İZİN VERİLEN FARK sağ tarafın içeriği: eğitmen hapında ders şekli seçicisi
 * var (`SekilSelect`), kütüphanede yok — kütüphane fiziksel bir mekândır,
 * "uzaktan kütüphane" diye bir şey olmaz. Kütüphane doğrudan yer sorar.
 *
 * 8 Eyl 2026: ders şekli TEK seçime indi ("Uzaktan" / "Yüz yüze" / seçilmemiş)
 * ve YER kendi bölmesine taşındı — eğitmen hapında yalnız "Yüz yüze"
 * seçiliyken görünen üçüncü bölme. Eskiden şekil ile yer aynı listede
 * birbirini eziyordu; "İkisi de olur" satırı ise kutuda filtre varmış gibi
 * görünüp adrese hiçbir mod yazmıyordu.
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * Sessizce yanlış gidebilecek şey şu: biri hapın kabuğunu (yuvarlaklık, gölge,
 * odak halkası, bölme genişliği, Ara düğmesi) YALNIZ bir tarafta değiştirir.
 * İki dosya da derlenir, hiçbir test kırılmaz ve iki sekme yeniden ayrışır —
 * bunu ancak sekmeler arasında gidip gelen bir insan fark eder. Bu düğüm o
 * ayrışmayı kaynak düzeyinde yakalar.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * KAYNAK SÖZLEŞMESİ testidir: "ekranda aynı görünüyor" demez, "aynı sınıfları
 * taşıyorlar" der. Piksel eşitliğinin kanıtı değildir; ikisinin ayrı ayrı
 * evrilmesinin önündeki engeldir.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);

const oku = (...parcalar: string[]) => readFileSync(join(KOK, ...parcalar), "utf8");

/** `src` altındaki tüm `.tsx` dosyaları (test dosyaları hariç), POSIX yolla. */
function tsxDosyalari(dizin = "src", biriken: string[] = []): string[] {
  for (const girdi of readdirSync(join(KOK, dizin), { withFileTypes: true })) {
    const yol = `${dizin}/${girdi.name}`;
    if (girdi.isDirectory()) tsxDosyalari(yol, biriken);
    else if (girdi.name.endsWith(".tsx") && !girdi.name.includes(".test."))
      biriken.push(yol);
  }
  return biriken;
}

const HERO = oku("src", "components", "HeroSearch.tsx");
const SECICILER = oku("src", "components", "AramaSecicileri.tsx");
/**
 * İKİ HAP DA 10 Eyl 2026'da KEŞİF KABUĞUNA taşındı.
 *
 * Önce ders hapı ana sayfada, kütüphane hapı `/kutuphaneler`deydi; her sayfa
 * kendi üst barını basıyordu ve bu yüzden kategori değişimi ekranın tamamını
 * yeniden kuruyordu. Üst bar ortak kabuğa çıkınca haplar da onunla gitti.
 */
const KABUK = oku("src", "components", "kesif", "KesifKabugu.tsx");

/** `export function <ad>(` ile başlayan bloğu bir sonraki `export function`a kadar alır. */
function govde(kaynak: string, ad: string): string {
  const bas = kaynak.indexOf(`export function ${ad}(`);
  if (bas < 0) return "";
  const sonraki = kaynak.indexOf("\nexport function ", bas + 1);
  return kaynak.slice(bas, sonraki < 0 ? kaynak.length : sonraki);
}

/** Bloktaki ilk `<form ... className="…">` sınıf dizesi. */
function formSinifi(blok: string): string {
  const i = blok.indexOf("<form");
  const j = blok.indexOf('className="', i);
  return j < 0 ? "" : blok.slice(j + 11, blok.indexOf('"', j + 11));
}

const DERS = govde(HERO, "DersArama");
const KUTUPHANE = govde(HERO, "KutuphaneArama");

describe("ana sayfa arama hapları ikizdir", () => {
  it("DOLULUK: iki bileşen de gerçekten bulundu", () => {
    // Boş bir blok, aşağıdaki "aynı sınıf" iddialarını bedava geçirirdi:
    // "" === "" doğrudur.
    expect(DERS.length, "DersArama bulunamadı").toBeGreaterThan(500);
    expect(KUTUPHANE.length, "KutuphaneArama bulunamadı").toBeGreaterThan(500);
  });

  it("hapın kabuğu (form) BİREBİR aynı sınıfları taşır", () => {
    const a = formSinifi(DERS);
    const b = formSinifi(KUTUPHANE);
    expect(a.length, "DersArama'nın form sınıfı okunamadı").toBeGreaterThan(100);
    expect(b).toBe(a);
  });

  it("bölmeler EŞİT genişlikte; eğitmende üç, kütüphanede tek", () => {
    // 8 Eyl: sınıf dizesi iki bölmeye ELLE yazılmıyor artık, ortak `BOLME`
    // sabitinden geliyor (alan başlıkları eklenirken bölme `flex-col` bir
    // sarmalayıcıya dönüştü). Bu ikizliği ZAYIFLATMAZ, güçlendirir: eşitlik
    // artık iki dizenin birbirine benzemesine değil TEK KAYNAĞA dayanıyor.
    //
    // Ölçüt buna göre değişti; eski ölçüt (ham `flex-1 basis-0` sayısı) sabite
    // çıkınca 0 sayardı — yani düzeltmeyi cezalandıran bir nöbetçi olurdu.
    const tanim = (HERO.match(/^const BOLME =/gm) ?? []).length;
    expect(tanim, "BOLME tek yerde tanımlı olmalı").toBe(1);
    expect(HERO, "eşit genişlik sınıfı düştü").toContain("flex-1 basis-0");

    const say = (s: string) =>
      s
        .split(/\r?\n/)
        .filter((satir) => !satir.trim().startsWith("//"))
        .filter((satir) => satir.includes("{BOLME")).length;
    // Eğitmen hapı 8 Eyl'de ÜÇ bölme oldu: [Ders] [Ders şekli] ve yalnız
    // "Yüz yüze" seçiliyken beliren [Yer]. Kütüphanede 16 Eyl'den beri TEK
    // bölme var: ad kutusu kalktı (kimse kütüphaneyi adıyla aramıyor), hap
    // yalnız yer sorar — telefonun adımlı yüzeyiyle aynı.
    expect(say(DERS)).toBe(3);
    expect(say(KUTUPHANE)).toBe(1);
  });

  it("her bölmenin ETİKETİ var ve girdiye BAĞLI", () => {
    // Alan adı eskiden placeholder'ın kendisiydi ve kullanıcı yazmaya
    // başlayınca kayboluyordu (Airbnb deseni, kullanıcı kararı 8 Eyl).
    // `htmlFor` şart: bağlantısız bir <label> ESLint'i de kırar.
    for (const [ad, kaynak] of [
      ["DersArama", DERS],
      ["KutuphaneArama", KUTUPHANE],
    ] as const) {
      const etiket = (kaynak.match(/<label htmlFor=/g) ?? []).length;
      const beklenen = ad === "DersArama" ? 3 : 1;
      expect(etiket, `${ad}: her bölme etiketli olmalı`).toBe(beklenen);
    }
  });

  it("etiketli girdilerde `aria-label` KALINTISI yok", () => {
    // İkisi birlikteyken ekran okuyucu `aria-label`ı okur ve görünen etiket
    // sessizce yok sayılır: gören kullanıcı "Ders", ekran okuyucu "Ders
    // kategorisi" duyar. Tek alan, iki ad.
    for (const [ad, kaynak] of [
      ["DersArama", DERS],
      ["KutuphaneArama", KUTUPHANE],
    ] as const) {
      const kalinti = kaynak
        .split(/\r?\n/)
        .filter((satir) => {
          const k = satir.trim();
          return !k.startsWith("//") && !k.startsWith("*");
        })
        .filter(
          (satir) =>
            satir.includes("aria-label") && !satir.includes('aria-label="Ara"')
        );
      expect(kalinti, `${ad}: ${kalinti.join(" | ")}`).toHaveLength(0);
    }
  });

  it("Ara düğmesi aynı", () => {
    const dugme = (s: string) => {
      const i = s.indexOf('type="submit"');
      const j = s.indexOf('className="', i);
      return s.slice(j + 11, s.indexOf('"', j + 11));
    };
    expect(dugme(DERS)).toContain("from-marka to-marka-hover");
    expect(dugme(KUTUPHANE)).toBe(dugme(DERS));
  });

  it("İZİN VERİLEN TEK FARK: sağ bölmenin seçicisi", () => {
    // Farkın kendisi de çıpalı. Yoksa bir sonraki tur "ikizler tamamen aynı
    // olsun" diye anlar ve kütüphaneye "Online ders" seçeneği koyar.
    // Ders şekli YALNIZ eğitmen hapında olabilir.
    expect(DERS).toContain("<SekilSelect");
    expect(KUTUPHANE).not.toContain("<SekilSelect");
    // Yer seçicisi İKİSİNDE de var — aynı bileşen, aynı öneri listesi.
    expect(DERS).toContain("<YerSelect");
    expect(KUTUPHANE).toContain("<YerSelect");
  });

  it("yer seçicisi ders şekli satırları SUNMAZ — ikisi ayrı kavram", () => {
    const yer = govde(SECICILER, "YerSelect");
    expect(yer.length, "YerSelect bulunamadı").toBeGreaterThan(500);
    for (const satir of ["Uzaktan", "Yüz yüze", "İkisi de olur"]) {
      expect(yer, `YerSelect '${satir}' sunuyor — şekil ayrı alanda`).not.toContain(
        `"${satir}"`
      );
    }
    // DOLULUK: seçici gerçekten YER sunuyor (boş bir panel de yukarıdakini
    // geçerdi). Eşleşme Türkçe katlamalı ("cukurova" → Çukurova) ve ilçenin
    // yanında MAHALLE de öneriliyor.
    expect(yer).toContain("yerAra");
    // Seçimi temizleyen satır.
    expect(yer).toContain("Tüm yerler");
  });

  it("ders şekli seçicisi YER önermez — ters yön", () => {
    // Yukarıdakinin aynası. İkisi birlikte "iki kavram iki alanda" kuralını
    // her iki yönden de çıpalar; biri olmadan diğeri yarım kalırdı.
    const sekil = govde(SECICILER, "SekilSelect");
    expect(sekil.length, "SekilSelect bulunamadı").toBeGreaterThan(400);
    expect(sekil).not.toContain("yerAra");
    expect(sekil).toContain("SEKIL_SATIRLARI");
  });

  it("iki seçici de AYNI satır ve panel bileşenini kullanır", () => {
    // `Satir`/`Panel` tek yerden gelmezse biri değişip diğeri kalır.
    for (const ad of ["SekilSelect", "YerSelect"]) {
      expect(govde(SECICILER, ad)).toContain("<Satir");
      expect(govde(SECICILER, ad)).toContain("<Panel");
    }
    expect(SECICILER.split("function Satir(").length - 1).toBe(1);
    expect(SECICILER.split("function Panel(").length - 1).toBe(1);
  });

  it('"İkisi de olur" GERİ DÖNEMEZ — kutuda filtre varmış gibi görünüp yoktu', () => {
    // Ölçülmüş kusur: satır seçiliyken kutuda "Online + Yüz yüze" yazıyor ama
    // adrese hiçbir `mode` parametresi yazılmıyordu. Yani filtre uygulanmıyor,
    // KALDIRILIYORDU; hiç seçim yapmamakla ürettiği adres birebir aynıydı.
    // Kullanıcının "kafa karıştırıcı" dediği şeyin merkezi buydu.
    // Metin aramak yerine SOZLESMEYE bakiliyor: secenek listesi tam olarak uc
    // durum tasir ve ucuncu bir "her ikisi" degeri eklenemez. Metin taramasi
    // yorumlardaki tarihsel anlatimi da yakalardi — oysa "eskiden su satir
    // vardi" notu borc degil TARIHtir.
    // Yalniz sozlugun KENDISI — bir sonraki `};` kapanisina kadar. Daha genis
    // bir dilim, altindaki `sekliCoz` yorumunda gecen "BOTH"u da yakalar ve
    // testi yanlis yere baglardi.
    const sozlukBas = SECICILER.indexOf("SEKIL_ADI: Record<DersSekli, string> = {");
    const sozluk = SECICILER.slice(sozlukBas, SECICILER.indexOf("};", sozlukBas));
    expect(sozluk, "SEKIL_ADI sozlugu bulunamadi").toContain("Fark etmez");
    // BOTH burada olamaz — o egitmenin ILAN degeri, arama filtresi degil.
    expect(sozluk).not.toContain("BOTH");

    // Secici gercekten TEK secim: deger bir dizi degil, tek `DersSekli`.
    expect(SECICILER).toContain("value: DersSekli");
    expect(SECICILER).not.toContain("value: DersSekli[]");
  });


  it("iki hap da CANLI ve üçüncü bir tasarım yok", () => {
    /*
     * İDDİA İKİ KEZ YER DEĞİŞTİRDİ, İKİSİNDE DE ZAYIFLAMADI — bu kez GÜÇLENDİ.
     *
     * 9 Eyl: iki hap ana sayfadaydı; sekmeler gerçek gezinmeye dönünce
     * kütüphane hapı `/kutuphaneler`e taşındı.
     * 10 Eyl: üst bar ortak keşif kabuğuna çıktı, iki hap da onunla gitti.
     *
     * Hedef dosya güncellenmeseydi düğüm sessizce yalana dönerdi: haplar
     * eski dosyalarda bulunamayınca "ikizlik bozuldu" sanılırdı — oysa
     * ikizlik duruyor, yalnız ikisi de başka dosyada.
     *
     * GÜÇLENME: "üçüncü tasarım yok" iddiası artık iki dosyayı değil TÜM
     * `src` ağacını tarıyor. `BigSearch` yalnız `useNavSearch` (detay
     * sayfalarının navbar'ı) içinde kalabilir; oraya da bir gün ikiz haplar
     * girmelidir.
     */
    expect(KABUK, "ders hapı kabukta yok").toContain("<DersArama");
    expect(KABUK, "kütüphane hapı kabukta yok").toContain("<KutuphaneArama");
    expect(KABUK, "kabuk hâlâ BigSearch basıyor — ikizlik bozuldu").not.toContain(
      "<BigSearch"
    );

    /*
     * İZİNLİ LİSTE = BİLİNEN BORÇ, isimle sabit.
     *
     * `useNavSearch`: detay sayfalarının navbar'ı; oraya da bir gün ikiz
     * haplar girmelidir.
     * `/egitmenler` ikizi (Marketplace + PublicMarketplace): bu iki yüzey
     * 10 Eyl'de keşif kabuğuna ALINMADI — kullanıcı telefondaki sonuç
     * başlığına (`AramaMobilBaslik`) dokunulmamasını istedi, o başlık da
     * kabuğun kromuyla aynı değil. Kabuğa girdikleri gün hapları da
     * `KesifKabugu`ya devredecek ve bu iki satır silinecek.
     *
     * Liste isimle sabit: yeni bir dosya `BigSearch` basarsa test kırılır ve
     * bu DOĞRU davranıştır — üçüncü tasarım sessizce yayılmasın.
     */
    /* 16 Eyl 2026: borç ödendi. `useNavSearch` ve iki sonuç sayfası da
       DersArama/KutuphaneArama'ya geçti, `BigSearch` silindi. Liste BOŞ —
       hiçbir dosya üçüncü tasarımı basamaz. */
    const izinli = new Set<string>([]);
    const suclular = tsxDosyalari()
      .filter((yol) => !izinli.has(yol) && oku(yol).includes("<BigSearch"));
    expect(
      suclular,
      `üçüncü hap tasarımı geri gelmiş: ${suclular.join(", ")}`
    ).toEqual([]);
  });
});
