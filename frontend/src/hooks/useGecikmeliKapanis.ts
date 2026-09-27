import { useEffect, useState } from "react";

/**
 * `true` hemen, `false` ancak `ms` boyunca kesintisiz sürerse yansır.
 * Hızlı kapat/aç (ör. kamera kutusunu küçült-aç) medya kaynağını her
 * seferinde durdurup yeniden başlatmasın.
 */
export function useGecikmeliKapanis(deger: boolean, ms = 1000): boolean {
  const [gecikmeli, setGecikmeli] = useState(deger);

  useEffect(() => {
    const id = setTimeout(() => setGecikmeli(deger), deger ? 0 : ms);
    return () => clearTimeout(id);
  }, [deger, ms]);

  return deger || gecikmeli;
}
