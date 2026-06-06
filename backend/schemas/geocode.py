from __future__ import annotations

from pydantic import BaseModel


class GeocodeSuggestion(BaseModel):
    """Autocomplete önerisi. ``lat``/``lng`` yalnız Nominatim fallback'inde dolu
    gelir (koordinat öneriyle birlikte gelir); Google'da ``None`` döner ve koordinat
    için ``/geocode/details`` çağrısı gerekir (aynı session token ile)."""

    id: str
    label: str
    lat: float | None = None
    lng: float | None = None


class GeocodeDetails(BaseModel):
    """Seçilen adresin doğrulanmış koordinat + formatlı adresi."""

    lat: float
    lng: float
    address: str


class GeocodeReverse(BaseModel):
    """Haritadan işaretlenen bir noktanın ters-geocode adresi."""

    address: str | None = None
