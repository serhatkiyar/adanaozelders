import { VARSAYILAN_YARICAP_KM, YARICAP_FARKETMEZ } from "@/lib/aramaUrl";
import { TeachingMode } from "@/types";

/**
 * SONUÇ EKRANI HAPININ İKİ SATIRI — tek kaynak (kullanıcı kararı, 16 Eyl 2026;
 * referans Airbnb: "İstanbul bölgesindeki evler / Herhangi hafta • Misafir
 * ekleyin").
 *
 * Kural:
 *   - Konum seçiliyse başlık YALNIZ konumun adıdır: "Çukurova", "Merkez",
 *     "Yakınımda" ("bölgesindeki eğitmenler" eki kaldırıldı — kullanıcı
 *     kararı, 16 Eyl 2026). Alt satır dersi ve ders şeklini taşır; boş parça
 *     davet olarak yazılır.
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
}): { baslik: string; ozet: string; parcalar: string[] } {
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

  /* MASAÜSTÜ daralmış hapın parçaları — "|" ile ayrılır (kullanıcı, 16 Eyl
     2026: "masaüstünde nokta ile değil | ile ayrılıyor"). Airbnb'nin
     "Anywhere | Any week | Add guests" düzeni: boş parça da davet olarak
     durur. Uzaktan seçiliyse yer sorulmaz, ilk parça "Uzaktan". */
  const parcalar = [
    a.konum ?? "Tüm Adana",
    ders || "Ders ekleyin",
    ...(a.konum === "Uzaktan" ? [] : [sekilAdi]),
  ];
  if (yerKonumu) {
    return { baslik: yerKonumu, ozet: `${ders || "Ders ekleyin"}  •  ${sekilAdi}`, parcalar };
  }
  const baslik = ders
    ? a.dersler.length > 1 && !a.q
      ? `${a.dersler.length} ders için eğitmenler`
      : `${ders} eğitmenleri`
    : "Tüm eğitmenler";
  return { baslik, ozet: `Tüm Adana  •  ${sekilAdi}`, parcalar };
}

/** Kütüphane sonuç ekranı — aynı kalıp. Alt satır olanak sayısını taşır. */
export function kutuphaneHapBasligi(a: {
  konum: string | null;
  olanakSayisi: number;
}): { baslik: string; ozet: string; parcalar: string[] } {
  /* Kütüphanede "bölgesindeki" eki DURUR (kullanıcı kararı, 16 Eyl 2026):
     "Çukurova bölgesindeki kütüphaneler"; Yakınımda için "Yakınımdaki
     kütüphaneler". Eğitmende kaldırıldı, burada sorun görülmedi. */
  const baslik = a.konum
    ? a.konum === "Yakınımda"
      ? "Yakınımdaki kütüphaneler"
      : `${a.konum} bölgesindeki kütüphaneler`
    : "Tüm kütüphaneler";
  /* "Olanak ekleyin" DAVETİ YOK (kullanıcı, 16 Eyl 2026): hap olanak
     seçtirmiyor; seçilmişse sayısı yazılır, yoksa hiçbir şey. Masaüstü
     hapın ilk parçası da başlığın kendisi ("… bölgesindeki kütüphaneler"). */
  const olanak = a.olanakSayisi ? `${a.olanakSayisi} olanak` : null;
  /* Kompakt hapın parçaları yalnız GERÇEK seçimlerdir: hiçbir şey seçili
     değilse boş dizi → hap "Aramaya başlayın" der (kullanıcı, 16 Eyl 2026:
     "Tüm kütüphaneler yazıyor, rezil"). Telefon başlığı (`baslik`) sayfa
     başlığı olduğu için "Tüm kütüphaneler" demeye devam eder. */
  return {
    baslik,
    ozet: olanak ?? (a.konum ? "Adana" : "Tüm Adana"),
    parcalar: [...(a.konum ? [baslik] : []), ...(olanak ? [olanak] : [])],
  };
}

/* "Yakınımda" seçiliyken şeritteki ÇİP (kullanıcı kararı, 16 Eyl 2026):
   yarıçap adreste yoksa varsayılan (5 km) yazılır; kullanıcı Yakınımda'yı
   seçince hangi mesafede arandığını "Filtreler |" ayracından sonra görür. */
export function uzaklikCipi(yaricap: number | undefined): string {
  if (yaricap === YARICAP_FARKETMEZ) return "Uzaklık Farketmez";
  return `Uzaklık ${yaricap ?? VARSAYILAN_YARICAP_KM} km`;
}

/** Filtre penceresindeki Mesafe seçenekleri — eğitmen ve kütüphane ORTAK. */
export const MESAFE_SECENEKLERI: { value: string; label: string }[] = [
  { value: String(YARICAP_FARKETMEZ), label: "Farketmez" },
  ...[1, 3, 5, 10, 15, 25].map((km) => ({ value: String(km), label: `${km} km` })),
];
