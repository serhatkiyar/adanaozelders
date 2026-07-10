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
from core.routing.base import (
    FleetPlan,
    RoutePlan,
    RoutePoint,
    RoutingProvider,
    RoutingUnavailable,
)


def build_vroom_payload(
    *,
    depot_lat: float,
    depot_lng: float,
    points: list[RoutePoint],
    vehicle_ids: list[int] | None = None,
) -> dict[str, Any]:
    """VROOM isteği (açık tur — depoya dönüş zorunlu değil). VROOM koordinatları
    [lng, lat] ister. ``vehicle_ids`` verilmezse bugüne kadarki tek-araç payload'ı
    birebir korunur (geriye uyumluluk); verilirse VROOM işleri araçlara kendisi
    optimal bölüştürür (doğal multi-vehicle desteği)."""
    ids = vehicle_ids or [1]
    return {
        "vehicles": [
            {
                "id": vid,
                "profile": "car",
                "start": [depot_lng, depot_lat],
            }
            for vid in ids
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
    """VROOM yanıtından tek-araç planı çıkarır. ``code != 0`` ya da atanmamış iş
    varsa ``RoutingUnavailable`` (kısmi plan sessizce uygulanmaz)."""
    if data.get("code") != 0:
        raise RoutingUnavailable(f"VROOM hata kodu: {data.get('code')} {data.get('error')}")
    if data.get("summary", {}).get("unassigned", 0):
        raise RoutingUnavailable("VROOM bazı durakları atayamadı")
    routes = data.get("routes") or []
    if not routes:
        raise RoutingUnavailable("VROOM rota dönmedi")
    return _route_to_plan(routes[0])


def _route_to_plan(route: dict[str, Any]) -> RoutePlan:
    """Tek VROOM route'unu RoutePlan'a çevirir (parse_vroom_plan'ın çekirdeği)."""
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


def parse_vroom_fleet(data: dict[str, Any]) -> dict[int, RoutePlan]:
    """Çok araçlı VROOM yanıtı: araç id → rota. ``code != 0`` ya da atanmamış
    iş varsa ``RoutingUnavailable`` (kısmi plan uygulanmaz)."""
    if data.get("code") != 0:
        raise RoutingUnavailable(f"VROOM hata kodu: {data.get('code')} {data.get('error')}")
    if data.get("summary", {}).get("unassigned", 0):
        raise RoutingUnavailable("VROOM bazı durakları atayamadı")
    routes = data.get("routes") or []
    if not routes:
        raise RoutingUnavailable("VROOM rota dönmedi")
    return {int(r.get("vehicle", 0)): _route_to_plan(r) for r in routes}


async def _post_vroom(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(settings.VROOM_URL, json=payload)
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RoutingUnavailable(f"VROOM'a ulaşılamadı: {exc}") from exc


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
        return parse_vroom_plan(await _post_vroom(payload))

    async def plan_fleet(
        self,
        *,
        depot_lat: float,
        depot_lng: float,
        points: list[RoutePoint],
        vehicle_ids: list[int],
    ) -> FleetPlan:
        if not points:
            return FleetPlan(routes={}, provider=self.name)
        if len(vehicle_ids) == 1:
            return await super().plan_fleet(
                depot_lat=depot_lat,
                depot_lng=depot_lng,
                points=points,
                vehicle_ids=vehicle_ids,
            )
        payload = build_vroom_payload(
            depot_lat=depot_lat,
            depot_lng=depot_lng,
            points=points,
            vehicle_ids=vehicle_ids,
        )
        return FleetPlan(
            routes=parse_vroom_fleet(await _post_vroom(payload)), provider=self.name
        )
