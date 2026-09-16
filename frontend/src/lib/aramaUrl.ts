/**
 * Arama adreslerinin TEK KAPISI — üç yüzey, üç şema, tek motor.
 *
 * Buradan önce query string altı ayrı yerde elle kuruluyordu
 * (`Landing` ×4, `useNavSearch`, `store/StoreSearch`, `store/StorePage`) ve
 * ikisi birbirinden habersiz iki sözleşme üretmişti: ana sayfa eğitmen araması
 * `?subject=` yazarken `useNavSearch` aynı hedefe `?q=` yazıyordu. Aynı
 * dağınıklığın ikinci yüzü, yazılan ders metninin hiçbir yere gitmemesiydi.
 *
 * ## Neden `routes.ts`'te değil
 *
 * `routes.ts` saf bir yol tablosudur ve neredeyse her bileşen onu import eder.
 * Arama üreticisi oraya girseydi `yerArama → adanaYerler` (440 mahalle) zinciri
 * `routes.ts`'i import eden HER modüle bağlanırdı. Yön tek: `aramaUrl → routes`,
 * asla tersi.
 *
 * ## Parametre adları
 *
 * Bugünkü adlar korunuyor (`q`, `subject`, `district`, `mahalle`, `mode`,
 * `exam`, `gender`, `sayfa`, `category`, `kind`, `sort`). Türkçeleşme kararı
 * VERİLDİ (`ders`, `ilce`, `sekil`, `sinav`, `cinsiyet`, `sirala`, `kategori`,
 * `tur`) ama okuma tarafı da şemaya bağlanana kadar ertelendi — yazma Türkçe
 * yazıp okuma eski adı ararsa paylaşılmış her bağlantı sessizce boş sonuç
 * verir. Göç günü her alana `eskiAnahtarlar` verilir; okuma iki adı da tanır,
 * yazma yalnız kanoniği üretir.
 */
import {
  aramaAdresi,
  bayrak,
  filtreliMi as filtreliMiMotor,
  metin,
  metinCoklu,
  enumCoklu,
  enumTek,
  sayfaAlani,
  sayi,
  type Alan,
  type Sema,
} from "@/lib/urlSemasi";
import { ROUTES } from "@/lib/routes";
import { AMENITY_OPTIONS } from "@/lib/amenities";
import { TeachingMode, Gender, TutorSort, type ProductKind } from "@/types";
import {
  ILCE_PARAM,
  ILCE_PARAM_ESKI,
  yerinArananKonumu,
  yeriOku,
  yeriYaz,
  type YerSecimi,
} from "@/lib/yerArama";

import type { TutorSearchParams } from "@/api/tutors";
import type { LibrarySearchParams } from "@/api/libraries";

export const VARSAYILAN_YARICAP_KM = 5;
/**
 * "Uzaklık: Farketmez" (kullanıcı kararı, 16 Eyl 2026): kullanıcı YAKINIMDA
 * modundan ÇIKMAZ — konumu referans kalır, yalnız yarıçap sınırı kalkar.
 * Adreste `yaricap=0`; isteğe `radius_km` yazılmaz, koordinat gider.
 * Eskiden Farketmez niyeti düşürüyor ve konumu unutturuyordu; kullanıcı
 * tekrar 5 km seçemiyor, konum yeniden isteniyordu.
 */
export const YARICAP_FARKETMEZ = 0;


/* ─── Ortak alanlar ──────────────────────────────────────────────────── */

/**
 * Cinsiyet — `UNSPECIFIED` bir FİLTRE değil, "belirtilmemiş" verisidir; o
 * yüzden etiket tablosunda yok ve URL'e hiç yazılamaz.
 */
const cinsiyetAlani = enumTek<Gender.MALE | Gender.FEMALE>(
  "cinsiyet",
  { [Gender.MALE]: "erkek", [Gender.FEMALE]: "kadin" },
  ["gender"]
);

const turAlani = enumTek<ProductKind>(
  "tur",
  { PHYSICAL: "fiziksel", DIGITAL: "dijital" },
  ["kind"]
);

/**
 * Ders şekli — URL'de Türkçe, API'de enum.
 *
 * `BOTH` bilerek YOK: eğitmen kaydında "her ikisi" diye bir seçim var ama
 * ARAMADA anlamı yok — "uzaktan ya da yüz yüze" demek filtre uygulamamakla
 * aynı şey. Eskiden kutuda "İkisi de olur" satırı vardı ve adrese hiçbir mod
 * yazmıyordu: filtre varmış gibi görünen, olmayan bir filtre.
 */
