import { useEffect, useRef, useState } from "react";

export interface KebabAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: React.ReactNode;
}

/**
 * Yeniden kullanılabilir 3-nokta (dikey) menü — yuvarlak tetikleyici + açılır liste.
 * Headless dropdown deseni (state + ref + dışına-tıkla kapanma). Sakin/indigo.
 */
export function KebabMenu({
  actions,
  label = "Seçenekler",
  align = "right",
}: {
  actions: KebabAction[];
  label?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-marka "
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full z-30 mt-1.5 w-48 overflow-hidden rounded-xl bg-white py-1 shadow-xl ring-1 ring-slate-200 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                a.onClick();
              }}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors ${
                a.danger
                  ? "text-rose-600 hover:bg-rose-50 "
                  : "text-slate-700 hover:bg-slate-50 "
              }`}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
