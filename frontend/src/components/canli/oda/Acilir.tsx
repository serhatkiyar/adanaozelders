/**
 * Kontrol çubuğunun üstüne açılan koyu kutu — Meet `Popover variant="dark"`
 * (La Suite Meet, MIT — DINUM/Etalab). react-aria yerine elle: Esc ve dış
 * tıklama kapatır, açılınca ilk odaklanabilir öğeye geçer, kapanınca odak
 * açan düğmeye döner (Meet `useEscapeToClose` / `useRestoreFocus` deseni).
 *
 * Kutu, tetikleyiciyle aynı `relative` sarmalayıcıda mutlak konumlanır.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

export function Acilir({
  acik,
  onKapat,
  tetikleyici,
  etiket,
  hiza = "orta",
  children,
}: {
  acik: boolean;
  onKapat: () => void;
  tetikleyici: RefObject<HTMLElement | null>;
  etiket: string;
  /** Kutunun tetikleyiciye göre yatay hizası. */
  hiza?: "orta" | "sol" | "sag";
  children: ReactNode;
}) {
  const kutu = useRef<HTMLDivElement>(null);
  const kapat = useRef(onKapat);
  kapat.current = onKapat;

  useEffect(() => {
    if (!acik) return;
    const geri = tetikleyici.current;
    kutu.current
      ?.querySelector<HTMLElement>("select, button:not([disabled]), [href], input")
      ?.focus();
    const tus = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        kapat.current();
      }
    };
    const disTiklama = (e: PointerEvent) => {
      const hedef = e.target as Node | null;
      if (!hedef) return;
      if (kutu.current?.contains(hedef) || tetikleyici.current?.contains(hedef)) return;
      kapat.current();
    };
    document.addEventListener("keydown", tus);
    document.addEventListener("pointerdown", disTiklama);
    return () => {
      document.removeEventListener("keydown", tus);
      document.removeEventListener("pointerdown", disTiklama);
      // Odak kutunun içindeyse (ya da sayfaya düştüyse) açan düğmeye döner.
      const etkin = document.activeElement;
      if (!etkin || etkin === document.body || kutu.current?.contains(etkin)) geri?.focus();
    };
  }, [acik, tetikleyici]);

  if (!acik) return null;
  const konum =
    hiza === "sol" ? "left-0" : hiza === "sag" ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <div
      ref={kutu}
      role="dialog"
      aria-label={etiket}
      className={`absolute bottom-full z-40 mb-2 w-max max-w-[min(36rem,calc(100vw-2rem))] rounded-ders border border-ders-cizgi bg-ders-yuzey p-2 text-white shadow-2xl ${konum}`}
    >
      {children}
    </div>
  );
}
