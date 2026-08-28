import { useRef, useState, useCallback } from "react";
import { useModalPanel } from "@/hooks/useModalA11y";
import Cropper, { ReactCropperElement } from "react-cropper";
import "cropperjs/dist/cropper.css";

interface ImageCropModalProps {
  /** The image source (object URL or data URL) to crop */
  imageSrc: string;
  /** Called with the cropped Blob when user confirms */
  onCropComplete: (blob: Blob) => void;
  /** Called when user cancels / closes the modal */
  onClose: () => void;
  /** Whether the upload is in progress */
  isUploading?: boolean;
  /** Kırpma oranı (genişlik/yükseklik). Varsayılan 1 (kare — avatar/logo). 16:9 → 16/9. */
  aspectRatio?: number;
  /** Çıktı çözünürlüğü (px). Varsayılan 512×512. Banner için ör. 1600×900. */
  outputWidth?: number;
  outputHeight?: number;
  /** Başlık. */
  title?: string;
}

export function ImageCropModal({
  imageSrc,
  onCropComplete,
  onClose,
  isUploading = false,
  aspectRatio = 1,
  outputWidth = 512,
  outputHeight = 512,
  title = "Fotoğrafı Düzenle",
}: ImageCropModalProps) {
  const cropperRef = useRef<ReactCropperElement>(null);
  // Odak tuzağı: kırpma penceresi açıkken Tab arkadaki forma kaçmasın.
  const panelRef = useModalPanel({ onClose });
  const [zoom, setZoom] = useState(0);
  const [rotation, setRotation] = useState(0);

  const handleCrop = useCallback(() => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper) return;

    cropper.getCroppedCanvas({
      width: outputWidth,
      height: outputHeight,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    }).toBlob(
      (blob) => {
        if (blob) onCropComplete(blob);
      },
      "image/webp",
      0.9
    );
  }, [onCropComplete, outputWidth, outputHeight]);

  const handleRotate = (deg: number) => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper) return;
    const newRotation = rotation + deg;
    setRotation(newRotation);
    cropper.rotateTo(newRotation);
  };

  const handleZoom = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper) return;
    const val = Number(e.target.value);
    setZoom(val);
    cropper.zoomTo(val / 100 + 0.5);
  };

  const handleFlipH = () => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper) return;
    const data = cropper.getData();
    cropper.scaleX(data.scaleX === -1 ? 1 : -1);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isUploading ? onClose : undefined}
      />

      {/* Modal */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="relative z-10 mx-4 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl "
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 ">
          <h3 className="text-base font-semibold text-slate-900 ">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40 "
            aria-label="Kapat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Cropper Area */}
        <div className="relative bg-slate-950">
          <Cropper
            ref={cropperRef}
            src={imageSrc}
            style={{ height: 360, width: "100%" }}
            aspectRatio={aspectRatio}
            viewMode={1}
            dragMode="move"
            guides={false}
            center
            highlight={false}
            background={false}
            autoCropArea={0.85}
            responsive
            cropBoxResizable
            cropBoxMovable
            toggleDragModeOnDblclick={false}
          />
        </div>

        {/* Controls */}
        <div className="space-y-3 border-t border-slate-200 px-5 py-4 ">
          {/* Zoom slider */}
          <div className="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
            <input
              type="range"
              min={0}
              max={200}
              value={zoom}
              onChange={handleZoom}
              className="crop-slider h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600 "
            />
          </div>

          {/* Action buttons row */}
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => handleRotate(-90)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 "
              title="Sola döndür"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
              </svg>
              Sola
            </button>
            <button
              type="button"
              onClick={() => handleRotate(90)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 "
              title="Sağa döndür"
            >
              Sağa
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a5 5 0 00-5 5v2m15-7l-4-4m4 4l-4 4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleFlipH}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 "
              title="Yatay çevir"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              Çevir
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4 ">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 "
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleCrop}
            disabled={isUploading}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Yükleniyor…
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Kaydet
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
