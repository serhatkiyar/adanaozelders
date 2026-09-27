/**
 * Erişilebilir ilerleme çubuğu (0–1). Belirsiz ilerleme için `oran` verilmez:
 * `aria-valuenow` düşer, çubuk kayan animasyonla çizilir.
 */
export function IlerlemeCubugu({
  oran,
  etiket,
  className = "",
}: {
  /** 0–1; belirsiz için undefined. */
  oran?: number;
  /** Ekran okuyucu adı, ör. "Video yükleme ilerlemesi". */
  etiket: string;
  className?: string;
}) {
  const belirli = typeof oran === "number" && Number.isFinite(oran);
  const yuzde = belirli ? Math.round(Math.min(1, Math.max(0, oran)) * 100) : undefined;
  return (
    <div
      role="progressbar"
      aria-label={etiket}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={yuzde}
      aria-valuetext={belirli ? `%${yuzde}` : "Devam ediyor"}
      className={`h-2 w-full overflow-hidden rounded-full bg-slate-200 ${className}`}
    >
      {belirli ? (
        <div
          className="h-full rounded-full bg-marka transition-[width] duration-200"
          style={{ width: `${yuzde}%` }}
        />
      ) : (
        <div className="h-full w-1/3 animate-pulse rounded-full bg-marka" />
      )}
    </div>
  );
}
