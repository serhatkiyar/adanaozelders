import { ADANA_YERLER, type AdanaYer } from "@/lib/adanaYerler";
import { normalize } from "@/lib/dersArama";
import { SEARCH_MORE_DISTRICTS, SEARCH_PRIMARY_DISTRICTS } from "@/lib/districts";

/**
 * Konum önerileri üzerinde saf arama — mahalle VE ilçe.
 *
 * ## Neden var (kullanıcı, 8 Eyl 2026)
 *
 * Konum kutusu ilçe seviyesinde kalıyordu ve kullanıcı Superprof'un mahalleye
 * inen kutusunu gösterip *"ben yeni ekleyeceğim özellikte mahalleye kadar
 * olmasını istiyorum"* dedi.
 *
 * ## Türkçe katlama neden şart
 *
 * Eski seçicinin süzgeci düz `toLowerCase().includes()` idi. Yani "Cukurova"
 * yazan kullanıcı "Çukurova"yı **bulamıyordu** — hata yok, sadece boş liste.
 * Katlama `dersArama`nın `normalize`'ından gelir; o da sunucudaki
 * `tr_normalize()` ile aynı harf eşlemesini kullanır. Üç yerde ayrı katlama
 * yazmak, üç yerde ayrı sessiz arıza demektir.
 *
 * ## Mahalle bir FİLTRE değil, KONUM ÇAPASIDIR
 *
 * Seçilen mahallenin adı bir eşitlik filtresine dönüşmez; koordinatı alınıp
 * çevresinde aranır (bkz. `YER_YARICAP_KM`). Sektör pratiği de bu: Wyzant
 * posta kodu + mesafe soruyor, Superprof sonuç azalınca yarıçapı genişletmeyi
 * öneriyor. Tam mahalle eşleşmesi, sınırın 400 metre ötesindeki eğitmeni
 * sebepsiz eler.
 */

/** Mahalle seçildiğinde aranacak varsayılan yarıçap. */
export const YER_YARICAP_KM = 3;

export type YerSecimi =
  | { tur: "ilce"; ilce: string }
  | { tur: "mahalle"; ilce: string; mahalle: string; lat: number; lng: number };

export interface YerOnerisi {
  /** Listede gösterilecek birincil satır. */
  baslik: string;
  /** İkincil satır — mahallede ilçe adı, ilçede "Adana". */
  altBaslik: string;
  secim: YerSecimi;
}

/** Arama seçicisinin sunduğu ilçeler (nüfusa göre sıralı, ürün kararı). */
const TUM_ILCELER: readonly string[] = [
  ...SEARCH_PRIMARY_DISTRICTS,
  ...SEARCH_MORE_DISTRICTS,
];

const ilceOnerisi = (ilce: string): YerOnerisi => ({
  baslik: ilce,
  altBaslik: "Adana",
  secim: { tur: "ilce", ilce },
});

const mahalleOnerisi = (y: AdanaYer): YerOnerisi => ({
  baslik: y.mahalle,
  altBaslik: `${y.ilce}, Adana`,
  secim: {
    tur: "mahalle",
    ilce: y.ilce,
    mahalle: y.mahalle,
    lat: y.lat,
    lng: y.lng,
  },
});

/**
 * Sorguya uyan yerleri döndürür. Boş sorguda yalnız ilçeler — 440 mahalleyi
 * kutu açılır açılmaz dökmek, seçim yapmayı kolaylaştırmaz zorlaştırır.
 *
 * Sıralama:
 *   1. İlçeler mahallelerden önce — daha geniş seçim, daha çok sonuç verir.
 *   2. Önek eşleşmesi önce: "res" yazan "Reşatbey"i "Küçükreşatbey"den önce
 *      görmeli.
 *   3. Alfabetik (Türkçe sıralama).
 */
export function yerAra(sorgu: string, limit = 40): YerOnerisi[] {
  const q = normalize(sorgu);
  if (!q) return TUM_ILCELER.map(ilceOnerisi);

  const ilceler = TUM_ILCELER.filter((d) => normalize(d).includes(q));
  const mahalleler = ADANA_YERLER.filter((y) => normalize(y.mahalle).includes(q));

  const onekOnce = <T,>(dizi: T[], ad: (x: T) => string) =>
    [...dizi].sort((a, b) => {
      const ap = normalize(ad(a)).startsWith(q) ? 0 : 1;
      const bp = normalize(ad(b)).startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return ad(a).localeCompare(ad(b), "tr");
    });

  return [
    ...onekOnce(ilceler, (d) => d).map(ilceOnerisi),
    ...onekOnce(mahalleler, (y) => y.mahalle).map(mahalleOnerisi),
  ].slice(0, limit);
}

