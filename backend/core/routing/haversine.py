"""Kuş uçuşu (haversine) rota sağlayıcısı — dış servis GEREKMEZ.

Yakın-komşu kurulum + 2-opt iyileştirme. 150 durakta dahi milisaniyeler
mertebesindedir. Süre tahmini şehir içi ortalama hız + durak servis süresiyle
yapılır; OSRM/VROOM yokken geliştirmede ve fallback'te kullanılır.

Saf fonksiyonlar (``haversine_km``/``nearest_neighbor_order``/``two_opt``)
pytest'lidir.
"""
from __future__ import annotations

import math

from core.config import settings
from core.routing.base import FleetPlan, RoutePlan, RoutePoint, RoutingProvider

# Şehir içi ortalama sürüş hızı (dur-kalk dahil, iyimser değil).
_AVG_SPEED_KMH = 28.0
# Kuş uçuşu → yol mesafesi düzeltme çarpanı (şehir içi tipik ~1.3).
_ROAD_FACTOR = 1.3


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_neighbor_order(
    depot: tuple[float, float], points: list[RoutePoint]
) -> list[int]:
    """Depodan başlayarak her adımda en yakın ziyaret edilmemiş durağa git.
    Dönüş: ``points`` içindeki index sırası."""
    remaining = list(range(len(points)))
    order: list[int] = []
    cur = depot
    while remaining:
        best = min(
            remaining,
            key=lambda i: haversine_km(cur[0], cur[1], points[i].lat, points[i].lng),
        )
        remaining.remove(best)
        order.append(best)
        cur = (points[best].lat, points[best].lng)
    return order


def two_opt(
    order: list[int],
    points: list[RoutePoint],
    depot: tuple[float, float],
    max_passes: int = 8,
) -> list[int]:
    """Klasik 2-opt: kesişen kenarları düzelterek turu kısaltır (açık tur —
    depoya dönüş yok). İyileşme kalmayınca ya da pas limiti dolunca durur."""

    def coord(i: int) -> tuple[float, float]:
        # -1 = depo (rota başı)
        return depot if i == -1 else (points[i].lat, points[i].lng)

    def d(a: int, b: int) -> float:
        ca, cb = coord(a), coord(b)
        return haversine_km(ca[0], ca[1], cb[0], cb[1])

    best = order[:]
    for _ in range(max_passes):
        improved = False
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                prev_i = best[i - 1] if i > 0 else -1
                # Kenarlar: (prev_i → i) + (j → j+1)  vs  (prev_i → j) + (i → j+1)
                after_j = best[j + 1] if j + 1 < len(best) else None
                old = d(prev_i, best[i]) + (d(best[j], after_j) if after_j is not None else 0.0)
                new = d(prev_i, best[j]) + (d(best[i], after_j) if after_j is not None else 0.0)
                if new + 1e-9 < old:
                    best[i : j + 1] = reversed(best[i : j + 1])
                    improved = True
        if not improved:
            break
    return best


def partition_by_angle(
    depot: tuple[float, float], points: list[RoutePoint], k: int
) -> list[list[RoutePoint]]:
    """Durakları depo etrafındaki kutupsal açıya göre sıralayıp k bitişik ve
    dengeli dilime böler (saf). Açısal bitişiklik dilim içi yakınlığı korur —
    kaba ama etkili bölüştürme; dilim içi sıralamayı NN+2-opt yapar."""
    if k <= 1 or len(points) <= 1:
        return [list(points)] + [[] for _ in range(max(k - 1, 0))]
    ordered = sorted(
        points, key=lambda p: math.atan2(p.lat - depot[0], p.lng - depot[1])
    )
    n = len(ordered)
    base, extra = divmod(n, k)
    slices: list[list[RoutePoint]] = []
    start = 0
    for i in range(k):
        size = base + (1 if i < extra else 0)
        slices.append(ordered[start : start + size])
        start += size
    return slices


class HaversineRoutingProvider(RoutingProvider):
    name = "haversine"

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
        slices = partition_by_angle((depot_lat, depot_lng), points, len(vehicle_ids))
        routes: dict[int, RoutePlan] = {}
        # partition_by_angle tam len(vehicle_ids) dilim döndürür.
        for vid, chunk in zip(vehicle_ids, slices, strict=True):
            if chunk:
                routes[vid] = await self.plan(
                    depot_lat=depot_lat, depot_lng=depot_lng, points=chunk
                )
        return FleetPlan(routes=routes, provider=self.name)

    async def plan(
        self, *, depot_lat: float, depot_lng: float, points: list[RoutePoint]
    ) -> RoutePlan:
        if not points:
            return RoutePlan(ordered_ids=[], provider=self.name)
        depot = (depot_lat, depot_lng)
        order = two_opt(nearest_neighbor_order(depot, points), points, depot)

        service = settings.DELIVERY_STOP_SERVICE_SECONDS
        offsets: dict[int, int] = {}
        total_km = 0.0
        t = 0.0
        cur = depot
        for idx in order:
            p = points[idx]
            leg_km = haversine_km(cur[0], cur[1], p.lat, p.lng) * _ROAD_FACTOR
            total_km += leg_km
            t += (leg_km / _AVG_SPEED_KMH) * 3600
            offsets[p.id] = int(t)
            t += service
            cur = (p.lat, p.lng)

        return RoutePlan(
            ordered_ids=[points[i].id for i in order],
            arrival_offsets=offsets,
            total_duration_seconds=int(t),
            total_distance_km=round(total_km, 1),
            geometry=None,  # kuş uçuşu — çizim istemcide düz çizgiyle yapılır
            provider=self.name,
        )
