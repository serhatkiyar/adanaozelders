"""core/routing saf mantığı + sapma hesabı — DB/ağ gerektirmez."""
import math

import pytest

from core.routing.base import RoutePoint, RoutingUnavailable
from core.routing.haversine import (
    HaversineRoutingProvider,
    haversine_km,
    nearest_neighbor_order,
    two_opt,
)
from core.routing.vroom import build_vroom_payload, parse_vroom_plan
from services.delivery_service import compute_detours

DEPOT = (36.9855, 35.3253)  # Seyhan Çakmak Cad. civarı


def p(id_: int, lat: float, lng: float) -> RoutePoint:
    return RoutePoint(id=id_, lat=lat, lng=lng)


def test_haversine_km_known_distance():
    # Adana merkez → Ceyhan ~43 km (kuş uçuşu)
    d = haversine_km(37.0000, 35.3213, 37.0246, 35.8125)
    assert 42 <= d <= 46


def test_nearest_neighbor_visits_all_once():
    pts = [p(1, 37.01, 35.33), p(2, 37.05, 35.31), p(3, 36.99, 35.34)]
    order = nearest_neighbor_order(DEPOT, pts)
    assert sorted(order) == [0, 1, 2]


def test_two_opt_untangles_crossing():
    # Depodan doğuya bir hat: optimal ziyaret soldan sağa (ya da tersi tek yön).
    pts = [
        p(1, 36.9855, 35.40),
        p(2, 36.9855, 35.34),
        p(3, 36.9855, 35.44),
        p(4, 36.9855, 35.37),
    ]
    order = two_opt(nearest_neighbor_order(DEPOT, pts), pts, DEPOT)
    lngs = [pts[i].lng for i in order]
    assert lngs == sorted(lngs)  # tek yönlü süpürme = kesişme yok


@pytest.mark.asyncio
async def test_haversine_provider_plan_offsets_monotonic():
    pts = [p(1, 37.01, 35.33), p(2, 37.05, 35.31), p(3, 36.99, 35.34)]
    plan = await HaversineRoutingProvider().plan(
        depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=pts
    )
    assert sorted(plan.ordered_ids) == [1, 2, 3]
    offsets = [plan.arrival_offsets[i] for i in plan.ordered_ids]
    assert offsets == sorted(offsets) and offsets[0] > 0
    assert plan.total_distance_km and plan.total_distance_km > 0
    assert plan.provider == "haversine"


def test_build_vroom_payload_lng_lat_order():
    payload = build_vroom_payload(
        depot_lat=DEPOT[0], depot_lng=DEPOT[1], points=[p(7, 37.01, 35.33)]
    )
    assert payload["vehicles"][0]["start"] == [DEPOT[1], DEPOT[0]]  # [lng, lat]
    assert payload["jobs"][0]["location"] == [35.33, 37.01]
    assert payload["jobs"][0]["id"] == 7
    assert payload["options"]["g"] is True


def test_parse_vroom_plan_happy_path():
    plan = parse_vroom_plan(
        {
            "code": 0,
            "summary": {"unassigned": 0},
            "routes": [
                {
                    "duration": 1800,
                    "service": 360,
                    "distance": 12500,
                    "geometry": "abc123",
                    "steps": [
                        {"type": "start"},
                        {"type": "job", "id": 5, "arrival": 600},
                        {"type": "job", "id": 3, "arrival": 1500},
                        {"type": "end"},
                    ],
                }
            ],
        }
    )
    assert plan.ordered_ids == [5, 3]
    assert plan.arrival_offsets == {5: 600, 3: 1500}
    assert plan.total_duration_seconds == 2160
    assert plan.total_distance_km == 12.5
    assert plan.geometry == "abc123"


def test_parse_vroom_plan_rejects_error_and_unassigned():
    with pytest.raises(RoutingUnavailable):
        parse_vroom_plan({"code": 3, "error": "bad"})
    with pytest.raises(RoutingUnavailable):
        parse_vroom_plan({"code": 0, "summary": {"unassigned": 1}, "routes": []})


def test_compute_detours_on_line_vs_outlier():
    # Düz hat üstündeki duraklar ~0 sapma; hattan uzak durak büyük sapma.
    line = [(36.9855, 35.34), (36.9855, 35.38), (36.9855, 35.42)]
    detours = compute_detours(DEPOT, line)
    assert all(d < 0.5 for d in detours[:-1])  # hat üstü ara duraklar
    outlier_route = [(36.9855, 35.34), (37.15, 35.38), (36.9855, 35.42)]
    d2 = compute_detours(DEPOT, outlier_route)
    assert d2[1] > 20  # hattan ~18 km sapan durak ciddi ek yol yaratır


def test_compute_detours_never_negative():
    route = [(37.01, 35.33), (37.02, 35.35), (36.99, 35.30)]
    assert all(d >= 0 for d in compute_detours(DEPOT, route))
