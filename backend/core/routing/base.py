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


@dataclass(frozen=True)
class RouteVehicle:
    """Plana giren tek araç — İP-19 (sözleşme §3.1).

    ``id`` **doğrudan VROOM vehicle id'sidir** ve `vehicles.id`'den gelir (K-1);
    eski ``{1: "LADA", 2: "COROLLA"}`` köprüsü yoktur. Opsiyonel alanların
    TÜMÜ "yoksa kısıt yok" semantiği taşır (K-2): ``max_stops=None`` tavansız,
    ``shift_*_sec=None`` penceresiz, ``fixed_cost=0`` maliyetsiz demektir ve
    hiçbiri doluyken payload bugünkü tek-araç hâliyle birebir aynıdır (D-4).

    ``start_lat/lng`` araç başınadır (K-9: depo yok, başlangıç noktası veridir);
    ``shift_*_sec`` gün başından saniyedir (VROOM ``time_window`` göreli kip).
    """

    id: int
    start_lat: float
    start_lng: float
    profile: str = "car"
    max_stops: int | None = None
    shift_start_sec: int | None = None
    shift_end_sec: int | None = None
    fixed_cost: int = 0


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

    Araç id'leri ``RouteVehicle.id``'dir (= ``vehicles.id`` = VROOM id, K-1).
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
        points: list[RoutePoint],
        vehicles: list[RouteVehicle],
    ) -> FleetPlan:
        """Durakları araçlara bölüştürüp her araç için rota planlar.

        İP-19: imza araç NESNESİ alır (sözleşme §3.1) — start/max_stops/vardiya/
        maliyet araç başınadır; ``vehicle_ids: list[int]`` + tek depo varsayımı
        kalktı. Varsayılan: tek araçsa ``plan``'a düşer (başlangıç o aracın
        ``start``'ıdır); çok araç sağlayıcıda override edilir.
        """
        if len(vehicles) == 1:
            v = vehicles[0]
            single = await self.plan(
                depot_lat=v.start_lat, depot_lng=v.start_lng, points=points
            )
            return FleetPlan(routes={v.id: single}, provider=self.name)
        raise NotImplementedError
