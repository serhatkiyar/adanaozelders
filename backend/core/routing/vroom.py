"""VROOM sağlayıcısı — self-hosted VRP çözücü (arka uçta OSRM yol ağı).

``docker compose --profile routing up`` ile kalkar (bkz. scripts/setup-osrm-adana.ps1
veri hazırlığı). Payload kurma/yanıt ayrıştırma saf fonksiyonlardır (pytest'li);
ağ çağrısı yalnız ``plan`` içindedir. Ulaşılamazsa ``RoutingUnavailable`` —
factory ``auto`` modunda haversine'e düşer.
"""
from __future__ import annotations

from typing import Any

import httpx

from core.config import settings
from core.routing.base import RoutePlan, RoutePoint, RoutingProvider, RoutingUnavailable


def build_vroom_payload(
    *, depot_lat: float, depot_lng: float, points: list[RoutePoint]
) -> dict[str, Any]:
    """VROOM isteği (tek araç, açık tur — depoya dönüş zorunlu değil).
    VROOM koordinatları [lng, lat] ister."""
    return {
        "vehicles": [
            {
                "id": 1,
                "profile": "car",
                "start": [depot_lng, depot_lat],
            }
        ],
        "jobs": [
            {
                "id": p.id,
                "location": [p.lng, p.lat],
                "service": settings.DELIVERY_STOP_SERVICE_SECONDS,
            }
            for p in points
        ],
        "options": {"g": True},
    }


def parse_vroom_plan(data: dict[str, Any]) -> RoutePlan:
    """VROOM yanıtından plan çıkarır. ``code != 0`` ya da atanmamış iş varsa
    ``RoutingUnavailable`` (kısmi plan sessizce uygulanmaz)."""
    if data.get("code") != 0:
        raise RoutingUnavailable(f"VROOM hata kodu: {data.get('code')} {data.get('error')}")
    if data.get("summary", {}).get("unassigned", 0):
        raise RoutingUnavailable("VROOM bazı durakları atayamadı")
    routes = data.get("routes") or []
    if not routes:
        raise RoutingUnavailable("VROOM rota dönmedi")
    route = routes[0]

    ordered: list[int] = []
    offsets: dict[int, int] = {}
    for step in route.get("steps", []):
        if step.get("type") == "job":
            ordered.append(step["id"])
            offsets[step["id"]] = int(step.get("arrival", 0))

    distance_m = route.get("distance")
    return RoutePlan(
        ordered_ids=ordered,
        arrival_offsets=offsets,
        total_duration_seconds=int(route.get("duration", 0))
        + int(route.get("service", 0)),
        total_distance_km=round(distance_m / 1000, 1) if distance_m else None,
        geometry=route.get("geometry"),
        provider="vroom",
    )


class VroomRoutingProvider(RoutingProvider):
    name = "vroom"

    async def plan(
        self, *, depot_lat: float, depot_lng: float, points: list[RoutePoint]
    ) -> RoutePlan:
        if not points:
            return RoutePlan(ordered_ids=[], provider=self.name)
        payload = build_vroom_payload(
            depot_lat=depot_lat, depot_lng=depot_lng, points=points
        )
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(settings.VROOM_URL, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise RoutingUnavailable(f"VROOM'a ulaşılamadı: {exc}") from exc
        return parse_vroom_plan(data)
