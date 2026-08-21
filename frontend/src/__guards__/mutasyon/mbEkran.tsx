/**
 * M-B mutasyonunun "ölçülen ekran"ı (İP-A6b · Görev 1 · BULGU-2).
 *
 * Ölçüm tabanındaki bir panel ekranını temsil eder: kendisi ölçülür ve
 * borcunu ölçüm ağacının DIŞINDAKİ bir bileşene devreder. Bugünkü taban
 * kuralı (dizin yürüyüşü) bu devri göremez; import grafiği görmek zorundadır.
 */
import { Denetim2Kacak } from "./denetim2Kacak";

export function MbEkran() {
  return <Denetim2Kacak acik={false} />;
}
