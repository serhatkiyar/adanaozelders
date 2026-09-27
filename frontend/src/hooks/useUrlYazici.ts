import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * URL'e durum yazan iki hook'un ORTAK ÇEKİRDEĞİ.
 *
 * `useUrlDurumu` (skaler anahtarlar, admin listeleri) ve `useAramaDurumu`
 * (arama şemaları) aynı üç kararı vermek zorunda:
 *
 *   1. varsayılana eşit değer URL'e yazılmaz,
 *   2. filtre değişince sayfa anahtarı sıfırlanır,
 *   3. aynı olaydaki ikinci yazım birincinin üstüne biner.
 *
 * Üçüncüsü bu depoda ÖLÇÜLMÜŞ bir react-router davranışının çözümüdür
 * (aşağıda). İki hook'a ayrı ayrı kopyalansaydı biri düzeltilip diğeri
 * unutulurdu — bu görevin çözmeye çalıştığı hastalığın ta kendisi. O yüzden
 * blok burada TEK kez yaşar; iki hook yalnız kendi `oku`/`yaz` çiftini verir.
 */
export interface UrlYaziciSecenekleri<T> {
  /** URL → değer. */
  oku: (sp: URLSearchParams) => T;
  /** Değer → URL. `taban` verilir ki şemanın tanımadığı anahtarlar korunsun. */
  yaz: (deger: T, taban: URLSearchParams) => URLSearchParams;
  /**
   * Sayfa anahtarı ve varsayılanı. Yamada açıkça verilmediyse sıfırlanır:
   * 3. sayfada filtre daraltıp boş ekran görmek gerçek bir kullanıcı
   * hatası kaynağı.
   */
  sayfaAnahtari?: (keyof T & string) | null;
  sayfaVarsayilani?: T[keyof T & string];
  /** Adres geçmişine yazma biçimi (varsayılan `push` — geri tuşu çalışsın). */
  replace?: boolean;
}

export interface UrlYazici<T> {
  degerler: T;
  ayarla: (yama: Partial<T>, secenek?: { replace?: boolean }) => void;
  /** Ham parametreler — sayfalama yardımcıları gibi kenar durumlar için. */
  params: URLSearchParams;
}

export function useUrlYazici<T>({
  oku,
  yaz,
  sayfaAnahtari = null,
  sayfaVarsayilani,
  replace = false,
}: UrlYaziciSecenekleri<T>): UrlYazici<T> {
  const [params, setParams] = useSearchParams();

  const degerler = useMemo(
    () => oku(params),
    // `oku` çağıran tarafta sabit (modül düzeyi şema); kimliği değil sonucu
    // önemli olduğu için bağımlılık params'tır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params]
  );

  /*
   * ── Aynı olaydaki İKİNCİ yazım (İP-A6c · BULGU-4) ──
   *
   * `setParams`ın fonksiyonel biçimi bu router sürümünde YETMEZ ve bu ölçüldü
   * (`docs/arsiv/ip-a/ip-a6c/g2-yalniz-fonksiyonel.txt`): react-router 7.18.1 geri
   * çağrıya canlı bir ref değil, RENDER SIRASINDA kapatılmış `searchParams`ı
   * geçirir. Aynı olay işleyicisinde iki `ayarla` çağrısı arasında render
   * olmadığı için ikinci çağrı da birincinin yazdığını GÖREMEZ.
   *
   * Bu yüzden "henüz konuma yansımamış yazım" burada tutulur — ve YAZILDIĞI
   * ANDAKİ konumla birlikte. Bekleyen yazım yalnız konum hâlâ o taban
   * üzerindeyken geçerlidir; konum değişmişse (render oldu, geri tuşuna
   * basıldı, başka bir bileşen yazdı) BAYATTIR ve atılır.
   *
   * Zamanlayıcıya/mikro göreve bağlamak yetmez: ilk yazımda öyle yapıldı ve
   * "dışarıdan gelen adres değişimi ezilmez" negatif kontrolü onu KIRDI —
   * senkron bir çağrı dizisinde mikro görev hiç koşmaz ve bayat yazım
   * dışarıda yapılan gezinmeyi geri alırdı.
   */
  const bekleyenRef = useRef<{ taban: string; yazilan: URLSearchParams } | null>(null);
  // Konum bir kez yansıdıysa (render oldu) bekleyen yazım görevini bitirmiştir.
  // Yalnız taban karşılaştırması YETMEZ: geri tuşuyla aynı tabana dönülünce
  // eski bekleyen "hâlâ geçerli" sanılır ve sonraki yazım (ör. sayfa boyutu)
  // geri alınmış filtreyi adrese geri diriltirdi.
  useEffect(() => {
    bekleyenRef.current = null;
  }, [params]);

  const ayarla = useCallback(
    (yama: Partial<T>, secenek?: { replace?: boolean }) => {
      const bekleyen =
        bekleyenRef.current?.taban === params.toString() ? bekleyenRef.current : null;
      const ayniOlayda = bekleyen !== null;
      const taban = bekleyen?.yazilan ?? params;

      const yeni = { ...oku(taban), ...yama } as T;
      // Filtre değişti ve sayfa açıkça verilmediyse: başa dön.
      if (sayfaAnahtari && !(sayfaAnahtari in yama) && sayfaVarsayilani !== undefined) {
        yeni[sayfaAnahtari] = sayfaVarsayilani as T[keyof T & string];
      }
      const sonraki = yaz(yeni, taban);

      bekleyenRef.current = { taban: bekleyen?.taban ?? params.toString(), yazilan: sonraki };

      // Tek kullanıcı hareketi = TEK geçmiş girdisi. Aynı işleyicideki ikinci
      // yazım `push` olsaydı geri tuşu, kullanıcının hiç görmediği ara duruma
      // dönerdi.
      setParams(sonraki, {
        replace: ayniOlayda ? true : (secenek?.replace ?? replace),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, replace, sayfaAnahtari, sayfaVarsayilani, setParams]
  );

  return { degerler, ayarla, params };
}
