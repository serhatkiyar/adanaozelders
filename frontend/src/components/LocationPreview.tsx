interface LocationPreviewProps {
  lat: number;
  lng: number;
  /** Görünür yükseklik (px). Varsayılan 150. */
  height?: number;
  className?: string;
}

/**
 * Seçilen konumun küçük, salt-okunur harita görseli (işaretçili).
 * OpenStreetMap embed kullanır — API key gerektirmez. Kullanıcının haritada
 * tam olarak nereyi seçtiğini adres formunda görsel olarak teyit etmesini sağlar.
 */
export function LocationPreview({
  lat,
  lng,
  height = 150,
  className = "",
}: LocationPreviewProps) {
  const d = 0.0025; // ~250 m'lik bir çerçeve
  const bbox = `${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}`;
  const embedSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
  const fullSrc = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

  return (
    <div
      className={`relative overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 ${className}`}
    >
      <iframe
        title="Seçilen konum"
        src={embedSrc}
        loading="lazy"
        className="w-full border-0"
        style={{ height }}
      />
      <a
        href={fullSrc}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 backdrop-blur transition hover:bg-white dark:bg-slate-800/90 dark:text-slate-200 dark:ring-slate-600"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
          />
        </svg>
        Büyüt
      </a>
    </div>
  );
}
