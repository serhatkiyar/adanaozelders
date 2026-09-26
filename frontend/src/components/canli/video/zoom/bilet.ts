/**
 * `/canli-ders-bileti` içindeki `zoom` bileti → nötr bilet. SDK import ETMEZ (sayfanın ana
 * parçasında da kullanılır). Eğitmen Zoom'da `host`tur.
 */
import type { ZoomDersTokenOut } from "@/types";

import type { NotrBilet } from "../tipler";

export function zoomBiletiniCevir(b: ZoomDersTokenOut): NotrBilet {
  return {
    saglayici: "zoom",
    rol: b.rol === "host" ? "ogretmen" : "ogrenci",
    ad: b.kullanici_adi,
    bitis: b.expires_at,
    karsi: null,
    ham: b,
  };
}