const SEKIL_ETIKETLERI = {
  [TeachingMode.ONLINE]: "uzaktan",
  [TeachingMode.IN_PERSON]: "yuz-yuze",
} as const;

/** Eğitmen sıralaması. `RELEVANCE` varsayılandır → URL'e yazılmaz. */
const EGITMEN_SIRALAMA = {
  [TutorSort.PRICE_ASC]: "fiyat-artan",
  [TutorSort.PRICE_DESC]: "fiyat-azalan",
  [TutorSort.RATING_DESC]: "puan",
} as const;

/** Kütüphane sıralaması. Boş = varsayılan (alaka). */
const KUTUPHANE_SIRALAMA = { rating: "puan", distance: "mesafe" } as const;

/** Mağaza sıralaması. Eğitmenle aynı slug'lar — aynı kavram, aynı ad. */
const MAGAZA_SIRALAMA = {
  price_asc: "fiyat-artan",
  price_desc: "fiyat-azalan",
  rating: "puan",
  newest: "yeni",
} as const;

export type MagazaSiralamasi = keyof typeof MAGAZA_SIRALAMA;

/** Olanak slug'ları zaten Türkçe; etiket tablosu kimlik eşlemesi. */
const OLANAK_ETIKETLERI = Object.fromEntries(
  AMENITY_OPTIONS.map((a) => [a, a])
) as Record<string, string>;

/**
 * "Yakınımda" — koordinat ADRESE YAZILMAZ.
 *
 * Airbnb'nin `location_search=NEARBY` fikri alındı, ham enlem/boylam
 * ALINMADI: bir arama bağlantısı paylaşıldığında kullanıcının bulunduğu yeri
 * 5 haneli hassasiyetle taşımamalı. Adres yalnız NİYETİ taşır
 * (`yakinimda=1&yaricap=25`); koordinat açılışta tarayıcıdan yeniden istenir.
 * Aynı gerekçe `yerArama`nın mahalle ADI taşıma kararında da var.
 */

/**
 * Konum — TEK alan, İKİ anahtar (`mahalle` + ilçe).
 *
 * Sözleşmenin sahibi `lib/yerArama`nın `yeriYaz`/`yeriOku` çiftidir ve öyle
 * kalır: URL'de ham koordinat değil mahalle ADI taşınması, mahalle yazılırken
 * ilçenin yedek olarak da yazılması ve eski `district` adının okunmaya devam
 * etmesi orada ölçülmüş kararlardır. Şema onları çok-anahtarlı bir alan
 * olarak takar, yeniden yazmaz.
 */
function yerAlaniOlustur(): Alan<KonumDegeri> {
  return {
    anahtarlar: ["mahalle", ILCE_PARAM],
    eskiAnahtarlar: [ILCE_PARAM_ESKI],
    varsayilan: { yer: null, ilce: [] },
    oku: (sp) => yeriOku(sp),
    yaz: (sp, d) => yeriYaz(sp, d.yer, d.ilce),
  };
}

/* ─── Şemalar ────────────────────────────────────────────────────────── */

export interface KonumDegeri {
  yer: YerSecimi | null;
  ilce: string[];
}

export interface EgitmenAramasi {
  /** Serbest metin. Katalogdan ders SEÇİLMEDİYSE yazılan şey buraya düşer. */
  q: string;
  /** Katalogdan seçilmiş ders(ler) — sert filtre. */
  ders: string[];
  konum: KonumDegeri;
  /** Ders şekli — ÇOKLU. Oturumlu pazaryeri onay kutusuyla birden fazla
   *  seçtiriyor; anonim yüzey ilk değeri tek seçim gibi okuyor. */
  sekil: (TeachingMode.ONLINE | TeachingMode.IN_PERSON)[];
  sinav: string;
  cinsiyet: Gender.MALE | Gender.FEMALE | "";
  /** Boş = alaka (varsayılan). */
  sirala: TutorSort | "";
  minFiyat: number | undefined;
  maxFiyat: number | undefined;
  minYas: number | undefined;
  maxYas: number | undefined;
  /** Kullanıcının kendi konumu çevresinde ara. Koordinat URL'e GİRMEZ. */
  yakinimda: boolean;
  yaricap: number | undefined;
  sayfa: number;
}

