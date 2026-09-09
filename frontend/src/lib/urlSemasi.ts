/**
 * Arama URL'i için jenerik kodek — **yazma ve okuma tek yerde**.
 *
 * ## Neden var (kullanıcı kararı, 9 Eyl 2026)
 *
 * Arama adresi altı ayrı yerde elle kuruluyordu ve iki farklı sözleşme doğmuştu:
 * ana sayfa eğitmen araması `?subject=` yazarken `useNavSearch` aynı hedefe
 * `?q=` yazıyordu. Aynı ayrışmanın ikinci yüzü, yazılan ders metninin hiçbir
 * yere gitmemesiydi — kullanıcı "matematik" yazıp Ara'ya basınca parametresiz
 * `/egitmenler` açılıyor ve tüm eğitmenler listeleniyordu.
 *
 * Kullanıcı: *"biz bir mimarız, bir bina inşa ediyoruz; mimarlar tek kolona
 * bakmaz, mimarinin tamamına uyacak profesyonel çözümü uygular."*
 *
 * ## Tasarımın çekirdek fikri
 *
 * Simetri bir konvansiyon değil **yapı**dır. Her alan kendi anahtar(lar)ını,
 * varsayılanını, `oku`sunu ve `yaz`ını TEK nesnede taşır; dolayısıyla bir alanın
 * yazılıp okunmaması (ya da tersi) tip düzeyinde imkânsızlaşır. Bugünkü
 * `q`/`subject` ayrışması tam olarak "yazan ile okuyan ayrı dosyalarda" olduğu
 * için doğmuştu.
 *
 * ## Dış kurallar (araştırmayla sabitlendi)
 *
 * Google, faceted navigation rehberinde birebir şöyle diyor:
 *   "Use the industry standard URL parameter separator '&'. Characters like
 *    comma (,), semicolon (;), and brackets ([ and ]) are hard for crawlers to
 *    detect as parameter separators."
 * → Çoklu değer `?a=1&a=2` (tekrarlı anahtar). Airbnb'nin `[]`'si, Booking'in
 *   `;`'si, Trendyol'un `|`'ı alınmadı.
 *
 *   "Ensure that the logical order of the filters always stays the same and
 *    that no duplicate filters can exist."
 * → Anahtarlar şema bildirim sırasıyla yazılır (kanonik sıra).
 *
 * Varsayılana eşit değer YAZILMAZ: `/x` ile `/x?sirala=varsayilan` iki ayrı
 * adres demektir ve Google bunu duplicate sayar.
 *
 * ## Sınır (kök CLAUDE.md: gereksiz soyutlama yok)
 *
 * Bu motor ~120 satırı aşarsa fazla genelleşmiş demektir. Yalnız tek şemada
 * kullanılan bir alan türü için birleştirici YAZILMAZ — o şemada satır içi kalır.
 */

import { MAX_PAGE, PAGE_PARAM, pageFromParam } from "@/lib/pagination";

/** URL'de bir alanın kodlanma biçimi. Yazma ve okuma aynı nesnede. */
export interface Alan<T> {
  /**
   * Bu alanın SAHİPLENDİĞİ kanonik anahtarlar. Çoğu alanda tek; `yerAlani`
   * ikisini birden taşır (`mahalle` + `ilce`). Motor bu listeyi silme ve
   * "okunan küme = yazılan küme" denetimi için kullanır.
   */
  anahtarlar: readonly string[];
  /**
   * Göç yolu: ESKİ anahtarlar. Okurken kanonik → eski sırayla denenir,
   * yazarken YALNIZ kanonik üretilir. Böylece paylaşılmış `?subject=…` linki
   * çalışmaya devam eder ve adres ilk etkileşimde kendini yeniler.
   */
  eskiAnahtarlar?: readonly string[];
  varsayilan: T;
  oku(sp: URLSearchParams): T;
  /** Varsayılana eşitse HİÇBİR ŞEY yazmaz (temizleme dahil kendi sorumluluğu). */
  yaz(sp: URLSearchParams, deger: T): void;
}

