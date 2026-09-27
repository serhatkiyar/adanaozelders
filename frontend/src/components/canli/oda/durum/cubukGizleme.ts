/**
 * Odak modunda kontrol çubuğunun kendiliğinden gizlenmesi.
 *
 * - 3 sn etkileşimsizlikte gizlenir (çubuğun üstünde fare ya da içinde odak
 *   varken gizlenmez: açık menü/çekmece de böyle korunur).
 * - Fare pencerenin alt kenarına (ince şerit) gelince, dokununca ya da klavye
 *   odağı çubuğa girince döner. Gizliyken de DOM'da ve odaklanabilir kalır
 *   (Tab ile ulaşılır). Şerit ince: tahtanın alt araçlarına ve paylaşım
 *   yakınlaştırma çubuğuna uzanan fare çubuğu açıp onları örtmesin.
 * - Tahtaya dokunmak (her çizgi bir dokunuştur) çubuğu açmaz; yalnız alt
 *   kenar şeridindeki ya da tahta dışındaki dokunuş açar. `data-cubugu-acmaz`
 *   işaretli öğeye (paylaşım yakınlaştırma çubuğu) dokunmak hiç açmaz.
 * - Çubuktaki açık menü/çekmece (`role="dialog"`) varken gizlenmez.
 * - İşaretçi dinleyicileri `window` üzerinde YAKALAMA evresinde: Excalidraw
 *   tuvali kabarcıklanan olayları yutabilir.
 */
import { useEffect, useState, type RefObject } from "react";

/** Etkileşimsizlikten sonra gizlenme süresi. */
export const CUBUK_GIZLEME_MS = 3000;
/** Fare pencerenin altına bu kadar yaklaşınca çubuk döner. */
export const ALT_KENAR_PX = 8;
/** Tahtada bu alt şeritteki dokunuş çubuğu açar. */
export const ALT_KENAR_DOKUNMA_PX = 32;

export function useCubukGizleme(aktif: boolean, kap: RefObject<HTMLElement | null>): boolean {
  const [gizli, setGizli] = useState(false);

  useEffect(() => {
    if (!aktif) return;
    let zamanlayici: number | undefined;
    let fareIcinde = false;
    let odakIcinde = Boolean(kap.current?.contains(document.activeElement));

    const zamanla = () => {
      window.clearTimeout(zamanlayici);
      if (fareIcinde || odakIcinde) return;
      zamanlayici = window.setTimeout(() => {
        // Açık menü/çekmece varken gizlenmez (odak içeride olmasa da).
        if (kap.current?.querySelector('[role="dialog"]')) zamanla();
        else setGizli(true);
      }, CUBUK_GIZLEME_MS);
    };
    const goster = () => {
      setGizli(false);
      zamanla();
    };
    const icindeMi = (hedef: EventTarget | null) =>
      hedef instanceof Node && Boolean(kap.current?.contains(hedef));

    const hareket = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      fareIcinde = icindeMi(e.target);
      if (fareIcinde || e.clientY >= window.innerHeight - ALT_KENAR_PX) goster();
    };
    const basma = (e: PointerEvent) => {
      const dokunma = e.pointerType === "touch";
      fareIcinde = !dokunma && icindeMi(e.target);
      // Sahnedeki kendi araç çubukları (paylaşım yakınlaştırma) çubuğu açmaz:
      // açılan çubuk bir sonraki dokunuşu yutmasın.
      if (e.target instanceof Element && e.target.closest("[data-cubugu-acmaz]")) return;
      const tahtada = e.target instanceof Element && e.target.closest("[data-tahta-alani]") !== null;
      const altKenar = e.clientY >= window.innerHeight - ALT_KENAR_DOKUNMA_PX;
      if ((dokunma && (!tahtada || altKenar)) || fareIcinde) goster();
    };
    const odakGirdi = () => {
      odakIcinde = true;
      window.clearTimeout(zamanlayici);
      setGizli(false);
    };
    const odakCikti = (e: FocusEvent) => {
      odakIcinde = icindeMi(e.relatedTarget);
      if (!odakIcinde) zamanla();
    };

    const el = kap.current;
    zamanla();
    window.addEventListener("pointermove", hareket, true);
    window.addEventListener("pointerdown", basma, true);
    el?.addEventListener("focusin", odakGirdi);
    el?.addEventListener("focusout", odakCikti);
    return () => {
      window.clearTimeout(zamanlayici);
      // Yeniden odağa girilince çubuk görünür başlar.
      setGizli(false);
      window.removeEventListener("pointermove", hareket, true);
      window.removeEventListener("pointerdown", basma, true);
      el?.removeEventListener("focusin", odakGirdi);
      el?.removeEventListener("focusout", odakCikti);
    };
  }, [aktif, kap]);

  return aktif && gizli;
}
