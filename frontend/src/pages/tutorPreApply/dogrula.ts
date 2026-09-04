import { normalizePhoneTR } from "@/lib/phone";

/**
 * Ön başvuru formunun saf kuralları.
 *
 * Neden ayrı dosya: aynı fonksiyonlar hem alan blur'unda hem gönderimde
 * çalışır ve doğrudan test edilir. Kurallar sunucudaki
 * `schemas/tutor_pre_application.py` ile AYNADIR — biri değişirse diğeri de
 * değişmeli (aksi hâlde kullanıcı istemcide geçip sunucuda 422 yer).
 */

/** Sunucu sınırı: `subjects` en fazla 20 öğe, öğe başına 100 karakter. */
export const MAX_DERS = 20;
export const MAX_DERS_UZUNLUK = 100;
/** `subjects` kolonu String(600); birleşik metin bunu aşamaz. */
export const MAX_DERS_TOPLAM = 600;

/**
 * Serbest metni ders listesine çevirir: virgül ve satır sonundan böler,
 * kırpar, tekilleştirir.
 *
 * Açık uçlu alanın karşılığı budur — kullanıcı "lise matematik, geometri"
 * yazar, sunucu sözleşmesi (`subjects: string[]`) korunur.
 */
export function dersleriAyristir(metin: string): string[] {
  const parcalar = metin.split(/[,\n;]+/);
  const temiz: string[] = [];
  for (const parca of parcalar) {
    const etiket = parca.trim().replace(/\s+/g, " ");
    if (!etiket) continue;
    // Büyük/küçük harf farkıyla aynı dersi iki kez göndermeyelim.
    if (temiz.some((v) => v.toLocaleLowerCase("tr") === etiket.toLocaleLowerCase("tr")))
      continue;
    temiz.push(etiket);
  }
  return temiz;
}

export interface Adim1Degerler {
  ad: string;
  telefon: string;
  dersler: string;
  kvkk: boolean;
}

export type Adim1Hatalar = Partial<Record<keyof Adim1Degerler, string>>;

/** Adım 1 — başvurunun tek zorunlu bölümü. */
export function dogrulaAdim1(degerler: Adim1Degerler): Adim1Hatalar {
  const hatalar: Adim1Hatalar = {};

  if (degerler.ad.trim().length < 2) {
    hatalar.ad = "Adını ve soyadını yaz.";
  }
  if (!normalizePhoneTR(degerler.telefon)) {
    hatalar.telefon = "Geçerli bir cep numarası gir (05XX XXX XX XX).";
  }

  const dersler = dersleriAyristir(degerler.dersler);
  if (dersler.length === 0) {
    hatalar.dersler = "Hangi dersleri verdiğini yaz.";
  } else if (dersler.length > MAX_DERS) {
    hatalar.dersler = `En fazla ${MAX_DERS} ders yazabilirsin.`;
  } else if (dersler.some((d) => d.length > MAX_DERS_UZUNLUK)) {
    hatalar.dersler = `Her dersi virgülle ayır; tek bir başlık ${MAX_DERS_UZUNLUK} karakteri geçemez.`;
  } else if (dersler.join(", ").length > MAX_DERS_TOPLAM) {
    hatalar.dersler = "Verdiğin dersler çok uzun, kısaltır mısın?";
  }

  if (!degerler.kvkk) {
    hatalar.kvkk = "Başvuru için aydınlatma metnini onaylaman gerekiyor.";
  }
  return hatalar;
}

/** Tanıtım videosu — sunucuyla aynı kural (https + YouTube/Vimeo). */
export function dogrulaVideo(url: string): string | undefined {
  const temiz = url.trim();
  if (!temiz) return undefined;
  if (!/^https:\/\//i.test(temiz)) return "Bağlantı https:// ile başlamalı.";
  const konak = temiz.replace(/^https:\/\//i, "").split("/")[0].toLowerCase();
  const izinli = ["youtube.com", "www.youtube.com", "youtu.be", "vimeo.com"];
  if (!izinli.includes(konak)) return "Yalnızca YouTube veya Vimeo bağlantısı olur.";
  return undefined;
}

/**
 * Ücreti sunucunun beklediği ondalık biçime çevirir ("1.250,5" → "1250.5").
 * Türkçe klavyede binlik nokta ve ondalık virgül olağandır; kullanıcıya
 * "nokta kullan" dedirtmek yerine burada çeviriyoruz.
 */
export function ucretiNormalle(deger: string): string {
  return deger.trim().replace(/\./g, "").replace(",", ".");
}

/** Saatlik ücret — boş geçilebilir; doluysa sayı olmalı. */
export function dogrulaUcret(deger: string): string | undefined {
  const temiz = ucretiNormalle(deger);
  if (!temiz) return undefined;
  const sayi = Number(temiz);
  if (!Number.isFinite(sayi) || sayi < 0) return "Ücreti sayı olarak yaz.";
  if (sayi > 100000) return "Bu tutar fazla görünüyor.";
  return undefined;
}
