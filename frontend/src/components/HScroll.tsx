import { useEffect, useRef, useState, type ReactNode } from "react";

import { PlainButton } from "@/components/ui/PlainButton";

// Yatay tek satır kaydırıcı: kategori çubuğundaki gibi kenarlarda beliren
// (sınıra gelince gizlenen) ok butonları + basılı tutunca sürekli kaydırma.
export function HScroll({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(Math.ceil(scrollLeft + clientWidth) < scrollWidth);
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
    // children değişince (örn. liste güncellenince) tekrar ölç.
  }, [children]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopScroll = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  useEffect(() => {
    if (!canScrollLeft || !canScrollRight) stopScroll();
  }, [canScrollLeft, canScrollRight]);

  useEffect(() => stopScroll, []);

  const startScroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir === "left" ? -400 : 400, behavior: "smooth" });

    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollBy({ left: dir === "left" ? -15 : 15, behavior: "auto" });
        }
      }, 15);
    }, 400);

    const handleUp = () => {
      stopScroll();
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div className="relative w-full">
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        className={`flex overflow-x-auto scrollbar-hide ${className}`}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {children}
      </div>

      {canScrollRight && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1">
          <PlainButton
            type="button"
            onPointerDown={() => startScroll("right")}
            onPointerUp={stopScroll}
            onPointerLeave={stopScroll}
            className="pointer-events-auto flex h-10 w-10 select-none items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 text-slate-800 transition hover:scale-105 hover:bg-slate-50 "
            aria-label="Sağa kaydır"
          >
            <svg className="h-5 w-5 ml-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </PlainButton>
        </div>
      )}

      {canScrollLeft && (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1">
          <PlainButton
            type="button"
            onPointerDown={() => startScroll("left")}
            onPointerUp={stopScroll}
            onPointerLeave={stopScroll}
            className="pointer-events-auto flex h-10 w-10 select-none items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 text-slate-800 transition hover:scale-105 hover:bg-slate-50 "
            aria-label="Sola kaydır"
          >
            <svg className="h-5 w-5 mr-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </PlainButton>
        </div>
      )}

      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
