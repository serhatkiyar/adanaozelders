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

def arac(vid: int, *, max_stops=None, fixed_cost=0):
    """İP-19 imzası: payload kurucular araç NESNESİ alır (RouteVehicle)."""
    from core.routing.base import RouteVehicle

    return RouteVehicle(
        id=vid, start_lat=DEPOT[0], start_lng=DEPOT[1],
        max_stops=max_stops, fixed_cost=fixed_cost,
    )



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
    payload = build_vroom_payload(points=[p(7, 37.01, 35.33)], vehicles=[arac(1)])
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


# ── Çoklu araç (Faz: Günü Optimize Et) ───────────────────────────────────────────


def test_build_vroom_payload_single_vehicle_unchanged():
    """Varsayılan değerli tek araçta payload, İP-19 ÖNCESİ tek-araç biçiminin
    BİREBİR aynısı olmalı (geriye uyumluluk regresyonu — D-4 ile aynı iddia)."""
    pts = [p(11, 37.01, 35.33)]
    payload = build_vroom_payload(points=pts, vehicles=[arac(1)])
    assert payload["vehicles"] == [
        {"id": 1, "profile": "car", "start": [DEPOT[1], DEPOT[0]]}
    ]
    assert payload["options"] == {"g": True}
    assert [j["id"] for j in payload["jobs"]] == [11]


def test_build_vroom_payload_multi_vehicle():
    pts = [p(11, 37.01, 35.33), p(12, 36.99, 35.30)]
    payload = build_vroom_payload(points=pts, vehicles=[arac(1), arac(2)])
    assert [v["id"] for v in payload["vehicles"]] == [1, 2]
    assert all(v["start"] == [DEPOT[1], DEPOT[0]] for v in payload["vehicles"])


def test_parse_vroom_fleet_maps_routes_to_vehicles():
    from core.routing.vroom import parse_vroom_fleet

    data = {
        "code": 0,
        "summary": {"unassigned": 0},
        "routes": [
            {
                "vehicle": 1,
                "duration": 600,
                "service": 180,
                "distance": 5000,
                "geometry": "abc",
                "steps": [
                    {"type": "start"},
                    {"type": "job", "id": 11, "arrival": 300},
                ],
            },
            {
                "vehicle": 2,
                "duration": 400,
                "service": 180,
                "distance": 3000,
                "geometry": "def",
                "steps": [
                    {"type": "start"},
                    {"type": "job", "id": 12, "arrival": 200},
                ],
            },
        ],
    }
    fleet = parse_vroom_fleet(data)
    assert set(fleet) == {1, 2}
    assert fleet[1].ordered_ids == [11]
    assert fleet[2].ordered_ids == [12]
    assert fleet[2].total_distance_km == 3.0


def test_parse_vroom_fleet_unassigned_raises():
    from core.routing.vroom import parse_vroom_fleet

    with pytest.raises(RoutingUnavailable):
        parse_vroom_fleet({"code": 0, "summary": {"unassigned": 2}, "routes": []})


def test_partition_by_angle_balanced_and_complete():
    from core.routing.haversine import partition_by_angle

    pts = [p(i, DEPOT[0] + 0.01 * math.sin(i), DEPOT[1] + 0.01 * math.cos(i)) for i in range(7)]
    slices = partition_by_angle(DEPOT, pts, 2)
    assert len(slices) == 2
    sizes = sorted(len(s) for s in slices)
    assert sizes == [3, 4]  # dengeli bölme
    got = sorted(pt.id for s in slices for pt in s)
    assert got == list(range(7))  # kayıp/tekrar yok


def test_partition_by_angle_single_vehicle_passthrough():
    from core.routing.haversine import partition_by_angle

    pts = [p(1, 37.0, 35.3), p(2, 37.1, 35.4)]
    slices = partition_by_angle(DEPOT, pts, 1)
    assert len(slices) == 1 and len(slices[0]) == 2


@pytest.mark.asyncio
async def test_haversine_plan_fleet_two_vehicles():
    pts = [
        p(1, 36.99, 35.30),
        p(2, 36.98, 35.29),
        p(3, 37.00, 35.40),
        p(4, 37.01, 35.41),
    ]
    # İP-19: haversine kaç aracın çıkacağını max_stops'tan türetir (K-3
    # fallback yarısı) — iki aracın da sahaya çıkması için tavan veriyoruz.
    fleet = await HaversineRoutingProvider().plan_fleet(
        points=pts, vehicles=[arac(1, max_stops=2), arac(2, max_stops=2)]
    )
    assert fleet.provider == "haversine"
    assert set(fleet.routes) == {1, 2}
    all_ids = sorted(i for r in fleet.routes.values() for i in r.ordered_ids)
    assert all_ids == [1, 2, 3, 4]
