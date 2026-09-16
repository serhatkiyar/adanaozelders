import { useEffect } from "react";

import { useKonumStore } from "@/store/konumStore";

/**
 * Adreste `yakinimda=1` varsa tarayıcıdan konumu İSTER.
 *
 * ## Neden var (ölçülmüş kusur, 16 Eyl 2026)
 *
 * "Yakınımda" niyeti adrese yazılıyordu (telefonun adımlı yüzeyi, paylaşılan
 * bağlantı) ama koordinatı yalnız filtre penceresi istiyordu — o da yalnız
 * kendi içindeki yarıçap seçilince. Adımlı yüzeyden "Yakınımda" seçen
 * kullanıcı için `konumStore.iste` HİÇ çağrılmıyordu; `egitmenIstegi` konum
 * olmadan bayrağı yok sayar, liste "Tüm Adana" dönüyordu. Sessiz kusur.
 *
 * Kural tek yerde: bayrak açık + konum yok + istek sürmüyor → iste. İzin
 * reddedilirse `iptal` bayrağı adresten düşürür ki filtre açıkmış gibi
 * görünmesin (aynı sözleşme `EgitmenFiltreModali`de).
 */
export function useYakinimdaKonum(yakinimda: boolean, iptal: () => void): void {
  const konum = useKonumStore((s) => s.konum);
  const yukleniyor = useKonumStore((s) => s.yukleniyor);
  const iste = useKonumStore((s) => s.iste);
  useEffect(() => {
    if (yakinimda && !konum && !yukleniyor) iste(iptal);
    // `iptal` her render'da yeni fonksiyon; bağımlılığa alınırsa istek
    // yinelenir. Bayrak/konum/yükleniyor üçlüsü yeterli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yakinimda, konum, yukleniyor]);
}
