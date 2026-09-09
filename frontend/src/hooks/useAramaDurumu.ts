import { useCallback, useMemo } from "react";

import { aramayiOku, aramayiYaz, filtreliMi, type Sema } from "@/lib/urlSemasi";
import { useUrlYazici } from "@/hooks/useUrlYazici";

/**
 * Arama şemasının URL'deki hâli — okuma + yazma tek çağrıda.
 *
 * ## Neden var
 *
 * Dört liste sayfası (eğitmen ×2, kütüphane, mağaza) URL↔state senkronunu
 * ELLE yazıyordu ve her biri aynı üç kararı yeniden veriyordu. İkisi aynı
 * hatayı yapmıştı: efekt URL'i `new URLSearchParams()` ile SIFIRDAN kuruyor,
 * dolayısıyla kendi okuduğu `?sayfa=` parametresini siliyordu. `?sayfa=3`
 * bağlantısı karşı tarafta 1. sayfaya düşüyordu — hata yok, sessiz kayıp.
 *
 * Burada URL taban olarak korunur (`aramayiYaz(..., taban)`), yani şemanın
 * tanımadığı hiçbir anahtar (`utm_*`, gelecekteki A/B) kaybolmaz.
 *
 * ## Kullanım
 *
 *     const { degerler, ayarla, filtreli } = useAramaDurumu(KUTUPHANE_ARAMA);
 *     ayarla({ q: "merkez" }, { replace: true });   // metin: geçmişi kirletme
 *     ayarla({ konum });                            // ayrık filtre: push
 */
export function useAramaDurumu<T>(sema: Sema<T>) {
  const oku = useCallback((sp: URLSearchParams) => aramayiOku(sema, sp), [sema]);
  const yaz = useCallback(
    (deger: T, taban: URLSearchParams) => aramayiYaz(sema, deger, taban),
    [sema]
  );

  // Sayfa alanı her şemada `filtreDisi`dir; sıfırlama kuralı da ondan türer.
  const sayfaAnahtari = (sema.filtreDisi?.[0] ?? null) as (keyof T & string) | null;
  const sayfaVarsayilani = sayfaAnahtari
    ? sema.alanlar[sayfaAnahtari].varsayilan
    : undefined;

  const { degerler, ayarla, params } = useUrlYazici<T>({
    oku,
    yaz,
    sayfaAnahtari,
    sayfaVarsayilani,
  });

  const filtreli = useMemo(() => filtreliMi(sema, degerler), [sema, degerler]);

  return { degerler, ayarla, filtreli, params };
}