/** Seçimin kutuda ve özet satırlarında görünen adı. */
export function yerEtiketi(secim: YerSecimi | null): string {
  if (!secim) return "";
  return secim.tur === "mahalle"
    ? `${secim.mahalle}, ${secim.ilce}`
    : secim.ilce;
}

/**
 * URL'den gelen mahalle adını koordinatıyla birlikte çözer.
 *
 * URL'de ham koordinat DEĞİL mahalle adı taşınır: bağlantı paylaşılabilir
 * olmalı ve geri dönüldüğünde kutuda mahalle adı yeniden görünmeli.
 * `ilce` verilirse aynı adı taşıyan mahalleler arasında ayrım yapar —
 * Adana'da birden fazla ilçede aynı mahalle adı var (ör. "Cumhuriyet").
 */
export function mahalleyiCoz(
  mahalle: string | null,
  ilce?: string | null,
): YerSecimi | null {
  if (!mahalle) return null;
  const hedef = normalize(mahalle);
  const adaylar = ADANA_YERLER.filter((y) => normalize(y.mahalle) === hedef);
  const y =
    (ilce && adaylar.find((a) => normalize(a.ilce) === normalize(ilce))) ||
    adaylar[0];
  return y
    ? { tur: "mahalle", ilce: y.ilce, mahalle: y.mahalle, lat: y.lat, lng: y.lng }
    : null;
}

/* ─── URL sözleşmesi ──────────────────────────────────────────────────────
   URL'de ham KOORDİNAT taşınmaz, mahalle ADI taşınır. İki sebebi var:
   bağlantı paylaşılabilir olmalı (`?mahalle=Reşatbey` okunur, `?lat=37.0`
   okunmaz) ve geri dönüldüğünde kutuda mahalle adı yeniden görünmeli.
   Koordinat, sayfa tarafında `mahalleyiCoz` ile veri setinden çözülür.

   Mahalle yazılırken İLÇE de yazılır. Bu bilinçli bir yedektir: veri seti
   tazelenip bir mahalle adı değişirse ya da URL elle kurcalanırsa arama
   tamamen boşa düşmez, en azından ilçe filtresi çalışır. */

/**
 * İlçe parametresinin KANONİK adı.
 *
 * Bugün `district`. Türkçeleşme (→ `ilce`) kararı verildi ama BİLEREK
 * ertelendi: yazma tarafı Türkçe yazıp okuma tarafı hâlâ `district` ararsa
 * paylaşılmış her bağlantı sessizce boş sonuç verir. Göç, okuma da şemadan
 * beslendiğinde (Paket 2) TEK HAMLEDE yapılır — o an burada `"ilce"` yazmak
 * ve `ILCE_PARAM_ESKI`yi `"district"` bırakmak yeter.
 */
export const ILCE_PARAM = "district";
/** Göç sonrası eski bağlantıların okunmaya devam edeceği ad. */
export const ILCE_PARAM_ESKI = "district";

/** Seçili yeri arama parametrelerine yazar. */
export function yeriYaz(
  sp: URLSearchParams,
  yer: YerSecimi | null,
  ilceler: readonly string[],
): void {
  if (yer?.tur === "mahalle") {
    sp.set("mahalle", yer.mahalle);
    sp.set(ILCE_PARAM, yer.ilce);
    return;
  }
  ilceler.forEach((d) => sp.append(ILCE_PARAM, d));
}

/** URL'den yeri okur: mahalle çapası + ilçe listesi. */
export function yeriOku(sp: URLSearchParams): {
  yer: YerSecimi | null;
  ilce: string[];
} {
  // Kanonik → eski sırayla. Eski ad yalnız yenisi boşken devreye girer;
  // ikisi birden yazılı bir adres (elle kurcalama) kanoniği kazandırır.
  const kanonik = sp.getAll(ILCE_PARAM).filter(Boolean);
  const ilce = kanonik.length ? kanonik : sp.getAll(ILCE_PARAM_ESKI).filter(Boolean);
  const yer = mahalleyiCoz(sp.get("mahalle"), ilce[0] ?? null);
  return { yer, ilce };
}

/** Mahalle seçiliyse arama API'sine gidecek konum parametreleri. */
export function yerinArananKonumu(
  yer: YerSecimi | null,
): { lat: number; lng: number; radius_km: number } | null {
  return yer?.tur === "mahalle"
    ? { lat: yer.lat, lng: yer.lng, radius_km: YER_YARICAP_KM }
    : null;
}
