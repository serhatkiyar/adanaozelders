/**
 * `/canli-ders-bileti` Agora bileti → nötr bilet. SDK import ETMEZ (sayfanın
 * ana parçasında da kullanılır). Karşı taraf sunucudan (`karsi.uid`): Agora
 * kimliği kararlıdır, uzak kullanıcı uid'inden tanınır.
 */
import type { AgoraDersTokenOut } from "@/types";

import type { NotrBilet } from "../tipler";

export function agoraBiletiniCevir(b: AgoraDersTokenOut): NotrBilet {
  return {
    saglayici: "agora",
    rol: b.rol,
    ad: b.ad,
    bitis: b.expires_at,
    karsi: b.karsi ? { id: b.karsi.uid, ad: b.karsi.ad, rol: b.karsi.rol } : null,
    ham: b,
  };
}
