/**
 * Sağlayıcının sürücüsünü tembel yükler: SDK yalnız seçilen sağlayıcının
 * parçasına girer. Sağlayıcı adı sunucunun biletinden gelir (`NotrBilet.saglayici`).
 */
import type { SaglayiciAdi, VideoSurucusu } from "./tipler";

export async function yukle(ad: SaglayiciAdi): Promise<VideoSurucusu> {
  switch (ad) {
    case "zoom":
      return (await import("./zoom/surucu")).zoomSurucusu;
    case "agora":
      return (await import("./agora/surucu")).agoraSurucusu;
    default: {
      const bilinmeyen: never = ad;
      throw new Error(`Bilinmeyen görüntülü ders sağlayıcısı: ${String(bilinmeyen)}`);
    }
  }
}
