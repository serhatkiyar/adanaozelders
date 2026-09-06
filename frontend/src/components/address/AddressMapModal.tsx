import { useState } from "react";
import { MapPicker } from "@/components/MapPicker";

/**
 * Harita ile konum seçme modalı. Hem rezervasyon ekranı hem de ayarlardaki
 * adres yönetimi tek ve aynı tasarımı kullansın diye ortak bileşen.
 */
export function AddressMapModal({
  initialLat,
  initialLng,
  onCancel,
  onConfirm,
}: {
  initialLat: number | null;
  initialLng: number | null;
  onCancel: () => void;
  onConfirm: (lat: number, lng: number, address: string | null) => void;
}) {
  const [lat, setLat] = useState<number | null>(initialLat);
  const [lng, setLng] = useState<number | null>(initialLng);
  const [address, setAddress] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[80vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl ">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 ">
          <h3 className="font-semibold text-slate-800 ">Konum Seç</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 "
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="relative flex-1">
          <MapPicker
            initialLat={initialLat ?? undefined}
            initialLng={initialLng ?? undefined}
            onLocationSelect={(la, ln, addr) => {
              setLat(la);
              setLng(ln);
              setAddress(addr ?? null);
            }}
          />
          <div className="pointer-events-none absolute bottom-6 left-1/2 w-full max-w-md -translate-x-1/2 px-4">
            <div className="pointer-events-auto rounded-2xl bg-white/95 p-4 shadow-lg ring-1 ring-slate-200 backdrop-blur ">
              <p className="mb-3 line-clamp-2 text-sm font-medium text-slate-700 ">
                {address || "Haritadan bir nokta seçin..."}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex-1 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-200 "
                >
                  İptal
                </button>
                <button
                  type="button"
                  onClick={() => lat != null && lng != null && onConfirm(lat, lng, address)}
                  disabled={lat == null}
                  className="flex-1 rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:opacity-50"
                >
                  Onayla
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
