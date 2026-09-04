import type { FormDurumu } from "./tipler";

/**
 * Yarım kalan başvurunun taslağı (localStorage).
 *
 * Form tek ekranda ve uzun; kişi telefonu elinden bıraktığında yazdıklarını
 * kaybetmemeli. SAKLANMAYANLAR bilinçlidir:
 *   - **KVKK onayı**: rıza taze bir eylem olmalı, kutuyu yeniden işaretlesin.
 *   - **Fotoğraf ve belgeler**: serileşmezler; ayrıca kişinin bilgisi dışında
 *     tarayıcıda dosya tutmak istemeyiz.
 *
 * Taslak dönüşte KENDİLİĞİNDEN doldurulmaz: kullanıcıya sorulur (bkz. sayfa).
 */

const ANAHTAR = "egitmen-on-basvuru-taslak-v2";
/** Taslak ömrü. Aylar öncesinden kalan yarım metni geri sunmak faydadan çok şaşırtır. */
const OMUR_MS = 7 * 24 * 60 * 60 * 1000;

/** Saklanan alanlar — hepsi düz metin. Liste burada TEK kaynaktır. */
const ALANLAR = [
  "ad",
  "telefon",
  "dersler",
  "eposta",
  "baslik",
  "tanitim",
  "deneyim",
  "bicim",
  "ilce",
  "ucret",
  "musaitlik",
  "video",
  "egitim",
  "not",
] as const;

export type TaslakAlanlari = Pick<FormDurumu, (typeof ALANLAR)[number]>;

export interface Taslak {
  alanlar: TaslakAlanlari;
  kaydedildi: number;
}

/** Depo erişimi private mod / kotada patlayabilir; taslak asla akışı bozmaz. */
function guvenli<T>(is: () => T, varsayilan: T): T {
  try {
    return is();
  } catch {
    return varsayilan;
  }
}

export function taslagiYaz(degerler: FormDurumu): void {
  guvenli(() => {
    const alanlar = {} as TaslakAlanlari;
    let doluMu = false;
    for (const alan of ALANLAR) {
      const deger = degerler[alan] ?? "";
      alanlar[alan] = deger;
      if (deger) doluMu = true;
    }
    if (!doluMu) {
      window.localStorage.removeItem(ANAHTAR);
      return;
    }
    window.localStorage.setItem(
      ANAHTAR,
      JSON.stringify({ alanlar, kaydedildi: Date.now() } satisfies Taslak)
    );
  }, undefined);
}

export function taslagiOku(): Taslak | null {
  return guvenli(() => {
    const ham = window.localStorage.getItem(ANAHTAR);
    if (!ham) return null;
    const veri = JSON.parse(ham) as Partial<Taslak>;
    if (typeof veri?.kaydedildi !== "number") return null;
    if (Date.now() - veri.kaydedildi > OMUR_MS) {
      window.localStorage.removeItem(ANAHTAR);
      return null;
    }
    // Alanlar tek tek süzülür: depodaki eski/bozuk bir kayıt forma beklenmedik
    // anahtar taşımasın.
    const alanlar = {} as TaslakAlanlari;
    for (const alan of ALANLAR) {
      const deger = (veri.alanlar as Record<string, unknown> | undefined)?.[alan];
      alanlar[alan] = typeof deger === "string" ? deger : "";
    }
    return { alanlar, kaydedildi: veri.kaydedildi };
  }, null);
}

export function taslagiSil(): void {
  guvenli(() => window.localStorage.removeItem(ANAHTAR), undefined);
}
