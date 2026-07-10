"""Sağlayıcıdan bağımsız rota optimizasyonu (core/payments deseni).

``ROUTING_PROVIDER``: "auto" (varsayılan — VROOM dene, düşerse haversine),
"vroom" (zorunlu; düşerse hata), "haversine" (dış servis yok).
"""
from __future__ import annotations

import logging

from core.config import settings
from core.routing.base import (
    FleetPlan,
    RoutePlan,
    RoutePoint,
    RoutingProvider,
    RoutingUnavailable,
)
from core.routing.haversine import HaversineRoutingProvider
from core.routing.vroom import VroomRoutingProvider

logger = logging.getLogger("ceyhan.routing")

__all__ = [
    "FleetPlan",
    "RoutePlan",
    "RoutePoint",
    "RoutingProvider",
    "RoutingUnavailable",
    "HaversineRoutingProvider",
    "VroomRoutingProvider",
    "plan_route",
    "plan_fleet",
]


async def plan_route(
    *, depot_lat: float, depot_lng: float, points: list[RoutePoint]
) -> RoutePlan:
    """Ayarlara göre sağlayıcı seçip planlar. ``auto`` modda VROOM düşerse
    haversine'e sessizce (log'lu) geriler — geliştirme kurulumsuz çalışır."""
    mode = (settings.ROUTING_PROVIDER or "auto").strip().lower()
    if mode == "haversine":
        return await HaversineRoutingProvider().plan(
            depot_lat=depot_lat, depot_lng=depot_lng, points=points
        )
    try:
        return await VroomRoutingProvider().plan(
            depot_lat=depot_lat, depot_lng=depot_lng, points=points
        )
    except RoutingUnavailable as exc:
        if mode == "vroom":
            raise
        logger.warning("VROOM kullanılamadı, haversine fallback: %s", exc)
        return await HaversineRoutingProvider().plan(
            depot_lat=depot_lat, depot_lng=depot_lng, points=points
        )


async def plan_fleet(
    *,
    depot_lat: float,
    depot_lng: float,
    points: list[RoutePoint],
    vehicle_ids: list[int],
) -> FleetPlan:
    """Çok araçlı bölüştürme + rota (plan_route ile aynı sağlayıcı seçimi/fallback).
    VROOM işleri araçlara kendisi optimal dağıtır; haversine kutupsal-açı dilimleme
    + NN/2-opt ile yaklaşır."""
    mode = (settings.ROUTING_PROVIDER or "auto").strip().lower()
    if mode == "haversine":
        return await HaversineRoutingProvider().plan_fleet(
            depot_lat=depot_lat, depot_lng=depot_lng, points=points, vehicle_ids=vehicle_ids
        )
    try:
        return await VroomRoutingProvider().plan_fleet(
            depot_lat=depot_lat, depot_lng=depot_lng, points=points, vehicle_ids=vehicle_ids
        )
    except RoutingUnavailable as exc:
        if mode == "vroom":
            raise
        logger.warning("VROOM kullanılamadı, haversine fleet fallback: %s", exc)
        return await HaversineRoutingProvider().plan_fleet(
            depot_lat=depot_lat, depot_lng=depot_lng, points=points, vehicle_ids=vehicle_ids
        )
