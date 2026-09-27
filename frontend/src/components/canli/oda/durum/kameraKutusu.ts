/**
 * Yüzen kamera kutusunun reaktif durumu (zustand).
 *
 * `odaDeposu`na KONMAZ: `depoyuSifirla` oda kapanınca her şeyi siler, bu
 * tercihler ise cihazda kalıcıdır. Köşe (masaüstü/telefon ayrı), boyut ve
 * "kendi görüntümü gizle" `localStorage`a yazılır; küçültülmüş hal yalnız
 * bellekte tutulur (sayfa yenilenince kutu yeniden açılır).
 */
import { create } from "zustand";

import {
  kutuTercihiOku,
  kutuTercihiYaz,
  type Boyut,
  type Kose,
  type KutuTercihi,
} from "@/lib/kameraKutusu";

interface KameraKutusuDurumu extends KutuTercihi {
  kucuk: boolean;
  koseAyarla: (telefon: boolean, kose: Kose | null) => void;
  boyutAyarla: (boyut: Boyut) => void;
  kendiGizliAyarla: (gizli: boolean) => void;
  kucukAyarla: (kucuk: boolean) => void;
}

const kalici = (d: KutuTercihi): KutuTercihi => ({
  koseMasaustu: d.koseMasaustu,
  koseTelefon: d.koseTelefon,
  boyut: d.boyut,
  kendiGizli: d.kendiGizli,
});

export const useKameraKutusu = create<KameraKutusuDurumu>()((set, get) => {
  const yaz = (kismi: Partial<KutuTercihi>) => {
    set(kismi);
    kutuTercihiYaz(kalici(get()));
  };
  return {
    ...kutuTercihiOku(),
    kucuk: false,
    koseAyarla: (telefon, kose) => yaz(telefon ? { koseTelefon: kose } : { koseMasaustu: kose }),
    boyutAyarla: (boyut) => yaz({ boyut }),
    kendiGizliAyarla: (kendiGizli) => yaz({ kendiGizli }),
    kucukAyarla: (kucuk) => set({ kucuk }),
  };
});
