"""Adres arama / geocode servisi — sağlayıcıdan bağımsız (core/payments, core/mail deseni).

``GOOGLE_MAPS_API_KEY`` ayarlıysa **Google Places API (New)** + Geocoding API kullanılır;
değilse **Nominatim / OpenStreetMap**'e fallback edilir. Her iki yol da aynı sözlük
şekillerini döner, böylece istemci (frontend MapPicker) tek kod yolu kullanır:

- autocomplete -> ``[{id, label, lat|None, lng|None}]``  (yazarken öneri)
- details      -> ``{lat, lng, address}`` | ``None``       (öneri seçimi → koordinat)
- forward      -> ``{lat, lng, address}`` | ``None``       ("Ara"/Enter: serbest metin → nokta)
- reverse      -> ``{address}`` | ``None``                 (harita pin → adres)

Maliyet / hız:
- Autocomplete + Details **aynı session token** ile tek oturum olarak faturalanır.
- Details çağrısında **field mask** yalnız ``location,formattedAddress`` ister.
- **Tek paylaşılan httpx.AsyncClient** (keep-alive) — her tuşta yeni TLS el sıkışması
  yapılmaz; bağlantılar yeniden kullanılır.
- Anahtar yalnızca burada (sunucuda) kullanılır; istemciye hiç gönderilmez.

Tüm dış çağrılar fail-soft: hata/timeout durumunda boş liste / ``None`` döner.
"""

from __future__ import annotations

import logging

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(8.0)
_USER_AGENT = "CeyhanTutoringMarketplace/1.0 (+geocode-proxy)"

_PLACES_BASE = "https://places.googleapis.com/v1"
_GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
_NOMINATIM_BASE = "https://nominatim.openstreetmap.org"

# Nominatim viewbox: lon1,lat1,lon2,lat2 (Ceyhan çevresi) — yazarken öneri yanlılığı.
_NOMINATIM_VIEWBOX = "35.63,37.16,35.98,36.89"

# Paylaşılan, kalıcı HTTP istemcisi (keep-alive). Her çağrıda yeniden açmak yerine
# bağlantı havuzunu yeniden kullanır → Google/Nominatim'e tekrarlı TLS el sıkışması yok.
_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=_TIMEOUT,
            headers={"User-Agent": _USER_AGENT},
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=40),
        )
    return _client


async def aclose() -> None:
    """Uygulama kapanışında istemciyi kapat (lifespan'den çağrılabilir)."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


# ── Public API ────────────────────────────────────────────────────────────────


async def autocomplete(query: str, session_token: str | None) -> list[dict]:
    if settings.GOOGLE_MAPS_API_KEY:
        return await _google_autocomplete(query, session_token)
    return await _nominatim_autocomplete(query)


async def details(place_id: str, session_token: str | None) -> dict | None:
    if settings.GOOGLE_MAPS_API_KEY:
        return await _google_details(place_id, session_token)
    return await _nominatim_details(place_id)


async def reverse(lat: float, lng: float) -> dict | None:
    # Ters-geocode Places API (New)'de yok → Geocoding API gerektirir. Varsayılan:
    # key olsa bile ücretsiz Nominatim kullan (en sık çağrı; "yalnız Places API açık").
    if settings.GOOGLE_MAPS_API_KEY and not settings.GEOCODE_REVERSE_USE_NOMINATIM:
        return await _google_reverse(lat, lng)
    return await _nominatim_reverse(lat, lng)


async def forward(query: str) -> dict | None:
    """Serbest metin → tek en iyi koordinat ("Ara"/Enter). Autocomplete sokak/bölge
    seviyesinde tahmin verir; kapı no ("No 83") çözümü **Geocoding API** ister. Key
    varsa Google Geocoding denenir; kapalı/sonuçsuzsa ücretsiz Nominatim'e düşer."""
    if settings.GOOGLE_MAPS_API_KEY:
        res = await _google_forward(query)
        if res:
            return res
        # 403 / API kapalı / ZERO_RESULTS → ücretsiz fallback (kullanıcı engellenmesin).
    return await _nominatim_forward(query)


# ── Google Places API (New) ─────────────────────────────────────────────────────


