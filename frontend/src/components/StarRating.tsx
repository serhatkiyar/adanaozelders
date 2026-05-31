import React from "react";

interface StarRatingProps {
  // 0-5 arası ortalama; null ise boş yıldız.
  value: number | null | undefined;
  single?: boolean;
}

export function StarRating({ value, single }: StarRatingProps) {
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
            className={`h-4 w-4 ${percent === 100 ? "text-amber-400" : "text-slate-300"}`}
            fill="currentColor"
          >
            <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
          </svg>
        </div>
      );
    }

    const gradId = `single-star-grad-${uniqueId}`;

    return (
      <div className="flex items-center gap-0.5" aria-label={`${safeValue} / 5`}>
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4 text-amber-400"
          fill="currentColor"
        >
          <defs>
            <linearGradient id={gradId}>
              <stop offset={`${percent}%`} stopColor="currentColor" />
              <stop offset={`${percent}%`} stopColor="#cbd5e1" /> {/* slate-300 */}
            </linearGradient>
          </defs>
          <path
            fill={`url(#${gradId})`}
            d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z"
          />
        </svg>
      </div>
    );
  }

  const rounded = Math.round((value ?? 0) * 2) / 2; // 0.5 adımlı
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value ?? 0} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = rounded >= i;
        const half = !filled && rounded >= i - 0.5;
        return (
          <svg
            key={i}
            viewBox="0 0 20 20"
            className={`h-4 w-4 ${
              filled || half ? "text-amber-400" : "text-slate-300"
            }`}
            fill="currentColor"
          >
            {half ? (
              <>
                <defs>
                  <linearGradient id={`half-${i}`}>
                    <stop offset="50%" stopColor="currentColor" />
                    <stop offset="50%" stopColor="#cbd5e1" />
                  </linearGradient>
                </defs>
                <path
                  fill={`url(#half-${i})`}
                  d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z"
                />
              </>
            ) : (
              <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
            )}
          </svg>
        );
      })}
    </div>
  );
}
