import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import {
  geocodeAutocomplete,
  geocodeDetails,
  geocodeForward,
  geocodeReverse,
  newGeocodeSession,
  type GeocodeSuggestion,
} from "@/api/geocode";
import { useMapGate, MapGestureController, MapGateHint } from "@/components/map/MapGate";
import "./MapPicker.css";
import { TILE_SOURCES } from "@/lib/mapTiles";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

/* ─── types ──────────────────────────────────────────── */

interface MapPickerProps {
  initialLat?: number | null;
  initialLng?: number | null;
  onLocationSelect?: (lat: number, lng: number, address?: string) => void;
  readonly?: boolean;
}

type MapLayer = "street" | "satellite";

/* ─── tile URLs ──────────────────────────────────────── */

// Adresler lib/mapTiles.ts'te tek kaynakta; uydu katmanı eskiden Google'ın
// resmî OLMAYAN http:// uç noktasını kullanıyordu (HTTPS'te karışık içerik →
// üretimde sessizce boş harita).
const TILE_URLS = TILE_SOURCES;

/* ─── sub-components ─────────────────────────────────── */

function LocationMarker({
  position,
  setPosition,
  readonly,
  onDragChange,
}: {
  position: L.LatLng | null;
  setPosition: (p: L.LatLng) => void;
  readonly: boolean;
  onDragChange?: (dragging: boolean) => void;
}) {
  const map = useMapEvents({
    moveend() {
      if (readonly) return;
      onDragChange?.(false);
      setPosition(map.getCenter());
    },
    movestart() {
      if (readonly) return;
      onDragChange?.(true);
    }
  });

  return readonly && position ? <Marker position={position} /> : null;
}

function MapUpdater({ center }: { center: L.LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, 15, { duration: 0.8 });
  }, [center, map]);
  return null;
}

/* ─── Layer switcher (runs inside MapContainer) ────── */

function LayerSwitcher({ layer }: { layer: MapLayer }) {
  const map = useMap();
  const tileRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
    }
    const cfg = TILE_URLS[layer];
    const newTile = L.tileLayer(cfg.url, { attribution: cfg.attribution });
    newTile.addTo(map);
    tileRef.current = newTile;

    return () => {
      if (tileRef.current) map.removeLayer(tileRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, map]);

  return null;
}

/* ─── Street View helper ─────────────────────────────── */

function streetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

function streetViewEmbedUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=12,0,,0,0&output=svembed`;
}

/* ─── main component ─────────────────────────────────── */

export function MapPicker({
  initialLat,
  initialLng,
  onLocationSelect,
  readonly = false,
}: MapPickerProps) {
  const [position, setPositionRaw] = useState<L.LatLng | null>(
    initialLat && initialLng ? L.latLng(initialLat, initialLng) : (readonly ? null : L.latLng(37.029003, 35.820839))
  );

  const [mapCenter, setMapCenter] = useState<L.LatLng>(
    position || L.latLng(37.029003, 35.820839)
  );

  const [isMapDragging, setIsMapDragging] = useState(false);
  const gate = useMapGate();

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  // Google Places autocomplete oturum token'ı — typeahead'ler tek oturumda toplanır,
  // adres seçilince sıfırlanır (maliyet optimizasyonu). Nominatim fallback'inde önemsiz.
  const sessionTokenRef = useRef<string>(newGeocodeSession());

  // Layer state
  const [activeLayer, setActiveLayer] = useState<MapLayer>("street");

  // Street View state
  const [showStreetView, setShowStreetView] = useState(false);
  const [autoOpenSv, setAutoOpenSv] = useState(false);
  const [showSvCloseMenu, setShowSvCloseMenu] = useState(false);
  const [svPos, setSvPos] = useState({ 
    left: typeof window !== "undefined" ? window.innerWidth - 340 : 0, 
    top: typeof window !== "undefined" ? window.innerHeight * 0.15 : 0 
  });
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      isDragging: true,
      startX: e.clientX - svPos.left,
      startY: e.clientY - svPos.top,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.isDragging) return;
    let newLeft = e.clientX - dragRef.current.startX;
    let newTop = e.clientY - dragRef.current.startY;

    const maxLeft = window.innerWidth - 320;
    const maxTop = window.innerHeight - 44;

    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));

    setSvPos({ left: newLeft, top: newTop });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.isDragging) {
      dragRef.current.isDragging = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const searchBoxRef = useRef<HTMLDivElement>(null);
  // Yarış koruması: yalnız en son aramanın cevabı uygulansın (eski yavaş cevap
  // yeni cevabın üstüne yazmasın; arada gelen geçici 403 listeyi boşaltmasın).
  const searchSeqRef = useRef(0);

  /* Close suggestions on outside click */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* Set position + reverse-geocode */
  const setPosition = useCallback(
    async (pos: L.LatLng) => {
      setPositionRaw(pos);
      if (autoOpenSv) setShowStreetView(true);
      onLocationSelect?.(pos.lat, pos.lng);

      const label = await geocodeReverse(pos.lat, pos.lng);
      if (label) {
        setResolvedAddress(label);
        onLocationSelect?.(pos.lat, pos.lng, label);
      } else {
        setResolvedAddress(null);
      }
    },
    [onLocationSelect]
  );

  /* Initial reverse geocode */
  useEffect(() => {
    if (position && !resolvedAddress) {
      geocodeReverse(position.lat, position.lng).then((label) => {
        if (label) {
          setResolvedAddress(label);
          onLocationSelect?.(position.lat, position.lng, label);
        } else {
          onLocationSelect?.(position.lat, position.lng);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Debounced search-as-you-type */
  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (value.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      const seq = ++searchSeqRef.current;
      try {
        const data = await geocodeAutocomplete(value, sessionTokenRef.current);
        if (seq !== searchSeqRef.current) return; // bayat cevap — yoksay
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      } catch {
        // Geçici hata (ör. propagation 403): mevcut önerileri silme, sadece geç.
      }
    }, 250);
  };

  const selectSuggestion = async (s: GeocodeSuggestion) => {
    // Bekleyen typeahead'i iptal et ki seçimden sonra listeyi geri açmasın.
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchSeqRef.current++;

    let lat = s.lat;
    let lng = s.lng;
    let label = s.label;

    // Google önerilerinde koordinat gelmez → details ile çöz (aynı session token).
    if (lat == null || lng == null) {
      try {
        const d = await geocodeDetails(s.id, sessionTokenRef.current);
        lat = d.lat;
        lng = d.lng;
        if (d.address) label = d.address;
      } catch {
        setShowSuggestions(false);
        return;
      }
    }
    // Seçim oturumu kapatır → bir sonraki arama için yeni token (maliyet sıfırlama).
    sessionTokenRef.current = newGeocodeSession();

    const newPos = L.latLng(lat, lng);
    setMapCenter(newPos);
    if (!readonly) {
      setPositionRaw(newPos);
      if (autoOpenSv) setShowStreetView(true);
      setResolvedAddress(label);
      onLocationSelect?.(lat, lng, label);
    }
    setSearchQuery(label.split(",")[0]);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchSeqRef.current++;
    setIsSearching(true);
    setShowSuggestions(false);
    try {
      // "Ara"/Enter = yazılan tam metni noktaya çevir (Geocoding) — kapı no'lu
      // sokak adresleri için. Autocomplete sadece sokak/bölge seviyesi verir.
      const fwd = await geocodeForward(searchQuery);
      if (fwd) {
        await selectSuggestion({ id: "forward", label: fwd.address, lat: fwd.lat, lng: fwd.lng });
        return;
      }
      // Forward bulamadıysa ilk autocomplete önerisine düş.
      const list =
        suggestions.length > 0
          ? suggestions
          : await geocodeAutocomplete(searchQuery, sessionTokenRef.current);
      if (list.length > 0) {
        await selectSuggestion(list[0]);
      } else {
        setResolvedAddress(null);
      }
    } catch {
      /* fail silently */
    } finally {
      setIsSearching(false);
    }
  };

  const handleGeolocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newPos = L.latLng(pos.coords.latitude, pos.coords.longitude);
        setMapCenter(newPos);
        if (!readonly) setPosition(newPos);
        setIsLocating(false);
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="map-picker-root">
      {/* ── Map ── */}
      <MapContainer
        center={mapCenter}
        zoom={13}
        style={{ height: "100%", width: "100%", zIndex: 0 }}
        attributionControl={false}
      >
        <MapGestureController {...gate} />
        <LayerSwitcher layer={activeLayer} />
        <LocationMarker position={position} setPosition={setPosition} readonly={readonly} onDragChange={setIsMapDragging} />
        <MapUpdater center={mapCenter} />
      </MapContainer>

      {/* Kilitli haritada kazara konum kayması olmasın — tıkla-etkinleştir kapısı. */}
      <MapGateHint active={gate.active} label={readonly ? "Hareket ettirmek için tıkla" : "Konumu ayarlamak için tıkla"} />

      {/* ── Center Marker Overlay ── */}
      {!readonly && (
        <div className={`map-picker-center-marker ${isMapDragging ? "dragging" : ""}`}>
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="white" strokeWidth="1" className="h-10 w-10 text-marka-metin drop-shadow-md">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0Z" />
          </svg>
        </div>
      )}

      {/* ── Custom layer toggle ── */}
      <div className="map-picker-layer-toggle">
        <button
          type="button"
          onClick={() => setActiveLayer("street")}
          className={`map-picker-layer-btn ${activeLayer === "street" ? "map-picker-layer-btn--active" : ""}`}
        >
          <svg className="map-picker-layer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
          </svg>
          Harita
        </button>
        <button
          type="button"
          onClick={() => setActiveLayer("satellite")}
          className={`map-picker-layer-btn ${activeLayer === "satellite" ? "map-picker-layer-btn--active" : ""}`}
        >
          <svg className="map-picker-layer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A8.966 8.966 0 0 1 3 12c0-1.264.26-2.466.732-3.558" />
          </svg>
          Uydu
        </button>
      </div>

      {/* ── Overlay controls (only in edit mode) ── */}
      {!readonly && (
        <>
          {/* Search Box with suggestions */}
          <div ref={searchBoxRef} className="map-picker-search">
            <div className="map-picker-search-input-row">
              <svg className="map-picker-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {/* İP-A7d3: kutu ADSIZDI (`placeholder` etiket yerine) ve üç ayrı
                  testte "bilinen istisna" olarak taşınıyordu (A7d2'nin kapanış
                  notunda dalga 3'e bırakılmıştı). Görünür bir etiket harita
                  tuvalinin üstünde yer kaplar; `aria-label` doğru çözümdür. */}
              <input
                type="text"
                aria-label="Haritada adres ara"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    // Parent <form> (AddressForm) submit'ini tetiklemesin → "patlama".
                    e.preventDefault();
                    e.stopPropagation();
                    handleSearch();
                  }
                }}
                placeholder="Mahalle, sokak veya adres ara…"
                className="map-picker-search-input"
              />
              <button
                type="button"
                onClick={handleSearch}
                disabled={isSearching}
                className="map-picker-search-btn"
              >
                {isSearching ? (
                  <svg className="map-picker-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                ) : (
                  "Ara"
                )}
              </button>
            </div>

            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <ul className="map-picker-suggestions">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => selectSuggestion(s)}
                      className="map-picker-suggestion-item"
                    >
                      <svg className="map-picker-pin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                      </svg>
                      <span className="map-picker-suggestion-text">{s.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right side buttons stack */}
          <div className="map-picker-right-controls">
            {/* Geolocation Button */}
            <button
              type="button"
              onClick={handleGeolocation}
              disabled={isLocating}
              title="Konumumu Bul"
              className={`map-picker-control-btn ${isLocating ? "map-picker-geolocate--active" : ""}`}
            >
              <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
            </button>

            {/* Street View button (always visible) */}
            <button
              type="button"
              onClick={() => {
                if (!position) {
                  alert("Lütfen önce haritadan bir konum işaretleyin veya arama yapın.");
                  return;
                }
                setShowStreetView(!showStreetView);
              }}
              title="Street View"
              className={`map-picker-control-btn ${showStreetView ? "map-picker-control-btn--active" : (position ? "map-picker-control-btn--pulse" : "")}`}
            >
              <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="12" cy="5" r="2.5" />
                <path strokeLinecap="round" d="M12 7.5V14" />
                <path strokeLinecap="round" d="M8 21l4-7 4 7" />
                <path strokeLinecap="round" d="M7 11.5h10" />
              </svg>
            </button>
          </div>

          {/* Bottom Helper */}
          <div className="map-picker-helper">
            <span className="map-picker-helper-badge">
              {position ? (
                <>
                  <svg className="map-picker-helper-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Konum seçildi, değiştirmek için haritaya tıklayın
                </>
              ) : (
                <>
                  <svg className="map-picker-helper-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                  </svg>
                  Haritaya tıklayarak konumu işaretleyin
                </>
              )}
            </span>
          </div>
        </>
      )}

      {/* ── Street View Panel ── */}
      {showStreetView && position && typeof document !== "undefined" && createPortal(
        <div 
          className="map-picker-streetview-panel"
          style={{ left: `${svPos.left}px`, top: `${svPos.top}px` }}
        >
          <div 
            className="map-picker-streetview-header"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ cursor: "grab", touchAction: "none" }}
          >
            <div className="map-picker-streetview-title-row">
              <svg className="map-picker-streetview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="12" cy="5" r="2.5" />
                <path strokeLinecap="round" d="M12 7.5V14" />
                <path strokeLinecap="round" d="M8 21l4-7 4 7" />
                <path strokeLinecap="round" d="M7 11.5h10" />
              </svg>
              <span>Street View</span>
            </div>
            <div className="map-picker-streetview-actions">
              <a
                href={streetViewUrl(position.lat, position.lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="map-picker-streetview-external"
                title="Yeni sekmede aç"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowSvCloseMenu(!showSvCloseMenu)}
                  className="map-picker-streetview-close"
                >
                  <span>Street View Gizle</span>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                {showSvCloseMenu && (
                  <div className="map-picker-sv-close-menu">
                    <button type="button" onClick={() => { setShowStreetView(false); setShowSvCloseMenu(false); }}>
                      Sadece Kapat
                    </button>
                    <button type="button" onClick={() => { setAutoOpenSv(false); setShowStreetView(false); setShowSvCloseMenu(false); }}>
                      Otomatik Açılmayı Kapat
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="map-picker-streetview-body">
            <iframe
              src={streetViewEmbedUrl(position.lat, position.lng)}
              className="map-picker-streetview-iframe"
              title="Street View"
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
            <div className="map-picker-streetview-fallback">
              <p>Street View yüklenemezse:</p>
              <a
                href={streetViewUrl(position.lat, position.lng)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Maps'te aç →
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
