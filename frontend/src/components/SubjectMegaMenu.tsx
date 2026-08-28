import { useEffect, useRef, useState } from "react";
import { ScrollableRow } from "@/components/ScrollableRow";
import { EXAMS } from "@/lib/examTree";

interface SubjectMegaMenuProps {
  value: string; // mevcut arama (q)
  onSelect: (q: string) => void;
}

const lower = (s: string) => s.trim().toLocaleLowerCase("tr");

// Koyu gri şerit üzerinde: pasif = beyaz yazı/şeffaf, aktif = beyaz zemin koyu yazı.
const chipClass = (active: boolean) =>
  `inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${
    active
      ? "bg-white text-slate-800 shadow-sm"
      : "text-white/90 hover:bg-white/10"
  }`;

export function SubjectMegaMenu({ value, onSelect }: SubjectMegaMenuProps) {
  const [open, setOpen] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeQ = lower(value);

  // Dışarı tıklayınca kapat (mobil tap akışı için).
  useEffect(() => {
    if (open === null) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (q: string) => {
    onSelect(q);
    setOpen(null);
  };

  return (
    <div ref={rootRef} className="relative" onMouseLeave={() => setOpen(null)}>
      <ScrollableRow showArrows={false} className="px-1 pb-1">
        {EXAMS.map((exam, idx) => (
          <button
            key={exam.label}
            type="button"
            aria-expanded={open === idx}
            onMouseEnter={() => setOpen(idx)}
            onClick={() => setOpen((o) => (o === idx ? null : idx))}
            className={chipClass(open === idx)}
          >
            {exam.label}
          </button>
        ))}
      </ScrollableRow>

      {open !== null && (
        <div className="absolute left-0 right-0 top-full z-30 rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200 ">
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            {EXAMS[open].columns.map((col, ci) => (
              <div key={col.title ?? ci} className="min-w-[140px]">
                {col.title && (
                  <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                    {col.title}
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  {col.items.map((it) => {
                    const isActive = lower(it.q) === activeQ;
                    return (
                      <button
                        key={it.label}
                        type="button"
                        onClick={() => pick(it.q)}
                        className={`rounded-lg px-3 py-1.5 text-left text-sm transition ${
                          isActive
                            ? "bg-indigo-50 font-medium text-indigo-700 "
                            : "text-slate-600 hover:bg-slate-50 "
                        }`}
                      >
                        {it.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
