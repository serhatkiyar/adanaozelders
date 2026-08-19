/**
 * URL'de yaşayan liste durumu — filtre + sayfalama (İP-A4 · Görev 3b).
 *
 * ## Neden tek yerde
 *
 * Panelde filtreler bugün ya `useState`te (sayfa yenilenince kaybolur,
 * paylaşılamaz, geri tuşu çalışmaz) ya da her ekranda elle yazılmış bir
 * `useSearchParams` bloğunda yaşıyor. İkincisi çalışıyor ama üç kararı her
 * ekranda yeniden veriyor ve her ekranda farklı veriyor:
 *
 *   1. Varsayılan değer URL'e yazılsın mı? (yazılırsa adres çöplenir)
 *   2. Filtre değişince sayfa sıfırlanıyor mu? (unutulursa kullanıcı boş
 *      sayfada kalır — "sonuç yok" sanır)
 *   3. `push` mu `replace` mi? (`replace` geri tuşunu öldürür)
 *
 * A7'de bu desen 70 ekranda tekrarlanacak; kararları burada tek kez veriyoruz.
 *
 * ## Verilen kararlar
 *
 * - **Varsayılana eşit değer URL'e YAZILMAZ.** `?urun=&sayfa=1&boyut=25`
 *   gibi bir adres paylaşılabilir olmaktan çıkar; ayrıca "temiz mi" sorusunun
 *   cevabı adresin kendisinden okunur.
 * - **Filtre değişince sayfa anahtarı sıfırlanır.** Yamada sayfa anahtarı
 *   açıkça verilmediyse varsayılana döner. 3. sayfada filtre daraltıp boş
 *   ekran görmek, gerçek bir kullanıcı hatası kaynağıdır.
 * - **`push` (varsayılan)**: geri tuşu bir önceki filtreye döner.
 * - `filtreliMi` — "filtre eşleşmedi" ile "hiç kayıt yok" boş durumlarını
 *   ayırmak için. İkisi farklı çıkış sunar; karar ekranın, ölçüm buranın.
 *
 * ## Tip sözleşmesi
 *
 * Varsayılan nesnenin TİPİ okunan değerin tipini belirler: `sayfa: 1`
 * verilirse `degerler.sayfa` sayıdır ve URL'deki çöp (`?sayfa=abc`)
 * varsayılana düşer — ekran `NaN` ile uğraşmaz.
 */
import { useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

export type UrlDeger = string | number;

export interface UrlDurumuSecenekleri<T> {
  /**
   * Sayfa anahtarı. Yamada AÇIKÇA verilmediyse varsayılana sıfırlanır.
   * `null` verilirse sıfırlama davranışı kapanır.
   */
  sayfaAnahtari?: (keyof T & string) | null;
  /**
   * `filtreliMi` hesabında yok sayılan anahtarlar. Sayfa/sayfa boyutu filtre
   * değildir: 2. sayfada olmak "filtre uygulanmış" demek değildir ve boş
   * durumun metnini değiştirmemelidir.
   */
  filtreDisi?: (keyof T & string)[];
  /** Adres geçmişine yazma biçimi (varsayılan: `push` — geri tuşu çalışsın). */
  replace?: boolean;
}

export interface UrlDurumu<T> {
  degerler: T;
  /**
   * Verilen anahtarları yamar; sayfa anahtarı kuralı uygulanır.
   *
   * `replace` yamaya özel geçmiş biçimi: serbest metin kutusuna YAZARKEN
   * her tuş vuruşu ayrı bir geçmiş girdisi üretmemeli (kullanıcı "12345"
   * yazınca geri tuşuna beş kez basmak zorunda kalır). Ayrık filtreler
   * (seçim kutusu, sekme) `push` kalır — geri tuşu onlarda anlamlıdır.
   */
  ayarla: (yama: Partial<T>, secenek?: { replace?: boolean }) => void;
  /** Tüm filtreleri (ve sayfayı) varsayılana döndürür. */
  temizle: () => void;
  /** Filtre dışı anahtarlar hariç, varsayılandan sapan bir değer var mı. */
  filtreliMi: boolean;
}

/** Adresten okunan değerler — saf, hook dışında da çağrılabilir. */
function coz<T extends Record<string, UrlDeger>>(
  kaynak: URLSearchParams,
  anahtarlar: (keyof T & string)[],
  varsayilan: T
): T {
  const cikti = {} as T;
  for (const anahtar of anahtarlar) {
    const ham = kaynak.get(anahtar);
    const vars = varsayilan[anahtar];
    if (ham === null || ham === "") {
      cikti[anahtar] = vars;
      continue;
    }
    if (typeof vars === "number") {
      const sayi = Number(ham);
      // URL kullanıcı tarafından yazılabilir: çöp değer ekrana `NaN`
      // sızdırmaz, varsayılana düşer.
      cikti[anahtar] = (Number.isFinite(sayi) ? sayi : vars) as T[keyof T & string];
    } else {
      cikti[anahtar] = ham as T[keyof T & string];
    }
  }
  return cikti;
}

/** Verilen değerlerin adrese yazılmış hâli — bilinmeyen parametreler korunur. */
function yazilmisHali<T extends Record<string, UrlDeger>>(
  kaynak: URLSearchParams,
  anahtarlar: (keyof T & string)[],
  varsayilan: T,
  yeni: T
): URLSearchParams {
  const sonraki = new URLSearchParams(kaynak);
  for (const anahtar of anahtarlar) {
    const deger = yeni[anahtar];
    // Varsayılana eşitse adresten SİLİNİR (yukarıdaki karar).
    if (deger === varsayilan[anahtar] || deger === "") sonraki.delete(anahtar);
    else sonraki.set(anahtar, String(deger));
  }
  return sonraki;
}

export function useUrlDurumu<T extends Record<string, UrlDeger>>(
  varsayilan: T,
  secenekler: UrlDurumuSecenekleri<T> = {}
): UrlDurumu<T> {
  const { sayfaAnahtari = null, filtreDisi = [], replace = false } = secenekler;
  const [params, setParams] = useSearchParams();

  const anahtarlar = useMemo(() => Object.keys(varsayilan) as (keyof T & string)[],
    // Varsayılan nesne çağıran tarafta satır içi yazılır (her render'da yeni
    // kimlik); anahtar listesi İÇERİĞİNDEN türetilir, kimliğinden değil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Object.keys(varsayilan).join("|")]
  );

  const degerler = useMemo(
    () => coz(params, anahtarlar, varsayilan),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anahtarlar, params, JSON.stringify(varsayilan)]
  );

  // ── Aynı olaydaki İKİNCİ yazım (İP-A6c · BULGU-4) ──
  //
  // `setParams`ın fonksiyonel biçimi bu router sürümünde YETMEZ ve bu ölçüldü
  // (`docs/ip-a6c/g2-yalniz-fonksiyonel.txt`): react-router 7.18.1 geri
  // çağrıya canlı bir ref değil, RENDER SIRASINDA kapatılmış `searchParams`ı
  // geçirir (`useSearchParams` → `nextInit(new URLSearchParams(searchParams))`).
  // Aynı olay işleyicisinde iki `ayarla` çağrısı arasında render olmadığı için
  // ikinci çağrı da birincinin yazdığını GÖREMEZ.
  //
  // Bu yüzden "henüz konuma yansımamış yazım" burada tutulur — ve YAZILDIĞI
  // ANDAKİ konumla birlikte. Bekleyen yazım yalnız konum hâlâ o taban
  // üzerindeyken geçerlidir; konum değişmişse (render oldu, geri tuşuna
  // basıldı, başka bir bileşen yazdı) BAYATTIR ve atılır.
  //
  // Zamanlayıcıya/mikro göreve bağlamak yetmez: ilk yazımda öyle yapıldı ve
  // "dışarıdan gelen adres değişimi ezilmez" negatif kontrolü onu KIRDI —
  // senkron bir çağrı dizisinde mikro görev hiç koşmaz ve bayat yazım dışarıda
  // yapılan gezinmeyi geri alırdı.
  const bekleyenRef = useRef<{ taban: string; yazilan: URLSearchParams } | null>(null);

  const ayarla = useCallback(
    (yama: Partial<T>, secenek?: { replace?: boolean }) => {
      const bekleyen =
        bekleyenRef.current?.taban === params.toString() ? bekleyenRef.current : null;
      const ayniOlayda = bekleyen !== null;
      const taban = bekleyen?.yazilan ?? params;

      const oncekiDegerler = coz(taban, anahtarlar, varsayilan);
      const yeni = { ...oncekiDegerler, ...yama } as T;
      // Filtre değişti ve sayfa açıkça verilmediyse: başa dön.
      if (sayfaAnahtari && !(sayfaAnahtari in yama)) {
        yeni[sayfaAnahtari] = varsayilan[sayfaAnahtari];
      }
      const sonraki = yazilmisHali(taban, anahtarlar, varsayilan, yeni);

      bekleyenRef.current = { taban: bekleyen?.taban ?? params.toString(), yazilan: sonraki };

      // Tek kullanıcı hareketi = TEK geçmiş girdisi. Aynı işleyicideki ikinci
      // yazım `push` olsaydı geri tuşu, kullanıcının hiç görmediği ara duruma
      // (ör. "filtre uygulandı ama sayfa henüz sıfırlanmadı") dönerdi.
      setParams(sonraki, {
        replace: ayniOlayda ? true : (secenek?.replace ?? replace),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anahtarlar, params, replace, sayfaAnahtari, setParams, JSON.stringify(varsayilan)]
  );

  const temizle = useCallback(() => ayarla({ ...varsayilan }), [ayarla, varsayilan]);

  const filtreliMi = anahtarlar.some(
    (a) => !filtreDisi.includes(a) && degerler[a] !== varsayilan[a]
  );

  return { degerler, ayarla, temizle, filtreliMi };
}