export interface KutuphaneAramasi {
  q: string;
  konum: KonumDegeri;
  olanaklar: string[];
  sirala: "rating" | "distance" | "";
  yakinimda: boolean;
  yaricap: number | undefined;
  sayfa: number;
}

export interface MagazaAramasi {
  q: string;
  kategori: number | undefined;
  tur: ProductKind | "";
  sirala: MagazaSiralamasi | "";
  minFiyat: number | undefined;
  maxFiyat: number | undefined;
  stokta: boolean;
  minPuan: number | undefined;
  yayinevi: string[];
  yazar: string[];
  kapak: string[];
  /** "Eksen:Değer" öğeleri — sunucunun `variant` parametre biçimi. */
  varyant: string[];
  sayfa: number;
}

export const EGITMEN_ARAMA: Sema<EgitmenAramasi> = {
  taban: ROUTES.tutors,
  // Bildirim sırası = adresteki kanonik sıra (Google: "logical order of the
  // filters always stays the same").
  alanlar: {
    q: metin("q"),
    ders: metinCoklu("ders", ["subject"]),
    konum: yerAlaniOlustur(),
    sekil: enumCoklu("sekil", SEKIL_ETIKETLERI, ["mode"]),
    sinav: metin("sinav", ["exam"]),
    cinsiyet: cinsiyetAlani,
    sirala: enumTek("sirala", EGITMEN_SIRALAMA, ["sort"]),
    // Üst sınırlar uydurma değil ürün sınırları: saatlik ücret ve yaş
    // dışındaki bir değer (ör. `?max_fiyat=1e9`) sunucuya hiç gitmemeli.
    minFiyat: sayi("min_fiyat", { min: 0, max: 100000 }),
    maxFiyat: sayi("max_fiyat", { min: 0, max: 100000 }),
    minYas: sayi("min_yas", { min: 0, max: 120 }),
    maxYas: sayi("max_yas", { min: 0, max: 120 }),
    yakinimda: bayrak("yakinimda"),
    yaricap: sayi("yaricap", { min: YARICAP_FARKETMEZ, max: 200 }),
    sayfa: sayfaAlani(),
  },
  /**
   * Konum UZAKTAN aramada düşer.
   *
   * Bu kural bugüne kadar `Landing.tsx`'in submit'inde vardı ama
   * `useNavSearch`'te YOKTU — aynı hedefe giden iki yol, iki farklı davranış.
   * Şemaya taşındı: artık bir çağrı yerinde doğru, diğerinde yanlış olamaz.
   *
   * Gerekçe (ilan sihirbazı sözleşmesi): ilçe yalnız yüz yüze derste zorunlu,
   * uzaktan eğitmenin ilçesi tasarım gereği boş. Uzaktan ders arayan birine
   * konum dayatmak, o eğitmenleri sessizce elerdi.
   *
   * KURAL "yalnız IN_PERSON'da tut" DEĞİL "ONLINE'da düşür" — çünkü şekil
   * BELİRTİLMEMİŞ (`""` = fark etmez) bir aramada konum tamamen meşrudur:
   * kullanıcı "Seyhan'da ders" arıyor, şeklini önemsemiyor olabilir. Katı
   * biçim Landing'de fark etmiyordu (yer alanı zaten yalnız yüz yüzede
   * görünür) ama üst bar aramasında kullanıcının seçmediği bir filtreyi
   * zorlamak anlamına gelirdi.
   */
  duzelt: (d) => {
    // YALNIZ uzaktan seçiliyken konum düşer. Karışık seçimde (uzaktan + yüz
    // yüze) konum anlamlıdır: yüz yüze verenler arasında ilçe süzülür.
    const konumsuz =
      d.sekil.length === 1 && d.sekil[0] === TeachingMode.ONLINE;
    // Konum düşerken konum NİYETİ de düşer; yoksa uzaktan aramada
    // kullanıcının çevresine daraltan bir yarıçap sessizce yaşamaya devam
    // ederdi. Sıra önemli: `yaricap` kararı DÜZELTİLMİŞ niyete bakar.
    const yakinimda = konumsuz ? false : d.yakinimda;
    return {
      ...d,
      konum: konumsuz ? { yer: null, ilce: [] } : d.konum,
      yakinimda,
      // Yarıçap yalnız "yakınımda" ile anlamlı. Yoksa adreste tek başına
      // duran bir `?yaricap=25` hiçbir şey yapmayan bir filtre gibi görünür.
      yaricap: yakinimda ? d.yaricap : undefined,
    };
  },
  filtreDisi: ["sayfa"],
};

