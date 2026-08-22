import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * ── Üst başlıktaki birincil aksiyon yuvası (İP-B2 · tasarım dili §4.2) ──
 *
 * İP-B1 bu yuvayı `AdminPageHeader`da BOŞ olarak açmış ve gerekçesini
 * yazmıştı: "B2'nin liste sayfası anatomisini yazarken 'Yeni ürün' düğmesini
 * nereye koyacağını bu belgede bulması; her ekranda AYNI yerde." Bugün her
 * ekran onu kendi içeriğinin farklı bir yerine koyuyor.
 *
 * ## Neden context + state DEĞİL, portal
 *
 * İlk akla gelen çözüm bir context'ti: ekran `ayarla(<Button/>)` çağırır,
 * başlık onu render eder. Yazılıp bırakılmadı çünkü SONSUZ DÖNGÜ üretiyor:
 * `children` her render'da yeni bir element kimliği alır, efekt her render'da
 * koşar, `setState` yeni bir render tetikler. Kaçınmak için `children`ı
 * `useMemo`ya sarmak gerekirdi — yani her çağrı yerinde unutulabilecek bir
 * kural daha.
 *
 * Portal'da böyle bir durum yok: React ağacı ekranın altında kalır (context,
 * React Query, router hepsi çalışır), DOM düğümü başlığın içine düşer.
 *
 * ## Yuva yoksa ne olur — bilinçli düşüş
 *
 * Ekran kabuk OLMADAN da render edilebiliyor: çalışma zamanı kapısı 88 ekranı
 * propsuz mount ediyor, kabul testleri `AdminStore`u doğrudan basıyor. Böyle
 * bir durumda portal hedefi yoktur ve aksiyon **satır içinde** çizilir.
 * Alternatif (hiç çizmemek) daha kötüydü: "Yeni ürün" düğmesi kabuk dışında
 * sessizce kaybolur ve bunu ancak bir kullanıcı fark ederdi.
 */
export const BASLIK_AKSIYON_ID = "panel-baslik-aksiyonu";

export function PanelBaslikAksiyonu({ children }: { children: ReactNode }) {
  const [hedef, setHedef] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Efektte aranır, render sırasında değil: başlık bu ekranla AYNI commit'te
    // monte oluyor ve render anında DOM'da henüz bulunmayabilir.
    setHedef(document.getElementById(BASLIK_AKSIYON_ID));
  }, []);

  if (!hedef) return <>{children}</>;
  return createPortal(children, hedef);
}