async def _google_autocomplete(query: str, session_token: str | None) -> list[dict]:
    body: dict = {
        "input": query,
        "includedRegionCodes": [settings.GEOCODE_COUNTRY],
        "languageCode": settings.GEOCODE_LANGUAGE,
    }
    # Yanlılık opsiyonel: radius>0 ise yerele (Ceyhan) yaklaştır; 0 ise ülke geneli.
    if settings.GEOCODE_BIAS_RADIUS_M and settings.GEOCODE_BIAS_RADIUS_M > 0:
        body["locationBias"] = {
            "circle": {
                "center": {
                    "latitude": settings.GEOCODE_BIAS_LAT,
                    "longitude": settings.GEOCODE_BIAS_LNG,
                },
                "radius": float(settings.GEOCODE_BIAS_RADIUS_M),
            }
        }
    if session_token:
        body["sessionToken"] = session_token

    try:
        resp = await _http().post(
            f"{_PLACES_BASE}/places:autocomplete",
            json=body,
            headers={"X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY},
        )
        if resp.status_code >= 400:
            logger.warning("Google autocomplete %s: %s", resp.status_code, resp.text[:600])
            return []
        data = resp.json()
    except Exception:  # noqa: BLE001 — fail-soft
        logger.warning("Google autocomplete failed", exc_info=True)
        return []

    out: list[dict] = []
    for s in data.get("suggestions", []):
        pred = s.get("placePrediction")
        if not pred:
            continue  # queryPrediction vb. — atla
        text = (pred.get("text") or {}).get("text")
        place_id = pred.get("placeId")
        if not place_id or not text:
            continue
        out.append({"id": place_id, "label": text, "lat": None, "lng": None})
    return out


async def _google_details(place_id: str, session_token: str | None) -> dict | None:
    params: dict = {"languageCode": settings.GEOCODE_LANGUAGE}
    if session_token:
        params["sessionToken"] = session_token

    try:
        resp = await _http().get(
            f"{_PLACES_BASE}/places/{place_id}",
            params=params,
            headers={
                "X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY,
                # Field mask → yalnız konum + adres; ucuz SKU'da kal.
                "X-Goog-FieldMask": "location,formattedAddress",
            },
        )
        if resp.status_code >= 400:
            logger.warning("Google details %s: %s", resp.status_code, resp.text[:600])
            return None
        data = resp.json()
    except Exception:  # noqa: BLE001
        logger.warning("Google details failed", exc_info=True)
        return None

    loc = data.get("location") or {}
    lat, lng = loc.get("latitude"), loc.get("longitude")
    if lat is None or lng is None:
        return None
    return {"lat": lat, "lng": lng, "address": data.get("formattedAddress") or ""}


async def _google_reverse(lat: float, lng: float) -> dict | None:
    try:
        resp = await _http().get(
            _GOOGLE_GEOCODE_URL,
            params={
                "latlng": f"{lat},{lng}",
                "language": settings.GEOCODE_LANGUAGE,
                "region": settings.GEOCODE_COUNTRY,
                "key": settings.GOOGLE_MAPS_API_KEY,
            },
        )
        if resp.status_code >= 400:
            logger.warning("Google reverse %s: %s", resp.status_code, resp.text[:600])
            return None
        data = resp.json()
    except Exception:  # noqa: BLE001
        logger.warning("Google reverse geocode failed", exc_info=True)
        return None

    results = data.get("results") or []
    if not results:
        return {"address": None}
    return {"address": results[0].get("formatted_address")}


async def _google_forward(query: str) -> dict | None:
    try:
        resp = await _http().get(
            _GOOGLE_GEOCODE_URL,
            params={
                "address": query,
                "region": settings.GEOCODE_COUNTRY,
                "language": settings.GEOCODE_LANGUAGE,
                "components": f"country:{settings.GEOCODE_COUNTRY.upper()}",
                "key": settings.GOOGLE_MAPS_API_KEY,
            },
        )
        if resp.status_code >= 400:
            logger.warning("Google forward %s: %s", resp.status_code, resp.text[:600])
            return None
        data = resp.json()
    except Exception:  # noqa: BLE001
        logger.warning("Google forward geocode failed", exc_info=True)
        return None

    status = data.get("status")
    if status != "OK":
        # ZERO_RESULTS sessiz; REQUEST_DENIED (API kapalı/kısıtlı) vb. logla → fallback.
        if status and status != "ZERO_RESULTS":
            logger.warning("Google forward status=%s: %s", status, data.get("error_message"))
        return None
    results = data.get("results") or []
    if not results:
        return None
    loc = results[0].get("geometry", {}).get("location", {})
    lat, lng = loc.get("lat"), loc.get("lng")
    if lat is None or lng is None:
        return None
    return {"lat": lat, "lng": lng, "address": results[0].get("formatted_address") or ""}


# ── Nominatim / OpenStreetMap fallback ─────────────────────────────────────────


async def _nominatim_autocomplete(query: str) -> list[dict]:
    try:
        resp = await _http().get(
            f"{_NOMINATIM_BASE}/search",
            params={
                "format": "jsonv2",
                "q": query,
                "limit": 7,
                "countrycodes": settings.GEOCODE_COUNTRY,
                "viewbox": _NOMINATIM_VIEWBOX,
                "addressdetails": 1,
                "accept-language": settings.GEOCODE_LANGUAGE,
            },
        )
        if resp.status_code >= 400:
            return []
        data = resp.json()
    except Exception:  # noqa: BLE001
        logger.warning("Nominatim autocomplete failed", exc_info=True)
        return []

    out: list[dict] = []
    for r in data:
        try:
            lat = float(r["lat"])
            lng = float(r["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        out.append({"id": f"osm:{lat},{lng}", "label": _build_label(r), "lat": lat, "lng": lng})
    return out


async def _nominatim_details(place_id: str) -> dict | None:
    # Fallback id'si koordinatı taşır ("osm:lat,lng"); ek istek yerine ondan çöz.
    if place_id.startswith("osm:"):
        try:
            lat_s, lng_s = place_id[4:].split(",", 1)
            lat, lng = float(lat_s), float(lng_s)
        except (ValueError, IndexError):
            return None
        rev = await _nominatim_reverse(lat, lng)
        return {"lat": lat, "lng": lng, "address": (rev or {}).get("address") or ""}
    return None


async def _nominatim_reverse(lat: float, lng: float) -> dict | None:
    try:
        resp = await _http().get(
            f"{_NOMINATIM_BASE}/reverse",
            params={
                "format": "jsonv2",
                "lat": lat,
                "lon": lng,
                "zoom": 18,
                "addressdetails": 1,
                "accept-language": settings.GEOCODE_LANGUAGE,
            },
        )
        if resp.status_code >= 400:
            return None
        data = resp.json()
    except Exception:  # noqa: BLE001
        logger.warning("Nominatim reverse geocode failed", exc_info=True)
        return None

    if not data or data.get("error"):
        return {"address": None}
    label = _build_label(data) or data.get("display_name")
    return {"address": label}


async def _nominatim_forward(query: str) -> dict | None:
    # Forward ücretsiz fallback — ülke geneli (bounded YOK; Ceyhan dışı adresler de çözülsün).
    try:
        resp = await _http().get(
            f"{_NOMINATIM_BASE}/search",
            params={
                "format": "jsonv2",
                "q": query,
                "limit": 1,
                "countrycodes": settings.GEOCODE_COUNTRY,
                "addressdetails": 1,
                "accept-language": settings.GEOCODE_LANGUAGE,
            },
        )
        if resp.status_code >= 400:
            return None
        data = resp.json()
    except Exception:  # noqa: BLE001
        logger.warning("Nominatim forward geocode failed", exc_info=True)
        return None

    if not data:
        return None
    r = data[0]
    try:
        lat = float(r["lat"])
        lng = float(r["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    return {"lat": lat, "lng": lng, "address": _build_label(r)}


def _build_label(r: dict) -> str:
    """Yapılandırılmış Nominatim adres parçalarından temiz bir etiket kur."""
    a = r.get("address")
    if not a:
        return r.get("display_name", "")

    parts: list[str] = []
    poi = a.get("building") or a.get("amenity") or a.get("shop") or a.get("office") or a.get("tourism") or a.get("leisure")
    if poi:
        parts.append(poi)
    if a.get("road"):
        parts.append(f"{a['road']} No: {a['house_number']}" if a.get("house_number") else a["road"])
    if a.get("neighbourhood"):
        parts.append(a["neighbourhood"])
    elif a.get("quarter"):
        parts.append(a["quarter"])
    elif a.get("suburb"):
        parts.append(a["suburb"])
    if a.get("town"):
        parts.append(a["town"])
    elif a.get("county"):
        parts.append(a["county"])
    elif a.get("city_district"):
        parts.append(a["city_district"])
    if a.get("city"):
        parts.append(a["city"])
    elif a.get("province"):
        parts.append(a["province"])
    elif a.get("state"):
        parts.append(a["state"])
    if a.get("postcode"):
        parts.append(a["postcode"])

    return ", ".join(parts) if parts else r.get("display_name", "")
