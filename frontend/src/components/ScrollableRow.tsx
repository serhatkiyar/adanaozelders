import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { DaireDugme } from "@/components/ui/DaireDugme";

interface ScrollableRowProps {
  children: ReactNode;
  className?: string;
  showArrows?: boolean;
}

// W3Schools tarzı yatay kaydırılabilir şerit:
// - sm+ ekranlarda yalnızca taşma varken görünen ok butonları (ui/DaireDugme)
// - fare ile sürükle-kaydır (mobilde native swipe kullanılır)
// - gizli scrollbar
export function ScrollableRow({
  children,
  className,
  showArrows = true,
}: ScrollableRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useLayoutEffect(update, [update, children]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  const scrollByDir = (dir: number) =>
    ref.current?.scrollBy({ left: dir * 260, behavior: "smooth" });

  // Fare ile sürükleme (yalnız pointerType === "mouse"; dokunmada native scroll çalışır).
  const drag = useRef({ active: false, startX: 0, startLeft: 0, moved: false });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    drag.current = {
      active: true,
      startX: e.clientX,
      startLeft: el.scrollLeft,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !drag.current.active) return;
    const el = ref.current;
    if (!el) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 3) drag.current.moved = true;
    el.scrollLeft = drag.current.startLeft - dx;
  };

  const endDrag = () => {
    drag.current.active = false;
  };

  // Sürükleme sonrası istenmeyen tıklamayı engelle (örn. çip seçimi).
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  };

  // Yerleşim burada (kenarda, üste binen), GÖRÜNÜM `ui/DaireDugme`de.
  // Eskiden burada da ayrı bir stil (beyaz + gölge + halka) ve ikon yerine
  // ham bir ok KARAKTERİ vardı — sitedeki üçüncü dairesel düğme yazımıydı.
  const yerlesim = "absolute top-1/2 z-10 hidden -translate-y-1/2 shadow-md sm:inline-flex";

  return (
    <div className="relative">
      {showArrows && canLeft && (
        <DaireDugme
          yon="sol"
          aria-label="Sola kaydır"
          onClick={() => scrollByDir(-1)}
          className={`${yerlesim} left-1`}
        />
      )}

      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={onClickCapture}
        style={{ touchAction: "pan-x", scrollbarWidth: "none" }}
        className={`flex select-none gap-2 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${
          className ?? ""
        }`}
      >
        {children}
      </div>

      {showArrows && canRight && (
        <DaireDugme
          yon="sag"
          aria-label="Sağa kaydır"
          onClick={() => scrollByDir(1)}
          className={`${yerlesim} right-1`}
        />
      )}
    </div>
  );
}
