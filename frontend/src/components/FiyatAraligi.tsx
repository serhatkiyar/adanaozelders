import { useEffect, useMemo, useState } from "react";

import { PriceRangeHistogram } from "@/components/PriceRangeHistogram";
import { useTutorPriceHistogram } from "@/hooks/useTutorSearch";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import { EGITMEN_ARAMA, egitmenIstegi } from "@/lib/aramaUrl";
import { useKonumStore } from "@/store/konumStore";

/**
 * Eğitmen FİYAT ARALIĞI bölümü — filtre penceresi ve şeritteki "Fiyat ⌄"
 * açılırının ORTAK gövdesi (kullanıcı kararı, 16 Eyl 2026). İki yüzey aynı
 * histogramı, aynı kutuları, aynı adres alanlarını kullanır; ayrışamazlar.
 *
 * Prop almaz: paylaşılan durum adrestir (`EGITMEN_ARAMA`). Kutunun anlık
 * metni YEREL, değeri adreste — her sürüklemede adres yazmak geçmişi
 * kirletirdi (`replace: true`).
 */

/** Kutu metni ↔ şema değeri: boş kutu = filtre YOK, "0" geçerli alt sınır. */
export const sayiMetni = (n: number | undefined) => (n === undefined ? "" : String(n));
export const metinSayisi = (t: string): number | undefined => {
  const kirpik = t.trim();
  if (!kirpik) return undefined;
  const n = Number(kirpik);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * Histogram ve fasetler, SONUÇ LİSTESİYLE AYNI kümeyi ölçmeli — yoksa
 * çubuklar listede olmayan eğitmenleri sayar. Küme elle ikinci kez
 * kurulmuyor, listenin isteğinden ÇIKARILARAK türetiliyor.
 */
export function useHistogramParametreleri() {
  const { degerler } = useAramaDurumu(EGITMEN_ARAMA);
  const konum = useKonumStore((s) => s.konum);
  const istek = useMemo(() => egitmenIstegi(degerler, { konumum: konum }), [degerler, konum]);
  return useMemo(() => {
    const {
      sort: _sort,
      exam: _exam,
      limit: _limit,
      offset: _offset,
      min_rate: _min,
      max_rate: _max,
      ...rest
    } = istek;
    return rest;
  }, [istek]);
}

export function FiyatAraligi({ acik }: { acik: boolean }) {
  const { degerler, ayarla } = useAramaDurumu(EGITMEN_ARAMA);
  const [minRate, setMinRate] = useState(sayiMetni(degerler.minFiyat));
  const [maxRate, setMaxRate] = useState(sayiMetni(degerler.maxFiyat));

  // Adres → kutu (geri tuşu, paylaşılan bağlantı, "Temizle").
  useEffect(() => {
    setMinRate((o) => (metinSayisi(o) === degerler.minFiyat ? o : sayiMetni(degerler.minFiyat)));
    setMaxRate((o) => (metinSayisi(o) === degerler.maxFiyat ? o : sayiMetni(degerler.maxFiyat)));
  }, [degerler.minFiyat, degerler.maxFiyat]);

  const histParams = useHistogramParametreleri();
  const { data: rateDist, isLoading } = useTutorPriceHistogram(histParams, acik);

  return (
    <PriceRangeHistogram
      rates={rateDist ?? []}
      loading={isLoading}
      minRate={minRate}
      maxRate={maxRate}
      onChange={(mn, mx) => {
        setMinRate(mn);
        setMaxRate(mx);
        ayarla({ minFiyat: metinSayisi(mn), maxFiyat: metinSayisi(mx) }, { replace: true });
      }}
    />
  );
}
