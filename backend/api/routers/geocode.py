from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from api.deps import user_rate_limit
from core.config import settings
from schemas.geocode import GeocodeDetails, GeocodeReverse, GeocodeSuggestion
from services import geocode_service

router = APIRouter(prefix="/geocode", tags=["geocode"])

# Kullanıcı bazlı rate-limit (typeahead için yüksek). Bağımlılık zaten
# get_current_active_user'ı çeker → uç kimlik doğrulamalıdır (Google anahtarını
# besleyen açık bir proxy olmasın).
_rate_limited = user_rate_limit(
    key="geocode",
    limit=settings.RATE_LIMIT_GEOCODE,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)


@router.get("/autocomplete", response_model=list[GeocodeSuggestion])
async def autocomplete(
    q: str = Query(min_length=3, max_length=200),
    session: str | None = Query(default=None, max_length=80),
    _: None = Depends(_rate_limited),
):
    """Adres önerileri (typeahead). ``session`` istemci tarafında üretilen oturum
    token'ı (Google maliyetini tek oturumda toplar); seçim sonrası istemci sıfırlar."""
    return await geocode_service.autocomplete(q, session)


@router.get("/details", response_model=GeocodeDetails)
async def details(
    place_id: str = Query(min_length=1, max_length=400),
    session: str | None = Query(default=None, max_length=80),
    _: None = Depends(_rate_limited),
):
    """Seçilen öneriyi doğrulanmış koordinat + adrese çevirir (field mask'li)."""
    res = await geocode_service.details(place_id, session)
    if res is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Adres çözümlenemedi")
    return res


@router.get("/forward", response_model=GeocodeDetails)
async def forward(
    q: str = Query(min_length=2, max_length=300),
    _: None = Depends(_rate_limited),
):
    """Serbest metni ("Ara"/Enter) tek en iyi koordinata çevirir (Geocoding).
    Kapı no'lu sokak adresleri için; Autocomplete'in yapamadığı şey."""
    res = await geocode_service.forward(q)
    if res is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Adres bulunamadı")
    return res


@router.get("/reverse", response_model=GeocodeReverse)
async def reverse(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    _: None = Depends(_rate_limited),
):
    """Haritadan işaretlenen noktanın adresini döner (ters-geocode)."""
    res = await geocode_service.reverse(lat, lng)
    return res or {"address": None}
