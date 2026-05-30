interface StarRatingProps {
  // 0-5 arası ortalama; null ise boş yıldız.
  value: number | null | undefined;
}

export function StarRating({ value }: StarRatingProps) {
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
