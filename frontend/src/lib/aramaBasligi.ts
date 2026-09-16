import { TeachingMode } from "@/types";

/**
 * SONUÇ EKRANI HAPININ İKİ SATIRI — tek kaynak (kullanıcı kararı, 16 Eyl 2026;
 * referans Airbnb: "İstanbul bölgesindeki evler / Herhangi hafta • Misafir
 * ekleyin").
 *
 * Kural:
 *   - Konum seçiliyse başlık konumu söyler: "Çukurova bölgesindeki eğitmenler",
 *     "Merkez bölgesindeki eğitmenler", "Yakınımdaki eğitmenler". Alt satır
 *     dersi ve ders şeklini taşır; boş parça davet olarak yazılır.
 *   - Konum yoksa başlık dersi söyler ("Matematik eğitmenleri"), alt satır
 *     "Tüm Adana • Uzaktan" gibi.
 *
 * İki eğitmen sonuç sayfası (anonim / girişli) aynı fonksiyonu çağırır; iki
 * kez yazılsaydı zamanla ayrışırdı (bu ekranda daha önce yaşandı — bkz.
 * `__guards__/aramaHapiIkizligi.test.ts`).
 */
export function egitmenHapBasligi(a: {
  /** Serbest metin (`q`). */
  q: string;
  /** Katalogdan seçilmiş dersler. */
  dersler: readonly string[];
  /** `konumOzeti` çıktısı: "Uzaktan" / "Yakınımda" / "Merkez" / ilçe / mahalle / null. */
  konum: string | null;
  sekil: TeachingMode.ONLINE | TeachingMode.IN_PERSON | "";
}): { baslik: string; ozet: string } {
  const ders =
    a.q ||
    (a.dersler.length === 1
      ? a.dersler[0]
      : a.dersler.length
        ? `${a.dersler.length} ders`
        : "");
  const sekilAdi =
    a.sekil === TeachingMode.ONLINE
      ? "Uzaktan"
      : a.sekil === TeachingMode.IN_PERSON
        ? "Yüz yüze"
        : "Ders şekli ekleyin";

  /* "Uzaktan" bir yer değil; başlıkta "Uzaktan bölgesindeki" olmaz. */
  const yerKonumu = a.konum && a.konum !== "Uzaktan" ? a.konum : null;

  if (yerKonumu) {
    const baslik =
      yerKonumu === "Yakınımda"
        ? "Yakınımdaki eğitmenler"
        : `${yerKonumu} bölgesindeki eğitmenler`;
    return { baslik, ozet: `${ders || "Ders ekleyin"}  •  ${sekilAdi}` };
  }
  const baslik = ders
    ? a.dersler.length > 1 && !a.q
      ? `${a.dersler.length} ders için eğitmenler`
      : `${ders} eğitmenleri`
    : "Tüm eğitmenler";
  return { baslik, ozet: `Tüm Adana  •  ${sekilAdi}` };
}

/** Kütüphane sonuç ekranı — aynı kalıp. Alt satır olanak sayısını taşır. */
export function kutuphaneHapBasligi(a: {
  konum: string | null;
  olanakSayisi: number;
}): { baslik: string; ozet: string } {
  const baslik = a.konum
    ? a.konum === "Yakınımda"
      ? "Yakınımdaki kütüphaneler"
      : `${a.konum} bölgesindeki kütüphaneler`
    : "Tüm kütüphaneler";
  const olanak = a.olanakSayisi ? `${a.olanakSayisi} olanak` : "Olanak ekleyin";
  return { baslik, ozet: `${a.konum ? "Adana" : "Tüm Adana"}  •  ${olanak}` };
}
