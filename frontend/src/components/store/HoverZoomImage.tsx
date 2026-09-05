import { useEffect, useRef, useState, type ReactNode } from "react";
import { computeZoom, type ZoomState } from "@/lib/imageZoom";

const ZOOM = 2.4;
/** Zoom paneli hero kutusunun bu oranı kadar büyük çizilir — 1 iken ekrandan taşabiliyordu. */
const PANEL_SCALE = 0.75;

/** Ürün detay hero görseli: imleç üzerindeyken lens + sağdaki bilgi sütununun
 * üzerine açılan zoom önizleme paneli (Amazon deseni). Tıklama lightbox'ı açar.
 * Yalnız hover'lı hassas işaretçide (masaüstü) etkin; dokunmatikte devre dışı.
 * `children` sağ üst köşe aksiyonları (favori/paylaş) içindir. */
export function HoverZoomImage({
  src,
  alt,
  onOpen,
  children,
}: {
  src: string;
  alt: string;
  onOpen: () => void;
  children?: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [finePointer, setFinePointer] = useState(false);
  const [zoom, setZoom] = useState<ZoomState | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    setFinePointer(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setFinePointer(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function handleMove(e: React.MouseEvent) {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!finePointer || !box || !img || !img.naturalWidth) {
      setZoom(null);
      return;
    }
    const ib = img.getBoundingClientRect();
    const bb = box.getBoundingClientRect();
    setZoom(
      computeZoom({
        cursorX: e.clientX,
        cursorY: e.clientY,
        imgLeft: ib.left,
        imgTop: ib.top,
        imgWidth: ib.width,
        imgHeight: ib.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        boxLeft: bb.left,
        boxTop: bb.top,
        panelWidth: bb.width * PANEL_SCALE,
        panelHeight: bb.height * PANEL_SCALE,
        zoom: ZOOM,
      })
    );
  }

  return (
    <div
      ref={boxRef}
      className="relative aspect-square rounded-2xl border border-slate-200 bg-white "
    >
      <button
        type="button"
        onClick={onOpen}
        onMouseMove={handleMove}
        onMouseLeave={() => setZoom(null)}
        aria-label="Görseli büyüt"
        className="absolute inset-0 flex cursor-zoom-in items-center justify-center overflow-hidden rounded-2xl p-6"
      >
        {/* LCP elemanı: ürün sayfalarında en büyük içerik ögesi neredeyse her
            zaman bu görseldir. `loading="lazy"` BİLİNÇLİ OLARAK YOK — LCP
            görselini tembel yüklemek en yaygın performans hatasıdır; onun
            yerine yüksek öncelikle çekilir. */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          // React 18 camelCase `fetchPriority`yi TANIMAZ: uyarı basar ve
          // özniteliği DOM'a hiç yazmaz (destek React 19'da geldi). Küçük
          // harfli hâli geçer; React tipleri henüz taşımadığı için yayılarak
          // veriliyor. React 19 göçünde `fetchPriority="high"` olabilir.
          {...{ fetchpriority: "high" }}
          decoding="async"
          className="h-full w-full object-contain mix-blend-multiply"
        />
      </button>

      {/* Lens — zoom panelinde gösterilen bölge */}
      {zoom && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 hidden rounded-sm border border-indigo-300/80 bg-indigo-500/10 md:block"
          style={{
            left: zoom.lensLeft,
            top: zoom.lensTop,
            width: zoom.lensWidth,
            height: zoom.lensHeight,
          }}
        />
      )}

      {/* Zoom önizleme paneli — bilgi sütununun üzerine açılır (grid gap-10 → ml-10) */}
      {zoom && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-full top-0 z-30 ml-10 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl md:block "
          style={{
            width: `${PANEL_SCALE * 100}%`,
            height: `${PANEL_SCALE * 100}%`,
            backgroundImage: `url(${src})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${zoom.bgWidth}px ${zoom.bgHeight}px`,
            backgroundPosition: `${zoom.bgX}px ${zoom.bgY}px`,
          }}
        />
      )}

      {children}
    </div>
  );
}
