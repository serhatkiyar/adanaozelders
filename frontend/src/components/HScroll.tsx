import { useEffect, useRef, useState, type ReactNode } from "react";

import { PlainButton } from "@/components/ui/PlainButton";

/**
 * Yatay tek satır kaydırıcı — vitrin kuşakları (eğitmen / kütüphane kartları).
 *
 * ## Buton yerleşimi (kullanıcı kararı, 7 Eyl 2026)
 *
 * Oklar eskiden kuşağın SOL/SAĞ kenarında, kartların ÜSTÜNE binen beyaz
 * dairelerdi ve sınıra gelince tamamen kayboluyorlardı. Kullanıcı bu görünümü
 * beğenmedi; Airbnb deseni istendi: oklar başlık satırının SAĞ UCUNDA, kartların
 * dışında, küçük ve kenarlıklı; sınıra gelince kaybolmaz **soluklaşır**.
 *
 * Kaybolmak yerine solmanın bir bedeli var ve bilinçli: düğme yerinde kalınca
 * satırın kaydırılabilir olduğu görünür kalır ve üstteki düzen zıplamaz.
 *
 * `baslik` verilmezse (bugün her çağrı yeri veriyor) oklar hiç çizilmez —
 * kartların üstüne binen eski davranış geri gelmez.
 *
 * Nöbetçi: `__guards__/vitrinKaydirma.test.tsx`.
 */
export function HScroll({
  children,
  className = "",
  baslik,
  etiket = "Kuşak",
}: {
  children: ReactNode;
  className?: string;
  /** Başlık satırının SOL tarafı; oklar sağ uca yerleşir. */
  baslik?: ReactNode;
  /** Ok düğmelerinin erişilebilir adında geçen kuşak adı. */
  etiket?: string;
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
    const el = scrollRef.current;
    if (!el) return;
    // Bir "sayfa" = görünen genişlik (eksi bir kart payı), sabit 400px değil:
    // geniş ekranda tek tık yarım kart kaydırıyordu.
    const adim = Math.max(240, el.clientWidth - 80);
    el.scrollBy({ left: dir === "left" ? -adim : adim, behavior: "smooth" });

    // Basılı tutunca sürekli kaydırma korundu — yeri değişti, davranışı değil.
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        scrollRef.current?.scrollBy({ left: dir === "left" ? -15 : 15, behavior: "auto" });
      }, 15);
    }, 400);

    const handleUp = () => {
      stopScroll();
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointerup", handleUp);
  };

  const okSinifi = (aktif: boolean) =>
    `flex h-8 w-8 select-none items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition ${
      aktif
        ? "hover:border-slate-300 hover:bg-slate-50 "
        : "cursor-default text-slate-300 "
    }`;

  // İçerik zaten sığıyorsa okları hiç çizme (iki yön de kapalı = kaydırma yok).
  const kaydirilabilir = canScrollLeft || canScrollRight;

  return (
    <div className="w-full">
      {baslik !== undefined && (
        <div className="mb-4 flex items-center justify-between gap-4">
          {baslik}
          {kaydirilabilir && (
            <div className="flex shrink-0 items-center gap-2">
              <PlainButton
                type="button"
                disabled={!canScrollLeft}
                onPointerDown={() => canScrollLeft && startScroll("left")}
                onPointerUp={stopScroll}
                onPointerLeave={stopScroll}
                className={okSinifi(canScrollLeft)}
                aria-label={`${etiket}: sola kaydır`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </PlainButton>
              <PlainButton
                type="button"
                disabled={!canScrollRight}
                onPointerDown={() => canScrollRight && startScroll("right")}
                onPointerUp={stopScroll}
                onPointerLeave={stopScroll}
                className={okSinifi(canScrollRight)}
                aria-label={`${etiket}: sağa kaydır`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </PlainButton>
            </div>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={checkScroll}
        className={`flex overflow-x-auto scrollbar-hide ${className}`}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {children}
      </div>

      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