export const KUTUPHANE_ARAMA: Sema<KutuphaneAramasi> = {
  taban: ROUTES.libraries,
  alanlar: {
    q: metin("q"),
    konum: yerAlaniOlustur(),
    olanaklar: enumCoklu("olanak", OLANAK_ETIKETLERI, ["amenities"]),
    sirala: enumTek("sirala", KUTUPHANE_SIRALAMA, ["sort"]),
    yakinimda: bayrak("yakinimda"),
    yaricap: sayi("yaricap", { min: YARICAP_FARKETMEZ, max: 200 }),
    sayfa: sayfaAlani(),
  },
  // "Mesafeye göre" sıralama kullanıcının konumu olmadan anlamsızdır; ikisi
  // tek bir niyetin iki yarısı, o yüzden kural burada yaşar.
  duzelt: (d) => ({
    ...d,
    yakinimda: d.sirala === "distance" ? true : d.yakinimda,
    yaricap: d.sirala === "distance" || d.yakinimda ? d.yaricap : undefined,
  }),
  filtreDisi: ["sayfa"],
};

export const MAGAZA_ARAMA: Sema<MagazaAramasi> = {
  taban: ROUTES.store,
  alanlar: {
    q: metin("q"),
    kategori: {
      anahtarlar: ["kategori"],
      eskiAnahtarlar: ["category"],
      varsayilan: undefined,
      oku: (sp) => {
        const n = Number(sp.get("kategori") ?? sp.get("category"));
        return Number.isFinite(n) && n > 0 ? n : undefined;
      },
      yaz: (sp, d) => {
        if (d !== undefined) sp.set("kategori", String(d));
      },
    } satisfies Alan<number | undefined>,
    tur: turAlani,
    sirala: enumTek("sirala", MAGAZA_SIRALAMA, ["sort"]),
    minFiyat: sayi("min_fiyat", { min: 0, max: 1000000 }),
    maxFiyat: sayi("max_fiyat", { min: 0, max: 1000000 }),
    stokta: bayrak("stokta"),
    minPuan: sayi("min_puan", { min: 1, max: 5 }),
    yayinevi: metinCoklu("yayinevi"),
    yazar: metinCoklu("yazar"),
    kapak: metinCoklu("kapak"),
    varyant: metinCoklu("varyant"),
    sayfa: sayfaAlani(),
  },
  filtreDisi: ["sayfa"],
};

/* ─── Çağrı yerlerinin gördüğü yüzey ─────────────────────────────────── */

export const egitmenAramaAdresi = (d: Partial<EgitmenAramasi>): string =>
  aramaAdresi(EGITMEN_ARAMA, d);

export const kutuphaneAramaAdresi = (d: Partial<KutuphaneAramasi>): string =>
  aramaAdresi(KUTUPHANE_ARAMA, d);

export const magazaAramaAdresi = (d: Partial<MagazaAramasi>): string =>
  aramaAdresi(MAGAZA_ARAMA, d);

/** Kullanıcı gerçekten filtre uyguladı mı (sayfa sayılmaz). */
export const filtreliMi = filtreliMiMotor;

/**
 * Ders kutusunun durumu → şema değeri.
 *
 * KAYBOLAN METİN BURADA KAPANIYOR. Eskiden yalnız SEÇİLMİŞ ders yazılıyordu;
 * kullanıcı "matematik" yazıp listeden seçmeden Ara'ya bastığında adres
 * parametresiz `/egitmenler` oluyor ve tüm eğitmenler listeleniyordu — hata
 * yok, sessiz kayıp. Kütüphane hapında aynı akış `?q=` ile zaten çalışıyordu.
 *
 * Seçim ve metin RAKİP DEĞİL tamamlayıcı: `subject` katalogdan seçilmiş sert
 * filtre, `q` serbest metin alaka araması. Üç okuma yüzeyi de ikisini zaten
 * okuyor, backend ikisini de alıyor.
 */
export function dersSorgusu(
  secim: string,
  metinDegeri: string
): Pick<EgitmenAramasi, "q" | "ders"> {
  return secim
    ? { ders: [secim], q: "" }
    : { ders: [], q: metinDegeri.trim() };
}


