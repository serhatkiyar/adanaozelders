/**
 * Anonim ziyaretçinin BEKLEYEN NİYETİ — kapı eylemde, gezinmede değil (ÜK-10).
 *
 * Korumalı bir eyleme tıklayan ziyaretçi için giriş penceresi açılır; ne
 * yapmak istediği burada bekler ve giriş tamamlanınca uygulanır. Böylece
 * kullanıcı aynı düğmeye ikinci kez basmak zorunda kalmaz.
 *
 * `sessionStorage` bilinçli: niyet sekmeyle birlikte ölür, hesaplar arası
 * taşınmaz, diske yazılmaz.
 *
 * ## Neden TEK niyet, tek anahtar
 *
 * Her eylem türü için ayrı bir depo tutulsaydı aynı anda hem bekleyen bir
 * favori hem bekleyen bir ders talebi olabilirdi; tek girişten sonra İKİSİ
 * BİRDEN ateşlenir ve kullanıcı istemediği bir pencereyle karşılaşırdı. Kapı
 * tek eylemle açılır, dolayısıyla niyet de tektir: son tıklama kazanır.
 *
 * ## Neden `niyetiAl` tip parametreli
 *
 * Niyetler iki yerde uygulanıyor: `favori` global uygulayıcıda (saf API
 * çağrısı), diğerleri kendi sayfalarında ("bu sayfanın penceresini aç"). Global
 * uygulayıcı niyeti KOŞULSUZ tüketseydi sayfanınkini yerdi — kullanıcı "Ders
 * Talep Et"e basar, giriş yapar, hiçbir şey olmaz ve hata da görünmez. ÜK-6'da
 * ölçülen sessiz kaybın birebir tekrarı. Bu yüzden tüketim tip kapsamlıdır.
 *
 * NOT (9 Eyl 2026 göçü): anahtar `pending_favorite` → `bekleyen_niyet`.
 * Dağıtım anında akışın ortasındaki ziyaretçi eski kaydını kaybeder — etki bir
 * kalp, `sessionStorage` zaten sekmeyle ölüyor. Göç kodu yazmaya değmez.
 */

export type BekleyenNiyet =
  | { tip: "favori"; hedef: "egitmen" | "kutuphane"; id: number }
  | { tip: "dersTalebi"; egitmenId: number }
  | { tip: "kutuphaneRezervasyonu"; kutuphaneId: number }
  | { tip: "odeme" };

const ANAHTAR = "bekleyen_niyet";

/**
 * `tip` → gövde doğrulayıcısı.
 *
 * Storage GÜVENİLMEZ girdidir (elle kurcalanabilir, eski sürümden kalmış
 * olabilir). Tablo tipi `{ [T in BekleyenNiyet["tip"]]: … }` olduğu için
 * birleşime beşinci bir üye eklenip buraya yazılmazsa `tsc` kırılır —
 * doğrulama boşluğu derleme zamanında yakalanır, nöbetçiye gerek kalmaz.
 */
const DOGRULAYICI: {
  [T in BekleyenNiyet["tip"]]: (d: Record<string, unknown>) => boolean;
} = {
  favori: (d) =>
    (d.hedef === "egitmen" || d.hedef === "kutuphane") && typeof d.id === "number",
  dersTalebi: (d) => typeof d.egitmenId === "number",
  kutuphaneRezervasyonu: (d) => typeof d.kutuphaneId === "number",
  odeme: () => true,
};

function coz(ham: string | null): BekleyenNiyet | null {
  if (ham == null) return null;
  try {
    const parsed: unknown = JSON.parse(ham);
    if (typeof parsed !== "object" || parsed === null) return null;
    const kayit = parsed as Record<string, unknown>;
    const tip = kayit.tip;
    if (typeof tip !== "string" || !(tip in DOGRULAYICI)) return null;
    const dogrula = DOGRULAYICI[tip as BekleyenNiyet["tip"]];
    return dogrula(kayit) ? (parsed as BekleyenNiyet) : null;
  } catch {
    return null;
  }
}

export function niyetiSakla(niyet: BekleyenNiyet): void {
  try {
    sessionStorage.setItem(ANAHTAR, JSON.stringify(niyet));
  } catch {
    /* storage kapalıysa (gizli mod vb.) niyetsiz devam — giriş yine açılır */
  }
}

/** Okur ama TÜKETMEZ. Bozuk kayıt `null` döner. */
export function niyetiGozle(): BekleyenNiyet | null {
  try {
    return coz(sessionStorage.getItem(ANAHTAR));
  } catch {
    return null;
  }
}

export function niyetiTemizle(): void {
  try {
    sessionStorage.removeItem(ANAHTAR);
  } catch {
    /* yok sayılır */
  }
}

/**
 * Saklı niyeti YALNIZ verilen tiplerden biriyse tüketip döner.
 *
 * Başka tipteki bir niyete DOKUNMAZ — onu bekleten sayfa hâlâ uygulayabilsin.
 * Bozuk/tanınmayan kayıt temizlenir (yoksa oturum boyunca çöp olarak kalırdı).
 */
export function niyetiAl<T extends BekleyenNiyet["tip"]>(
  ...tipler: T[]
): Extract<BekleyenNiyet, { tip: T }> | null {
  let ham: string | null;
  try {
    ham = sessionStorage.getItem(ANAHTAR);
  } catch {
    return null;
  }
  if (ham == null) return null;

  const niyet = coz(ham);
  if (!niyet) {
    niyetiTemizle();
    return null;
  }
  if (!(tipler as string[]).includes(niyet.tip)) return null;

  niyetiTemizle();
  return niyet as Extract<BekleyenNiyet, { tip: T }>;
}