export interface Sema<T> {
  /** Taban yol — `ROUTES.tutors` gibi. Ham string YAZILMAZ. */
  taban: string;
  /** Bildirim sırası = URL'deki kanonik anahtar sırası. */
  alanlar: { [K in keyof T]: Alan<T[K]> };
  /**
   * Alanlar arası kural. Yazmadan ÖNCE ve okumadan SONRA uygulanır, yani
   * kural iki yönde de aynı yerden gelir. Örnek: ders şekli "yüz yüze"
   * değilse konum düşer — bugün bu kural bir çağrı yerinde var, diğerinde yok.
   */
  duzelt?: (deger: T) => T;
  /**
   * Filtre SAYILMAYAN alanlar (`sayfa` gibi). `filtreliMi` bunları yok sayar:
   * 2. sayfaya geçmek "kullanıcı filtre uyguladı" demek değildir.
   */
  filtreDisi?: readonly (keyof T & string)[];
}

/** URL'den şemaya göre okur; `duzelt` en sonda uygulanır. */
export function aramayiOku<T>(sema: Sema<T>, sp: URLSearchParams): T {
  const cikti = {} as T;
  for (const ad of Object.keys(sema.alanlar) as (keyof T)[]) {
    cikti[ad] = sema.alanlar[ad].oku(sp);
  }
  return sema.duzelt ? sema.duzelt(cikti) : cikti;
}

/**
 * Şemaya göre parametre yazar.
 *
 * `mevcut` verilirse ŞEMANIN TANIMADIĞI anahtarlar korunur (`utm_*`, gelecekte
 * eklenecek A/B anahtarları). Bu, iki ayrı sayfada birden yaşayan `?sayfa=`
 * bug'ının köküydü: efektler URL'i `new URLSearchParams()` ile sıfırdan kurup
 * kendi okudukları parametreyi siliyordu.
 */
export function aramayiYaz<T>(
  sema: Sema<T>,
  deger: T,
  mevcut?: URLSearchParams
): URLSearchParams {
  const duzeltilmis = sema.duzelt ? sema.duzelt(deger) : deger;
  const sp = new URLSearchParams(mevcut);
  // Şemanın sahiplendiği her anahtar (eskiler dahil) önce temizlenir: kalıntı
  // bir eski anahtar, yeni yazılanın yanında sessizce yaşamaya devam ederdi.
  for (const ad of Object.keys(sema.alanlar) as (keyof T)[]) {
    const alan = sema.alanlar[ad];
    for (const a of [...alan.anahtarlar, ...(alan.eskiAnahtarlar ?? [])]) {
      sp.delete(a);
    }
  }
  // Kanonik sıra: şema bildirim sırası (Google'ın "logical order" kuralı).
  for (const ad of Object.keys(sema.alanlar) as (keyof T)[]) {
    sema.alanlar[ad].yaz(sp, duzeltilmis[ad]);
  }
  return sp;
}

/** Gezinme adresi — sıfırdan, kanonik sırayla; bilinmeyen anahtar MİRAS ALINMAZ. */
export function aramaAdresi<T>(sema: Sema<T>, deger: Partial<T>): string {
  const tam = { ...bosDeger(sema), ...deger } as T;
  const qs = aramayiYaz(sema, tam).toString();
  return qs ? `${sema.taban}?${qs}` : sema.taban;
}

/** Şemanın tüm varsayılanları. */
export function bosDeger<T>(sema: Sema<T>): T {
  const cikti = {} as T;
  for (const ad of Object.keys(sema.alanlar) as (keyof T)[]) {
    cikti[ad] = sema.alanlar[ad].varsayilan;
  }
  return cikti;
}

/**
 * Kullanıcı gerçekten filtre uyguladı mı? (`filtreDisi` alanlar sayılmaz.)
 * Kütüphane sayfasındaki keşif şeritleri buna bakar.
 */
export function filtreliMi<T>(sema: Sema<T>, deger: T): boolean {
  const disi = new Set<string>(sema.filtreDisi ?? []);
  return (Object.keys(sema.alanlar) as (keyof T & string)[]).some((ad) => {
    if (disi.has(ad)) return false;
    const sp = new URLSearchParams();
    sema.alanlar[ad].yaz(sp, deger[ad]);
    return [...sp.keys()].length > 0;
  });
}

/* ─── Alan birleştiricileri ──────────────────────────────────────────── */

/** İlk dolu anahtarı döner (kanonik → eski sırayla). Göç yolunun kalbi. */
function ilkDolu(
  sp: URLSearchParams,
  anahtarlar: readonly string[],
  eski: readonly string[] = []
): string | null {
  for (const a of [...anahtarlar, ...eski]) {
    const v = sp.get(a);
    if (v !== null && v !== "") return v;
  }
  return null;
}

