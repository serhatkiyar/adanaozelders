import React from "react";

interface StarRatingProps {
  // 0-5 arası ortalama; null ise boş yıldız.
  value: number | null | undefined;
  single?: boolean;
  /** Yıldız kenar uzunluğu (px). Varsayılan 16. */
  size?: number;
}

const STAR_PATH = "M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z";
const GAP = 2; // yıldızlar arası boşluk (px)

function StarRow({ size, colorClass }: { size: number; colorClass: string }) {
  return (
    <div className="flex" style={{ gap: GAP }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg
          key={i}
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`shrink-0 ${colorClass}`}
          style={{ width: size, height: size }}
        >
          <path d={STAR_PATH} />
        </svg>
      ))}
    </div>
  );
}

export function StarRating({ value, single, size = 16 }: StarRatingProps) {
  const uniqueId = React.useId();

  if (single) {
    const safeValue = Math.max(0, Math.min(5, value ?? 0));
    const percent = (safeValue / 5) * 100;

    // Yüzde 100 veya 0 ise gradient kullanmaya gerek yok
    if (percent === 100 || percent === 0) {
      return (
        <div className="flex items-center gap-0.5" aria-label={`${safeValue} / 5`}>
          <svg
            viewBox="0 0 20 20"
            className={percent === 100 ? "text-amber-400" : "text-slate-300"}
            style={{ width: size, height: size }}
            fill="currentColor"
          >
            <path d={STAR_PATH} />
          </svg>
        </div>
      );
    }

    const gradId = `single-star-grad-${uniqueId}`;

    return (
      <div className="flex items-center gap-0.5" aria-label={`${safeValue} / 5`}>
        <svg viewBox="0 0 20 20" className="text-amber-400" style={{ width: size, height: size }} fill="currentColor">
          <defs>
            <linearGradient id={gradId}>
              <stop offset={`${percent}%`} stopColor="currentColor" />
              <stop offset={`${percent}%`} stopColor="#cbd5e1" /> {/* slate-300 */}
            </linearGradient>
          </defs>
          <path fill={`url(#${gradId})`} d={STAR_PATH} />
        </svg>
      </div>
    );
  }

  // 5 yıldız — Trendyol/Amazon gibi kesirli doluluk: 5 boş yıldızın üstüne,
  // doluluk oranınca kırpılmış amber katman bindirilir (ör. 4.8 → 5. yıldız %80).
  const safe = Math.max(0, Math.min(5, value ?? 0));
  const total = 5 * size + 4 * GAP;
  const fill = (safe / 5) * total;
  return (
    <div className="relative inline-flex shrink-0" style={{ width: total, height: size }} aria-label={`${safe} / 5`}>
      <StarRow size={size} colorClass="text-slate-300 " />
      <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: fill }}>
        <StarRow size={size} colorClass="text-amber-400" />
      </div>
    </div>
  );
}
