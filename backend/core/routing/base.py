"""Sağlayıcıdan bağımsız rota optimizasyonu (core/payments deseni).

Girdi: depo + duraklar (lat/lng). Çıktı: optimal ziyaret sırası + durak başına
varış ofseti + toplamlar + (varsa) rota geometrisi. Sağlayıcılar:

- ``vroom``     : self-hosted VROOM (+OSRM yol ağı) — gerçek sürüş süreleri.
- ``haversine`` : dış servis GEREKMEZ — kuş uçuşu yakın-komşu + 2-opt.
                  Geliştirme/fallback için; şehir içi ~%20-30 yaklaşıktır.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class RoutingUnavailable(Exception):
    """Sağlayıcıya ulaşılamadı / geçersiz yanıt — factory fallback'e düşebilir."""


@dataclass(frozen=True)
class RoutePoint:
    """Optimize edilecek tek durak (id çağıranın anlamlandırdığı anahtardır)."""

    id: int
    lat: float
    lng: float


@dataclass
class RoutePlan:
    """Optimizasyon sonucu.

    ``arrival_offsets``: durak id → turun başlangıcından itibaren saniye
    (servis süreleri dahil). ``geometry``: encoded polyline5 (yalnız vroom).
    """

    ordered_ids: list[int]
    arrival_offsets: dict[int, int] = field(default_factory=dict)
    total_duration_seconds: int = 0
    total_distance_km: float | None = None
    geometry: str | None = None
    provider: str = ""


@dataclass
class FleetPlan:
    """Çok araçlı dağıtım sonucu: araç id → o aracın rotası.

    Araç id'leri çağıranın anahtarıdır (delivery: 1=LADA, 2=COROLLA).
    Boş kalan araç routes'ta görünmez.
    """

    routes: dict[int, RoutePlan] = field(default_factory=dict)
    provider: str = ""


class RoutingProvider(ABC):
    name: str = "base"

    @abstractmethod
    async def plan(
        self, *, depot_lat: float, depot_lng: float, points: list[RoutePoint]
    ) -> RoutePlan:
        """Durakları optimal sıraya dizer. Boş listeye boş plan döner."""

    async def plan_fleet(
        self,
        *,
        depot_lat: float,
        depot_lng: float,
        points: list[RoutePoint],
        vehicle_ids: list[int],
    ) -> FleetPlan:
        """Durakları araçlara bölüştürüp her araç için rota planlar.
        Varsayılan: tek araçsa ``plan``'a düşer; çok araç sağlayıcıda override edilir."""
        if len(vehicle_ids) == 1:
            single = await self.plan(
                depot_lat=depot_lat, depot_lng=depot_lng, points=points
            )
            return FleetPlan(routes={vehicle_ids[0]: single}, provider=self.name)
        raise NotImplementedError