export function metin(
  anahtar: string,
  eskiAnahtarlar: readonly string[] = []
): Alan<string> {
  return {
    anahtarlar: [anahtar],
    eskiAnahtarlar,
    varsayilan: "",
    oku: (sp) => (ilkDolu(sp, [anahtar], eskiAnahtarlar) ?? "").trim(),
    yaz: (sp, d) => {
      const v = d.trim();
      if (v) sp.set(anahtar, v);
    },
  };
}

export function metinCoklu(
  anahtar: string,
  eskiAnahtarlar: readonly string[] = []
): Alan<string[]> {
  return {
    anahtarlar: [anahtar],
    eskiAnahtarlar,
    varsayilan: [],
    oku: (sp) => {
      for (const a of [anahtar, ...eskiAnahtarlar]) {
        const hepsi = sp.getAll(a).filter((v) => v.trim() !== "");
        if (hepsi.length) return hepsi;
      }
      return [];
    },
    // Tekrarlı anahtar (`?a=1&a=2`) — Google'ın önerdiği ayırıcı.
    yaz: (sp, d) => d.filter(Boolean).forEach((v) => sp.append(anahtar, v)),
  };
}

export function sayi(
  anahtar: string,
  o: { min?: number; max?: number } = {},
  eskiAnahtarlar: readonly string[] = []
): Alan<number | undefined> {
  return {
    anahtarlar: [anahtar],
    eskiAnahtarlar,
    varsayilan: undefined,
    oku: (sp) => {
      const ham = ilkDolu(sp, [anahtar], eskiAnahtarlar);
      if (ham === null) return undefined;
      const n = Number(ham);
      if (!Number.isFinite(n)) return undefined;
      if (o.min !== undefined && n < o.min) return undefined;
      if (o.max !== undefined && n > o.max) return undefined;
      return n;
    },
    yaz: (sp, d) => {
      if (d !== undefined) sp.set(anahtar, String(d));
    },
  };
}

export function bayrak(
  anahtar: string,
  eskiAnahtarlar: readonly string[] = []
): Alan<boolean> {
  return {
    anahtarlar: [anahtar],
    eskiAnahtarlar,
    varsayilan: false,
    oku: (sp) => ilkDolu(sp, [anahtar], eskiAnahtarlar) === "1",
    yaz: (sp, d) => {
      if (d) sp.set(anahtar, "1");
    },
  };
}

/**
 * Tek seçimli enum — URL'de TÜRKÇE slug, kodda ve API'de enum değeri.
 *
 * `etiketler` slug↔enum çevirisini tek yerde yapar: adres "hackable" olur
 * (`?sekil=yuz-yuze`, `?sekil=IN_PERSON` değil) ama API'ye giden değer
 * değişmez, yani backend'e dokunulmaz. Eski enum değeri de OKUNUR — paylaşılmış
 * `?mode=IN_PERSON` linki çalışmaya devam eder.
 */
export function enumTek<E extends string>(
  anahtar: string,
  etiketler: Readonly<Record<E, string>>,
  eskiAnahtarlar: readonly string[] = []
): Alan<E | ""> {
  const slugdan = new Map<string, E>();
  for (const [uye, slug] of Object.entries(etiketler) as [E, string][]) {
    slugdan.set(slug, uye);
    slugdan.set(uye, uye); // eski biçim (ham enum değeri) de okunur
  }
  return {
    anahtarlar: [anahtar],
    eskiAnahtarlar,
    varsayilan: "",
    // Tanınmayan değer varsayılana düşer VE ilk yazımda adresten silinir.
    oku: (sp) => slugdan.get(ilkDolu(sp, [anahtar], eskiAnahtarlar) ?? "") ?? "",
    yaz: (sp, d) => {
      if (d) sp.set(anahtar, etiketler[d]);
    },
  };
}

/**
 * Sayfa numarası — `lib/pagination`'ın sözleşmesini şemaya takar.
 *
 * `sayfa=1` yazılmaz (varsayılan), geçersiz değer 1'e düşer. Ayrıca `sayfa`
 * her şemada `filtreDisi`dir: 2. sayfaya geçmek "kullanıcı filtre uyguladı"
 * demek değildir.
 */
export function sayfaAlani(): Alan<number> {
  return {
    anahtarlar: [PAGE_PARAM],
    varsayilan: 1,
    oku: (sp) => pageFromParam(sp.get(PAGE_PARAM)),
    yaz: (sp, d) => {
      if (d > 1) sp.set(PAGE_PARAM, String(Math.min(Math.floor(d), MAX_PAGE)));
    },
  };
}
