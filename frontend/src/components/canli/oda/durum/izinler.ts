/**
 * Tarayıcı izin durumu (`navigator.permissions`) → depo. Desteği düzensiz
 * (Firefox/Safari ad tanımayabilir): hata durumu "bilinmiyor" bırakır.
 * Sağlayıcıdan bağımsız: sürücü izin olayı yaymaz.
 */
import { izinDegisti } from "./indirgeyiciler";
import { depoyaUygula } from "./odaDeposu";

export function izinleriIzle(): () => void {
  const sokumler: Array<() => void> = [];
  let gecerli = true;
  const izle = async (ad: "camera" | "microphone") => {
    try {
      const durum = await navigator.permissions.query({ name: ad as PermissionName });
      if (!gecerli) return;
      const yaz = () => depoyaUygula((d) => izinDegisti(d, { name: ad, state: durum.state }));
      yaz();
      durum.addEventListener("change", yaz);
      sokumler.push(() => durum.removeEventListener("change", yaz));
    } catch {
      // desteklenmiyor
    }
  };
  void izle("camera");
  void izle("microphone");
  return () => {
    gecerli = false;
    for (const sok of sokumler) sok();
  };
}
