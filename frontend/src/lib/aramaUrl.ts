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
  filtreliMi as filtreliMiMotor,
  metin,
  metinCoklu,
  sayfaAlani,
  type Alan,
  type Sema,
} from "@/lib/urlSemasi";
import { ROUTES } from "@/lib/routes";
import { TeachingMode, Gender, type ProductKind } from "@/types";
import {
  ILCE_PARAM,
  ILCE_PARAM_ESKI,
  yeriOku,
  yeriYaz,
  type YerSecimi,
} from "@/lib/yerArama";

/* ─── Ortak alanlar ──────────────────────────────────────────────────── */

/** Ders şekli — tek seçim; `""` = "fark etmez" (filtre yazılmaz). */
const sekilAlani: Alan<TeachingMode | ""> = {
  anahtarlar: ["mode"],
  varsayilan: "",
  oku: (sp) => {
    const v = sp.get("mode");
    return v && (Object.values(TeachingMode) as string[]).includes(v)
      ? (v as TeachingMode)
      : "";
  },
  yaz: (sp, d) => {
    if (d) sp.set("mode", d);
  },
};

/** Cinsiyet — `UNSPECIFIED` bir FİLTRE değil, "belirtilmemiş" verisidir. */
const cinsiyetAlani: Alan<Gender | ""> = {
  anahtarlar: ["gender"],
  varsayilan: "",
  oku: (sp) => {
    const v = sp.get("gender");
    return v === Gender.MALE || v === Gender.FEMALE ? v : "";
  },
  yaz: (sp, d) => {
    if (d) sp.set("gender", d);
  },
};

const turAlani: Alan<ProductKind | ""> = {
  anahtarlar: ["kind"],
  varsayilan: "",
  oku: (sp) => {
    const v = sp.get("kind");
    return v === "PHYSICAL" || v === "DIGITAL" ? v : "";
  },
  yaz: (sp, d) => {
    if (d) sp.set("kind", d);
  },
};

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
    eskiAnahtarlar: ILCE_PARAM === ILCE_PARAM_ESKI ? [] : [ILCE_PARAM_ESKI],
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
  subject: string[];
  konum: KonumDegeri;
  sekil: TeachingMode | "";
  exam: string;
  cinsiyet: Gender | "";
  sayfa: number;
}

export interface KutuphaneAramasi {
  q: string;
  konum: KonumDegeri;
  sayfa: number;
}

export interface MagazaAramasi {
  q: string;
  kategori: number | undefined;
  tur: ProductKind | "";
  sirala: string;
  sayfa: number;
}

export const EGITMEN_ARAMA: Sema<EgitmenAramasi> = {
  taban: ROUTES.tutors,
  // Bildirim sırası = adresteki kanonik sıra (Google: "logical order of the
  // filters always stays the same").
  alanlar: {
    q: metin("q"),
    subject: metinCoklu("subject"),
    konum: yerAlaniOlustur(),
    sekil: sekilAlani,
    exam: metin("exam"),
    cinsiyet: cinsiyetAlani,
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
  duzelt: (d) =>
    d.sekil === TeachingMode.ONLINE
      ? { ...d, konum: { yer: null, ilce: [] } }
      : d,
  filtreDisi: ["sayfa"],
};

export const KUTUPHANE_ARAMA: Sema<KutuphaneAramasi> = {
  taban: ROUTES.libraries,
  alanlar: {
    q: metin("q"),
    konum: yerAlaniOlustur(),
    sayfa: sayfaAlani(),
  },
  filtreDisi: ["sayfa"],
};

export const MAGAZA_ARAMA: Sema<MagazaAramasi> = {
  taban: ROUTES.store,
  alanlar: {
    q: metin("q"),
    kategori: {
      anahtarlar: ["category"],
      varsayilan: undefined,
      oku: (sp) => {
        const n = Number(sp.get("category"));
        return Number.isFinite(n) && n > 0 ? n : undefined;
      },
      yaz: (sp, d) => {
        if (d !== undefined) sp.set("category", String(d));
      },
    } satisfies Alan<number | undefined>,
    tur: turAlani,
    sirala: metin("sort"),
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
): Pick<EgitmenAramasi, "q" | "subject"> {
  return secim
    ? { subject: [secim], q: "" }
    : { subject: [], q: metinDegeri.trim() };
}
