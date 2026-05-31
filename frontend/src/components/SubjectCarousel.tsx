import { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import subjectsData from "./subjects.json";
import { ROUTES } from "@/lib/routes";

export function SubjectCarousel() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

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
  }, []);

  const timeoutRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<number | ReturnType<typeof setInterval> | null>(null);

  const stopScroll = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  // Stop if we hit the boundary (which unmounts the button)
  useEffect(() => {
    if (!canScrollLeft || !canScrollRight) {
      stopScroll();
    }
  }, [canScrollLeft, canScrollRight]);

  // Clean up on unmount
  useEffect(() => {
    return stopScroll;
  }, []);

  const startScroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    
    // Perform standard click scroll first
    scrollRef.current.scrollBy({ left: dir === "left" ? -400 : 400, behavior: "smooth" });

    // If held, start continuous scroll
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollBy({ left: dir === "left" ? -15 : 15, behavior: "auto" });
        }
      }, 15);
    }, 400);

    // Global listener to ensure we stop even if pointer leaves the element
    const handleUp = () => {
      stopScroll();
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div className="relative w-full">
      {/* The Pill Container - Apple Glassmorphism Effect */}
      <div className="relative rounded-full bg-white/60 px-4 py-0.5 shadow-[0_0_20px_rgba(15,23,42,0.08)] ring-1 ring-white border border-slate-100/50 backdrop-blur-xl dark:bg-slate-900/50 dark:shadow-[0_0_20px_rgba(0,0,0,0.3)] dark:ring-white/10 dark:border-transparent">
        
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="flex items-center gap-10 overflow-x-auto scrollbar-hide px-6 py-4"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {subjectsData.map((s) => (
            <Link
              key={s.name}
              to={`${ROUTES.tutors}?subject=${encodeURIComponent(s.name)}`}
              className="group flex flex-col items-center justify-center gap-2 transition-all duration-300 hover:-translate-y-1"
            >
              <div className="relative">
                <img 
                  src={`/icons/subjects/${s.icon}`} 
                  alt={s.name} 
                  className="relative z-10 h-6 w-6 object-contain opacity-80 transition-all duration-300 group-hover:scale-110 group-hover:opacity-100 dark:invert"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "/icons/subjects/default.svg";
                  }}
                />
              </div>
              <span className="whitespace-nowrap text-[13.5px] font-medium text-slate-700 transition-colors duration-300 group-hover:font-bold group-hover:text-indigo-600 dark:text-slate-300 dark:group-hover:text-indigo-400">
                {s.name}
              </span>
            </Link>
          ))}
        </div>

        {/* Right Arrow Button (Floating) */}
        {canScrollRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <button
              type="button"
              onPointerDown={() => startScroll("right")}
              onPointerUp={stopScroll}
              onPointerLeave={stopScroll}
              className="pointer-events-auto flex h-10 w-10 select-none items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 text-slate-800 transition hover:scale-105 hover:bg-slate-50 dark:bg-slate-700 dark:ring-white/10 dark:text-white dark:hover:bg-slate-600"
              aria-label="Sağa kaydır"
            >
              <svg className="h-5 w-5 ml-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {/* Left Arrow Button (Floating) */}
        {canScrollLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2">
            <button
              type="button"
              onPointerDown={() => startScroll("left")}
              onPointerUp={stopScroll}
              onPointerLeave={stopScroll}
              className="pointer-events-auto flex h-10 w-10 select-none items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/5 text-slate-800 transition hover:scale-105 hover:bg-slate-50 dark:bg-slate-700 dark:ring-white/10 dark:text-white dark:hover:bg-slate-600"
              aria-label="Sola kaydır"
            >
              <svg className="h-5 w-5 mr-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        )}

      </div>
      
      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