/* ─── Şema değeri → API isteği ───────────────────────────────────────────
   Bu çeviri bugüne kadar DÖRT ayrı yerde yazılıydı (`Marketplace` araması,
   aynı dosyadaki fiyat histogramı, `PublicMarketplace`, `Libraries`) ve
   ayrışmıştı: `PublicMarketplace`in eski `remote: boolean` alanı seçilen
   şekli sessizce buharlaştırıyordu. Çeviri şemanın yanında TEK yerde yaşar.

   Ekran-özel iki bilgi dışarıdan gelir: sayfalama (`limit`/`offset`) ve
   "yakınımda" için tarayıcıdan alınan KOORDİNAT — koordinat URL'de değildir
   ve olmayacaktır. */

export interface IstekEki {
  limit?: number;
  offset?: number;
  /** Tarayıcıdan alınan konum; yalnız `yakinimda` açıkken anlamlı. */
  konumum?: { lat: number; lng: number } | null;
}

/** Adresteki yarıçap → istek: yok = varsayılan, 0 = sınırsız (Farketmez). */
function yaricapIstegi(yaricap: number | undefined): number | undefined {
  if (yaricap === undefined) return VARSAYILAN_YARICAP_KM;
  return yaricap === YARICAP_FARKETMEZ ? undefined : yaricap;
}

export function egitmenIstegi(
  d: EgitmenAramasi,
  ek: IstekEki = {}
): TutorSearchParams {
  const p: TutorSearchParams = {};
  if (ek.limit !== undefined) p.limit = ek.limit;
  if (ek.offset !== undefined) p.offset = ek.offset;
  if (d.sirala) p.sort = d.sirala;
  if (d.q.trim()) p.q = d.q.trim();
  if (d.ders.length) p.subject = d.ders;
  if (d.konum.ilce.length) p.district = d.konum.ilce;
  if (d.sinav.trim()) p.exam = d.sinav.trim();
  if (d.sekil.length) p.mode = d.sekil;
  if (d.cinsiyet) p.gender = d.cinsiyet;
  if (d.minFiyat !== undefined) p.min_rate = d.minFiyat;
  if (d.maxFiyat !== undefined) p.max_rate = d.maxFiyat;
  if (d.minYas !== undefined) p.min_age = d.minYas;
  if (d.maxYas !== undefined) p.max_age = d.maxYas;

  /*
   * Konum ÖNCELİĞİ: "yakınımdakiler" mahalle çapasını geçersiz kılar.
   * İkisi aynı anda anlamlı değil — kullanıcı ya kendi çevresini ya seçtiği
   * mahallenin çevresini arıyor. Bu kural eskiden iki dosyada ayrı ayrı
   * yazılıydı (`if (yerKonumu && !nearMe)`).
   */
  const cevre =
    d.yakinimda && ek.konumum
      ? { ...ek.konumum, radius_km: yaricapIstegi(d.yaricap) }
      : yerinArananKonumu(d.konum.yer);
  if (cevre) {
    p.lat = cevre.lat;
    p.lng = cevre.lng;
    if (cevre.radius_km !== undefined) p.radius_km = cevre.radius_km;
  }
  return p;
}

export function kutuphaneIstegi(
  d: KutuphaneAramasi,
  ek: IstekEki = {}
): LibrarySearchParams {
  const p: LibrarySearchParams = {};
  if (ek.limit !== undefined) p.limit = ek.limit;
  if (ek.offset !== undefined) p.offset = ek.offset;
  if (d.q.trim()) p.q = d.q.trim();
  if (d.konum.ilce.length) p.district = d.konum.ilce;
  if (d.olanaklar.length) p.amenities = d.olanaklar;

  const yakin = d.yakinimda && ek.konumum ? ek.konumum : null;
  const cevre = yakin
    ? { ...yakin, radius_km: yaricapIstegi(d.yaricap) }
    : yerinArananKonumu(d.konum.yer);
  if (cevre) {
    p.lat = cevre.lat;
    p.lng = cevre.lng;
    if (cevre.radius_km !== undefined) p.radius_km = cevre.radius_km;
  }
  // Mesafe sıralaması KOORDİNATSIZ istenemez: sunucuya "mesafeye göre sırala"
  // deyip referans nokta vermemek sessiz bir sıralama kaybıdır.
  if (d.sirala === "distance" && cevre) p.sort = "distance";
  else if (d.sirala === "rating") p.sort = "rating";
  else if (cevre) p.sort = "distance";
  return p;
}

/** "Yakınımda" için varsayılan yarıçap (km). */
/* 5 km (kullanıcı kararı, 16 Eyl 2026; eskiden 25). "Yakınımda" seçilince ve
   adreste yarıçap yoksa bu kullanılır. */
