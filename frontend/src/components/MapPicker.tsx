import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

interface MapPickerProps {
  initialLat?: number | null;
  initialLng?: number | null;
  onLocationSelect?: (lat: number, lng: number) => void;
  readonly?: boolean;
}

function LocationMarker({ position, setPosition, readonly }: any) {
  useMapEvents({
    click(e) {
      if (readonly) return;
      setPosition(e.latlng);
    },
  });

  return position === null ? null : (
    <Marker position={position}></Marker>
  );
}

export function MapPicker({ initialLat, initialLng, onLocationSelect, readonly = false }: MapPickerProps) {
  const [position, setPosition] = useState<L.LatLng | null>(
    initialLat && initialLng ? L.latLng(initialLat, initialLng) : null
  );

  useEffect(() => {
    if (position && onLocationSelect) {
      onLocationSelect(position.lat, position.lng);
    }
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default center: Istanbul or the selected position
  const center = position || L.latLng(41.0082, 28.9784);

  return (
    <div className="h-64 w-full overflow-hidden rounded-xl border border-slate-200 shadow-inner z-0">
      <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%", zIndex: 0 }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <LocationMarker position={position} setPosition={setPosition} readonly={readonly} />
      </MapContainer>
      {!readonly && (
        <p className="mt-2 text-xs text-slate-500 text-center">
          Haritaya tıklayarak konumu işaretleyin.
        </p>
      )}
    </div>
  );
}
