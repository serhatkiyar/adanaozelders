import { useEffect } from "react";
import { toast } from "@/store/toastStore";

/**
 * iyzico ödeme sayfasından dönüşte backend callback'inin eklediği
 * `?odeme=basarili|basarisiz` parametresini bir kez bildirime çevirir ve
 * URL'den temizler (yenilemede tekrar göstermesin).
 *
 * Parametre history.replaceState ile SENKRON silinir: StrictMode'da effect iki
 * kez koştuğunda ikinci koşum parametreyi bulamaz → çift bildirim olmaz.
 * (setSearchParams kullanılmıyor; router state'i asenkron güncellediği için
 * ikinci koşum bayat closure'dan parametreyi yeniden okuyordu.)
 */
export function useCheckoutResultToast() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("odeme");
    if (!result) return;
    url.searchParams.delete("odeme");
    window.history.replaceState(window.history.state, "", url.toString());
    if (result === "basarili") {
      toast.success("Ödemen alındı!");
    } else {
      toast.error("Ödeme tamamlanamadı. Tekrar deneyebilirsin.");
    }
  }, []);
}
